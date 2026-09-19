import { UserWords } from './user-words.js';
import { resolveWordList, parseWordList } from './word-lists.js';
import { NgramModel, fnv1a } from './ngrams.js';

const userWordsDefaults = {
    storagePrefix: 'suggest-engine',
    promoteThreshold: 2,
    maxWords: 300,
};

function normalizeUserWords(option) {
    if (!option) return null;

    const provided = option === true ? {} : option;

    return {
        storagePrefix: provided.storagePrefix ?? userWordsDefaults.storagePrefix,
        promoteThreshold: provided.promoteThreshold ?? userWordsDefaults.promoteThreshold,
        maxWords: provided.maxWords ?? userWordsDefaults.maxWords,
    };
}

function escapeForCharacterClass(chars) {
    return chars.replace(/[\\\]\^-]/g, '\\$&');
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
        // import.meta is unavailable in classic-script builds; callers pass a base URL instead.
    }

    return null;
}

export class SuggestEngine {
    constructor(options = {}) {
        this.language = String(options.language ?? 'en').toLowerCase();
        this.maxSuggestions = options.maxSuggestions ?? 5;
        this.wordBoundaryChars = options.wordBoundaryChars ?? "'-";
        this.boundaryRegex = new RegExp(`[^\\p{L}\\p{M}${escapeForCharacterClass(this.wordBoundaryChars)}]`, 'u');

        const userWordsOptions = normalizeUserWords(options.userWords);
        this.userWordsOptions = userWordsOptions;
        this.userWordsStore = userWordsOptions ? new UserWords(userWordsOptions) : null;
        this.userWordsStore?.setLanguage(this.language);

        this.sourcesByLanguage = {};
        this.ngramsByLanguage = {};
        this.ngramIndexes = {};
        this.bundledManifest = null;
    }

    setLanguage(language) {
        this.language = String(language || 'en').toLowerCase();
        this.userWordsStore?.setLanguage(this.language);
    }

    async addWordList(name, source) {
        const words = await resolveWordList(source);

        if (!this.sourcesByLanguage[this.language]) this.sourcesByLanguage[this.language] = {};

        this.sourcesByLanguage[this.language][name] = buildSource(words);
        delete this.ngramIndexes[this.language];
    }

    async loadBundledWordList(lang) {
        const language = String(lang || this.language).toLowerCase();

        if (!/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(language)) return false;

        if (!this.bundledManifest) {
            this.bundledManifest = (await import('../languages/index.js')).default;
        }

        const loader = this.bundledManifest[language];

        if (!loader) return false;

        const module = await loader();

        if (!this.sourcesByLanguage[language]) this.sourcesByLanguage[language] = {};

        this.sourcesByLanguage[language].bundled = buildSource(parseWordList(module.default));
        delete this.ngramIndexes[language];

        return true;
    }

    async addNgramModel(source) {
        let model = source;

        if (typeof source === 'string') {
            const response = await fetch(source);

            if (!response.ok) throw new Error(`Unable to fetch ${source}`);

            model = new NgramModel(await response.arrayBuffer());
        } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
            model = new NgramModel(source);
        }

        if (!(model instanceof NgramModel)) throw new TypeError('Unsupported ngram model source');

        this.ngramsByLanguage[this.language] = model;
        delete this.ngramIndexes[this.language];

        return true;
    }

    async loadBundledNgrams(baseUrl) {
        const language = this.language;

        if (!/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(language)) return false;

        const base = baseUrl ?? defaultNgramBase();

        if (!base) throw new Error('loadBundledNgrams requires a baseUrl (the URL of the languages/ directory)');

        const prefix = String(base).endsWith('/') ? base : `${base}/`;
        const response = await fetch(`${prefix}${language}.ngram.bin`);

        if (!response.ok) return false;

        this.ngramsByLanguage[language] = new NgramModel(await response.arrayBuffer());
        delete this.ngramIndexes[language];

        return true;
    }

    wordBefore(text, index) {
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

    wordsBefore(text, index, count = 2) {
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
            ? this.wordsBefore(context, context.length, 1)
            : [];

        return this.suggestInternal(word, previousWords);
    }

    suggestAt(text, caret) {
        const word = this.wordBefore(text, caret);
        const end = Math.min(caret ?? text.length, text.length) - word.length;

        return this.suggestInternal(word, this.wordsBefore(text, end, 1));
    }

    nextWords(context) {
        const previousWords = typeof context === 'string' && context.length
            ? this.wordsBefore(context, context.length, 1)
            : [];

        return this.nextWordsInternal(previousWords);
    }

    suggestInternal(word, previousWords) {
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
        const limit = this.maxSuggestions;
        const seen = new Set();
        const results = [];
        const index = previousWords.length ? this.ngramIndex(this.language) : null;

        if (index) {
            const id = index.ids.get(previousWords[0].toLowerCase());
            const slice = id === undefined ? null : index.model.bigram(id);

            if (slice) {
                for (let i = 0; i < slice.ids.length && results.length < limit; i ++) {
                    const successor = slice.ids[i];
                    const key = index.lowered[successor];

                    if (seen.has(key)) continue;

                    seen.add(key);
                    results.push({ text: index.words[successor], insertSuffix: index.words[successor], source: 'bundled' });
                }
            }
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
            console.warn(`suggest-engine: ngram model for "${language}" does not match the bundled word list; context ranking disabled`);
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

        const id = index.ids.get(previousWords[0].toLowerCase());

        if (id === undefined) return [];

        const slice = index.model.bigram(id);

        if (!slice) return [];

        const matches = [];

        for (let i = 0; i < slice.ids.length; i ++) {
            const successor = slice.ids[i];

            if (index.lowered[successor].startsWith(wanted)) matches.push(index.words[successor]);
        }

        return matches;
    }

    recordWord(word) {
        return this.userWordsStore ? this.userWordsStore.record(word) : false;
    }

    addWord(word) {
        return this.userWordsStore ? this.userWordsStore.add(word) : false;
    }

    get userWordsEnabled() {
        return this.userWordsStore !== null;
    }

    userWords() {
        return this.userWordsStore ? this.userWordsStore.list() : [];
    }

    removeUserWord(lower) {
        return this.userWordsStore ? this.userWordsStore.remove(lower) : false;
    }

    clearUserWords() {
        if (this.userWordsStore) this.userWordsStore.clear();
    }

    enableUserWords() {
        if (this.userWordsStore || !this.userWordsOptions) return;

        this.userWordsStore = new UserWords(this.userWordsOptions);
        this.userWordsStore.setLanguage(this.language);
    }

    disableUserWords() {
        this.userWordsStore?.destroy();
        this.userWordsStore = null;
    }
}
