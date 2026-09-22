import { UserWords } from './user-words.js';
import { resolveWordList, parseWordList, escapeForCharacterClass } from './word-lists.js';
import { NgramModel, fnv1a } from './ngrams.js';
import wordCharsByLanguage from '../languages/word-chars.js';

const userWordsDefaults = {
    storagePrefix: 'suggest-engine',
    recordAfter: 2,
    maxWords: 300,
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
        this.boundaryRegex = boundaryRegexFor(this.language);

        const userWordsOptions = normalizeUserWords(options.userWords);
        this.userWordsOptions = userWordsOptions;
        this.userWordsStore = userWordsOptions ? new UserWords(userWordsOptions) : null;
        if (this.language) this.userWordsStore?.setLanguage(this.language, wordCharsFor(this.language));

        this.sourcesByLanguage = {};
        this.ngramsByLanguage = {};
        this.ngramIndexes = {};
        this.bundledManifest = null;
    }

    setLanguage(language) {
        if (typeof language !== 'string' || !language.trim()) {
            throw new TypeError('setLanguage requires a language code');
        }

        this.language = language.trim().toLowerCase();
        this.boundaryRegex = boundaryRegexFor(this.language);
        this.userWordsStore?.setLanguage(this.language, wordCharsFor(this.language));
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

    wordAt(text, index) {
        if (typeof text !== 'string') return '';

        const end = Math.min(index ?? text.length, text.length);
        let start = 0;

        for (let i = end - 1; i >= 0; i --) {
            if (this.boundaryRegex.test(text.charAt(i))) {
                start = i + 1;
                break;
            }
        }

        return text.substring(start, end);
    }

    previousWords(text, index, count = 2) {
        if (typeof text !== 'string') return [];

        const words = [];
        let cursor = Math.min(index ?? text.length, text.length);

        while (words.length < count && cursor > 0) {
            while (cursor > 0 && this.boundaryRegex.test(text.charAt(cursor - 1))) cursor --;

            const end = cursor;

            while (cursor > 0 && !this.boundaryRegex.test(text.charAt(cursor - 1))) cursor --;

            if (end === cursor) break;

            words.push(text.substring(cursor, end));
        }

        return words;
    }

    suggest(word, context) {
        const previousWords = typeof context === 'string' && context.length
            ? this.previousWords(context, context.length, 2)
            : [];

        return this.suggestInternal(word, previousWords);
    }

    suggestAt(text, caret) {
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
        if (this.language) this.userWordsStore.setLanguage(this.language);
    }

    disableUserWords() {
        this.userWordsStore?.destroy();
        this.userWordsStore = null;
    }
}
