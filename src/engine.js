import { UserWords } from './user-words.js';
import { resolveWordList, parseWordList, escapeForCharacterClass } from './word-lists.js';
import { NgramModel, fnv1a } from './ngrams.js';
import wordCharsByLanguage from '../languages/word-chars.js';
import compositionByLanguage from '../languages/compositions.js';
import segmentersByLanguage from '../languages/segmenters.js';
import { parseComposition, compositionCandidates, normalizeReading, readingToDigits, isReadingLike, voiceKanaChar } from './composition.js';

const userWordsDefaults = {
    storagePrefix: 'suggest-engine',
    recordAfter: 2,
    maxWords: 300,
};

const cjkCharClass = {
    kana: '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30FC]',
    pinyin: '[\\p{Script=Han}]',
};

function normalizeUserWords(option) {
    if (!option) return null;

    const provided = option === true ? {} : option;

    return {
        storagePrefix: provided.storagePrefix ?? userWordsDefaults.storagePrefix,
        recordAfter: provided.recordAfter ?? userWordsDefaults.recordAfter,
        maxWords: provided.maxWords ?? userWordsDefaults.maxWords,
    };
}

function wordCharsFor(language) {
    return (language && wordCharsByLanguage[language]) || '';
}

// Languages whose script has no inter-word spaces (for example Thai) ship a
// segmentation locale; wordAt/previousWords then split text with
// Intl.Segmenter, matching the tokenizer used to build the word list.
function segmenterFor(language) {
    const locale = language && segmentersByLanguage[language];

    if (!locale || typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;

    return new Intl.Segmenter(locale, { granularity: 'word' });
}

function compositionMinLength(language) {
    return compositionByLanguage[language] ? 1 : 2;
}

function boundaryRegexFor(language) {
    return new RegExp(`[^\\p{L}\\p{M}'\\-${escapeForCharacterClass(wordCharsFor(language))}]`, 'u');
}

function buildSource(words) {
    const lowered = new Array(words.length);
    const buckets = new Map();

    for (let i = 0; i < words.length; i ++) {
        const lower = words[i].toLowerCase();
        lowered[i] = lower;

        const first = lower.charAt(0);
        let bucket = buckets.get(first);

        if (!bucket) buckets.set(first, bucket = []);

        bucket.push(i);
    }

    return { words, lowered, buckets };
}

function defaultNgramBase() {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.url) {
            return new URL('../languages/', import.meta.url).href;
        }
    } catch (err) {
        // import.meta is unavailable in some environments; callers pass a base URL there.
    }

    return null;
}

export class SuggestEngine {
    constructor(options = {}) {
        this.language = options.language ? String(options.language).trim().toLowerCase() : null;
        this.maxSuggestions = options.maxSuggestions ?? 5;
        this.applyTokenizer(this.language);

        const userWordsOptions = normalizeUserWords(options.userWords);
        this.userWordsOptions = userWordsOptions;
        this.userWordsStore = userWordsOptions ? new UserWords(userWordsOptions) : null;
        if (this.language) this.userWordsStore?.setLanguage(this.language, wordCharsFor(this.language), compositionMinLength(this.language));

        this.sourcesByLanguage = {};
        this.ngramsByLanguage = {};
        this.ngramIndexes = {};
        this.bundledManifest = null;
        this.compositionsByLanguage = {};
        this.compositionBuffers = {};
    }

    setLanguage(language) {
        if (typeof language !== 'string' || !language.trim()) {
            throw new TypeError('setLanguage requires a language code');
        }

        this.language = language.trim().toLowerCase();
        this.applyTokenizer(this.language);
        this.userWordsStore?.setLanguage(this.language, wordCharsFor(this.language), compositionMinLength(this.language));
    }

    // Composition languages have no spaces: wordAt treats each CJK character
    // as its own boundary (no partial CJK word is ever reported at the caret —
    // suggestions come from the composition buffer), while context extraction
    // walks the text character by character.
    applyTokenizer(language) {
        const kind = compositionByLanguage[language]?.reading;
        const nonWord = `[^\\p{L}\\p{M}'\\-${escapeForCharacterClass(wordCharsFor(language))}]`;

        this.compositionCharRegex = null;
        this.segmenter = segmenterFor(language);

        if (kind) {
            this.compositionCharRegex = new RegExp(cjkCharClass[kind], 'u');
            this.boundaryRegex = new RegExp(`(?:${nonWord}|${this.compositionCharRegex.source})`, 'u');
            this.separatorRegex = new RegExp(nonWord, 'u');
        } else {
            this.boundaryRegex = new RegExp(nonWord, 'u');
            this.separatorRegex = null;
        }
    }

    async addWordList(name, source) {
        if (!this.language) throw new Error('Set a language with setLanguage() before adding word lists');

        const words = await resolveWordList(source, wordCharsFor(this.language));

        if (!this.sourcesByLanguage[this.language]) this.sourcesByLanguage[this.language] = {};

        this.sourcesByLanguage[this.language][name] = buildSource(words);
        delete this.ngramIndexes[this.language];
    }

    async loadWordList(lang) {
        const language = String(lang || this.language).toLowerCase();

        if (!/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(language)) return false;

        if (!this.bundledManifest) {
            this.bundledManifest = (await import('../languages/index.js')).default;
        }

        const loader = this.bundledManifest[language];

        if (!loader) return false;

        const module = await loader();

        if (!this.sourcesByLanguage[language]) this.sourcesByLanguage[language] = {};

        this.sourcesByLanguage[language].bundled = buildSource(parseWordList(module.default, wordCharsFor(language)));
        delete this.ngramIndexes[language];

        return true;
    }

    async addContextModel(source) {
        if (!this.language) throw new Error('Set a language with setLanguage() before adding a context model');

        let model = source;

        if (typeof source === 'string') {
            const response = await fetch(source);

            if (!response.ok) throw new Error(`Unable to fetch ${source}`);

            model = new NgramModel(await response.arrayBuffer());
        } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
            model = new NgramModel(source);
        }

        if (!(model instanceof NgramModel)) throw new TypeError('Unsupported context model source');

        this.ngramsByLanguage[this.language] = model;
        delete this.ngramIndexes[this.language];

        return true;
    }

    async loadSuggestionContext(baseUrl) {
        const language = this.language;

        if (!/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(language)) return false;

        const base = baseUrl ?? defaultNgramBase();

        if (!base) throw new Error('loadSuggestionContext requires a baseUrl (the URL of the languages/ directory)');

        const prefix = String(base).endsWith('/') ? base : `${base}/`;
        const response = await fetch(`${prefix}${language}.ngram.bin`);

        if (!response.ok) return false;

        this.ngramsByLanguage[language] = new NgramModel(await response.arrayBuffer());
        delete this.ngramIndexes[language];

        return true;
    }

    async loadComposition(lang) {
        const language = String(lang || this.language).toLowerCase();

        if (!/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(language)) return false;

        const entry = compositionByLanguage[language];

        if (!entry) return false;

        const module = await entry.load();
        const composition = parseComposition(module.default, entry.reading);

        this.compositionsByLanguage[language] = composition;

        if (!this.sourcesByLanguage[language]) this.sourcesByLanguage[language] = {};

        // The candidate vocabulary acts as the bundled word list: it validates
        // context models by hash, powers nextWords(), and lets suggest()
        // complete CJK words already present in the host's text.
        this.sourcesByLanguage[language].bundled = buildSource(composition.vocab);
        delete this.ngramIndexes[language];

        return true;
    }

    get compositionActive() {
        return !!compositionByLanguage[this.language];
    }

    compositionBuffer() {
        return this.compositionBuffers[this.language] || '';
    }

    compositionAppend(key) {
        if (typeof key !== 'string' || !key.length) return [];
        if (!this.compositionsByLanguage[this.language]) return [];

        this.compositionBuffers[this.language] = this.compositionBuffer() + key;

        return this.compositionSuggestions();
    }

    compositionBackspace() {
        const buffer = this.compositionBuffer();

        if (!buffer) return false;

        const chars = [...buffer];

        chars.pop();
        this.compositionBuffers[this.language] = chars.join('');

        return true;
    }

    compositionReset() {
        this.compositionBuffers[this.language] = '';
    }

    compositionVoiceLast(mark) {
        const buffer = this.compositionBuffer();

        if (!buffer) return false;

        const chars = [...buffer];
        const replacement = voiceKanaChar(chars[chars.length - 1], mark);

        if (!replacement) return false;

        chars[chars.length - 1] = replacement;
        this.compositionBuffers[this.language] = chars.join('');

        return true;
    }

    compositionSuggestions(context, limit = this.maxSuggestions) {
        const composition = this.compositionsByLanguage[this.language];

        if (!composition) return [];

        const buffer = this.compositionBuffer();

        if (!buffer) return [];

        const previousWords = typeof context === 'string' && context.length
            ? this.previousWords(context, context.length, 2)
            : [];

        return this.compositionSuggestionsInternal(composition, previousWords, buffer, limit);
    }

    compositionSuggestionsInternal(composition, previousWords, buffer, limit = this.maxSuggestions) {
        const base = compositionCandidates(composition, buffer);

        if (!base.length) return [];

        const pending = new Set(base);
        const results = [];

        const add = (text, source) => {
            if (!pending.has(text) || results.length >= limit) return;

            pending.delete(text);
            results.push({ text, insertSuffix: text, source });
        };

        if (previousWords.length) {
            const index = this.ngramIndex(this.language);

            if (index) {
                const collect = slice => {
                    if (!slice) return;

                    for (let i = 0; i < slice.ids.length; i ++) add(index.words[slice.ids[i]], 'bundled');
                };

                const previousId = index.ids.get(previousWords[0].toLowerCase());

                if (previousWords.length >= 2) {
                    const first = index.ids.get(previousWords[1].toLowerCase());

                    if (first !== undefined && previousId !== undefined) collect(index.model.trigram(first, previousId));
                }

                if (previousId !== undefined) collect(index.model.bigram(previousId));
            }
        }

        if (this.userWordsStore) {
            const digits = /^\d+$/.test(buffer) ? buffer : null;
            const wanted = digits ? null : normalizeReading(buffer);

            for (const entry of this.userWordsStore.list()) {
                if (results.length >= limit) break;
                if (entry.count < this.userWordsStore.recordAfter) continue;

                const reading = composition.readingByCandidate.get(entry.word);

                if (!reading) continue;

                const matches = digits
                    ? (readingToDigits(reading) || '').startsWith(digits)
                    : reading.startsWith(wanted);

                if (matches) add(entry.word, 'user-words');
            }
        }

        for (const text of base) {
            if (results.length >= limit) break;

            add(text, 'bundled');
        }

        return results;
    }

    wordAt(text, index) {
        if (typeof text !== 'string') return '';

        const end = Math.min(index ?? text.length, text.length);

        if (this.segmenter) return this.segmentedWordAt(text, end);

        let start = 0;

        for (let i = end - 1; i >= 0; i --) {
            if (this.boundaryRegex.test(text.charAt(i))) {
                start = i + 1;
                break;
            }
        }

        return text.substring(start, end);
    }

    // No-space scripts: the segmenter reports the whole word containing the
    // caret, so slice from its start to the caret to recover the typed prefix.
    segmentedWordAt(text, end) {
        if (end <= 0) return '';

        for (const part of this.segmenter.segment(text)) {
            const stop = part.index + part.segment.length;

            if (stop < end) continue;
            if (part.index > end) break;

            return part.isWordLike ? text.slice(part.index, end) : '';
        }

        return '';
    }

    previousWords(text, index, count = 2) {
        if (typeof text !== 'string') return [];

        const end = Math.min(index ?? text.length, text.length);

        if (this.segmenter) return this.segmentedPreviousWords(text, end, count);

        if (this.separatorRegex) {
            const words = [];
            let cursor = end;

            while (words.length < count && cursor > 0) {
                while (cursor > 0 && this.separatorRegex.test(text.charAt(cursor - 1))) cursor --;

                if (!cursor) break;

                if (this.compositionCharRegex.test(text.charAt(cursor - 1))) {
                    words.push(text.charAt(cursor - 1));
                    cursor --;
                    continue;
                }

                const stop = cursor;

                while (cursor > 0 && !this.separatorRegex.test(text.charAt(cursor - 1)) && !this.compositionCharRegex.test(text.charAt(cursor - 1))) cursor --;

                words.push(text.slice(cursor, stop));
            }

            return words;
        }

        const words = [];
        let cursor = end;

        while (words.length < count && cursor > 0) {
            while (cursor > 0 && this.boundaryRegex.test(text.charAt(cursor - 1))) cursor --;

            const stop = cursor;

            while (cursor > 0 && !this.boundaryRegex.test(text.charAt(cursor - 1))) cursor --;

            if (stop === cursor) break;

            words.push(text.substring(cursor, stop));
        }

        return words;
    }

    // No-space scripts: segment the text before the caret and take the last
    // `count` words, nearest first (matching the non-segmented ordering).
    segmentedPreviousWords(text, end, count) {
        const words = [];

        if (end <= 0) return words;

        for (const part of this.segmenter.segment(text.slice(0, end))) {
            if (part.isWordLike) words.push(part.segment);
        }

        return words.slice(-count).reverse();
    }

    suggest(word, context) {
        const previousWords = typeof context === 'string' && context.length
            ? this.previousWords(context, context.length, 2)
            : [];

        return this.suggestInternal(word, previousWords);
    }

    suggestAt(text, caret) {
        const composition = this.language ? this.compositionsByLanguage[this.language] : null;

        if (composition && this.compositionBuffer()) {
            const end = Math.min(caret ?? text.length, text.length);

            return this.compositionSuggestionsInternal(composition, this.previousWords(text, end, 2), this.compositionBuffer());
        }

        const word = this.wordAt(text, caret);
        const end = Math.min(caret ?? text.length, text.length) - word.length;

        return this.suggestInternal(word, this.previousWords(text, end, 2));
    }

    nextWords(context) {
        const previousWords = typeof context === 'string' && context.length
            ? this.previousWords(context, context.length, 2)
            : [];

        return this.nextWordsInternal(previousWords);
    }

    suggestInternal(word, previousWords) {
        if (!this.language) return [];
        if (typeof word !== 'string' || word.length === 0) return [];

        const composition = this.compositionsByLanguage[this.language];

        if (composition && this.compositionBuffer()) return this.compositionSuggestionsInternal(composition, previousWords, this.compositionBuffer());

        if (composition && isReadingLike(word, composition.reading)) {
            const results = this.compositionSuggestionsInternal(composition, previousWords, word);

            if (results.length) return results;
        }

        const wanted = word.toLowerCase();
        const limit = this.maxSuggestions;
        const seen = new Set();
        const results = [];

        const addSuggestion = (full, source, lower) => {
            if (full.length <= word.length) return;

            const key = lower ?? full.toLowerCase();

            if (!key.startsWith(wanted)) return;
            if (seen.has(key)) return;

            seen.add(key);
            results.push({ text: full, insertSuffix: full.substring(word.length), source });
        };

        if (previousWords.length) {
            for (const full of this.contextMatches(wanted, previousWords)) addSuggestion(full, 'bundled');
        }

        if (this.userWordsStore) {
            for (const full of this.userWordsStore.suggestionsFor(word)) addSuggestion(full, 'user-words');
        }

        const sources = this.sourcesByLanguage[this.language] || {};

        for (const [name, source] of Object.entries(sources)) {
            if (results.length >= limit) break;

            const bucket = source.buckets.get(wanted.charAt(0));

            if (!bucket) continue;

            for (const index of bucket) {
                addSuggestion(source.words[index], name, source.lowered[index]);

                if (results.length >= limit) break;
            }
        }

        return results.slice(0, limit);
    }

    nextWordsInternal(previousWords) {
        if (!this.language) return [];

        const limit = this.maxSuggestions;
        const seen = new Set();
        const results = [];
        const index = previousWords.length ? this.ngramIndex(this.language) : null;

        if (index) {
            const collect = slice => {
                if (!slice) return;

                for (let i = 0; i < slice.ids.length && results.length < limit; i ++) {
                    const successor = slice.ids[i];
                    const key = index.lowered[successor];

                    if (seen.has(key)) continue;

                    seen.add(key);
                    results.push({ text: index.words[successor], insertSuffix: index.words[successor], source: 'bundled' });
                }
            };

            const previousId = index.ids.get(previousWords[0].toLowerCase());

            if (previousWords.length >= 2) {
                const first = index.ids.get(previousWords[1].toLowerCase());

                if (first !== undefined && previousId !== undefined) collect(index.model.trigram(first, previousId));
            }

            if (previousId !== undefined) collect(index.model.bigram(previousId));
        }

        if (this.userWordsStore) {
            for (const entry of this.userWordsStore.list()) {
                if (results.length >= limit) break;

                const key = entry.word.toLowerCase();

                if (seen.has(key)) continue;

                seen.add(key);
                results.push({ text: entry.word, insertSuffix: entry.word, source: 'user-words' });
            }
        }

        return results;
    }

    ngramIndex(language) {
        const cached = this.ngramIndexes[language];

        if (cached !== undefined) return cached;

        const model = this.ngramsByLanguage[language];
        const source = this.sourcesByLanguage[language]?.bundled;

        if (!model || !source) return null;

        const hash = fnv1a(source.words.join('\n'));

        if (hash !== model.vocabHash) {
            console.warn(`suggest-engine: context model for "${language}" does not match the bundled word list; context ranking disabled`);
            this.ngramIndexes[language] = null;

            return null;
        }

        const ids = new Map();

        for (let i = 0; i < source.words.length; i ++) {
            const lower = source.lowered[i];

            if (!ids.has(lower)) ids.set(lower, i);
        }

        const index = { model, words: source.words, lowered: source.lowered, ids };

        this.ngramIndexes[language] = index;

        return index;
    }

    contextMatches(wanted, previousWords) {
        const index = this.ngramIndex(this.language);

        if (!index) return [];

        const matches = [];
        const seen = new Set();
        const collect = slice => {
            if (!slice) return;

            for (let i = 0; i < slice.ids.length; i ++) {
                const successor = slice.ids[i];

                if (seen.has(successor)) continue;
                if (!index.lowered[successor].startsWith(wanted)) continue;

                seen.add(successor);
                matches.push(index.words[successor]);
            }
        };

        const previousId = index.ids.get(previousWords[0].toLowerCase());

        if (previousWords.length >= 2) {
            const first = index.ids.get(previousWords[1].toLowerCase());

            if (first !== undefined && previousId !== undefined) collect(index.model.trigram(first, previousId));
        }

        if (previousId !== undefined) collect(index.model.bigram(previousId));

        return matches;
    }

    recordWord(word) {
        if (!this.language) return false;

        return this.userWordsStore ? this.userWordsStore.record(word) : false;
    }

    addWord(word) {
        if (!this.language) return false;

        return this.userWordsStore ? this.userWordsStore.add(word) : false;
    }

    get userWordsEnabled() {
        return this.userWordsStore !== null;
    }

    userWords() {
        return this.userWordsStore && this.language ? this.userWordsStore.list() : [];
    }

    removeWord(word) {
        if (!this.userWordsStore || !this.language || typeof word !== 'string') return false;

        return this.userWordsStore.remove(word.trim().toLowerCase());
    }

    clearUserWords() {
        if (this.userWordsStore && this.language) this.userWordsStore.clear();
    }

    enableUserWords(options) {
        if (this.userWordsStore) return;

        const source = options !== undefined ? options : (this.userWordsOptions ?? true);
        const normalized = normalizeUserWords(source);

        if (!normalized) return;

        this.userWordsOptions = normalized;
        this.userWordsStore = new UserWords(normalized);
        if (this.language) this.userWordsStore.setLanguage(this.language, wordCharsFor(this.language), compositionMinLength(this.language));
    }

    disableUserWords() {
        this.userWordsStore?.destroy();
        this.userWordsStore = null;
    }
}
