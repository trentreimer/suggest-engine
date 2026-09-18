import { UserWords } from './user-words.js';
import { resolveWordList, parseWordList } from './word-lists.js';

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
        this.bundledManifest = null;
    }

    setLanguage(language) {
        this.language = String(language || 'en').toLowerCase();
        this.userWordsStore?.setLanguage(this.language);
    }

    async addWordList(name, source) {
        const words = await resolveWordList(source);

        if (!this.sourcesByLanguage[this.language]) this.sourcesByLanguage[this.language] = {};

        this.sourcesByLanguage[this.language][name] = words;
    }

    async loadBundledWordList(lang) {
        const language = String(lang || this.language).toLowerCase();

        if (!/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(language)) return false;

        if (!this.bundledManifest) {
            this.bundledManifest = (await import('../data/index.js')).default;
        }

        const loader = this.bundledManifest[language];

        if (!loader) return false;

        const module = await loader();

        if (!this.sourcesByLanguage[language]) this.sourcesByLanguage[language] = {};

        this.sourcesByLanguage[language].bundled = parseWordList(module.default);

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

    suggest(word) {
        if (typeof word !== 'string' || word.length === 0) return [];

        const wanted = word.toLowerCase();
        const seen = new Set();
        const results = [];

        const addSuggestion = function(full, source) {
            if (full.length <= word.length) return;
            if (full.substring(0, word.length).toLowerCase() !== wanted) return;

            const key = full.toLowerCase();

            if (seen.has(key)) return;
            seen.add(key);
            results.push({ text: full, insertSuffix: full.substring(word.length), source });
        };

        if (this.userWordsStore) {
            for (const full of this.userWordsStore.suggestionsFor(word)) {
                addSuggestion(full, 'user-words');
            }
        }

        const library = [];

        for (const [name, words] of Object.entries(this.sourcesByLanguage[this.language] || {})) {
            for (const full of words) {
                if (full.length > word.length && full.substring(0, word.length).toLowerCase() === wanted) {
                    library.push({ full, name });
                }
            }
        }

        for (const { full, name } of library) {
            addSuggestion(full, name);
        }

        return results.slice(0, this.maxSuggestions);
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
