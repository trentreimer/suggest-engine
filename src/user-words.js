import { escapeForCharacterClass } from './word-lists.js';

// Manual casings win over auto-capitalized recordings: a capitalized word that
// the host flagged as auto-capitalized makes no casing claim, so "Hi" learned
// at sentence starts is suggested as "hi", while "John" typed mid-sentence
// (a manual capital) sticks no matter how often it later starts a sentence.
function dominantCasing(entry, key) {
    let best = key;
    let bestCount = 0;
    let bestLast = 0;

    for (const [variant, stats] of Object.entries(entry.variants || {})) {
        if (stats.count > bestCount || (stats.count === bestCount && stats.last >= bestLast)) {
            best = variant;
            bestCount = stats.count;
            bestLast = stats.last;
        }
    }

    return best;
}

function migrateEntries(languages) {
    for (const bucket of Object.values(languages)) {
        if (!bucket || typeof bucket !== 'object') continue;

        for (const [key, entry] of Object.entries(bucket)) {
            if (!entry || typeof entry !== 'object') continue;
            if (entry.variants && typeof entry.variants === 'object') continue;

            entry.variants = {};

            // Historical casings predate the auto/manual distinction. A plain
            // leading capital is assumed to be sentence-start auto-capitalization
            // (the old last-wins behavior), so it makes no casing claim; other
            // patterns (McDonald, HELLO, iPhone) stay as manual variants.
            if (typeof entry.word === 'string' && entry.word && !/^\p{Lu}[^\p{Lu}]*$/u.test(entry.word)) {
                entry.variants[entry.word] = { count: entry.count || 1, last: entry.last || 0 };
            }

            entry.word = dominantCasing(entry, key);
        }
    }
}

export class UserWords {
    constructor({ storagePrefix = 'suggest-engine', recordAfter = 2, maxWords = 300 } = {}) {
        this.storageKey = `${storagePrefix}:user-words`;
        this.recordAfter = recordAfter;
        this.maxWords = maxWords;
        this.language = 'en';
        this.minLength = 2;
        this.data = null;
        this.storageAvailable = true;
        this.setLanguage(this.language);
    }

    setLanguage(language, extraChars = '', minLength = 2) {
        this.language = String(language || 'en').toLowerCase();
        this.minLength = minLength;
        this.validWordRegex = new RegExp(`^[\\p{L}\\p{M}'\\-${escapeForCharacterClass(extraChars)}]+$`, 'u');
    }

    ensureLoaded() {
        if (this.data) return;

        this.data = { version: 1, languages: {} };

        try {
            const raw = localStorage.getItem(this.storageKey);

            if (raw) {
                const parsed = JSON.parse(raw);

                if (parsed && typeof parsed === 'object' && parsed.version === 1 && parsed.languages && typeof parsed.languages === 'object') {
                    this.data = parsed;
                    migrateEntries(parsed.languages);
                }
            }
        } catch (err) {
            this.storageAvailable = false;
        }
    }

    write() {
        if (!this.storageAvailable) return;

        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.data));
        } catch (err) {
            this.storageAvailable = false;
        }
    }

    bucket() {
        this.ensureLoaded();

        if (!this.data.languages[this.language]) this.data.languages[this.language] = {};

        return this.data.languages[this.language];
    }

    record(word, options = {}) {
        if (typeof word !== 'string') return false;

        const trimmed = word.trim();

        if (trimmed.length < this.minLength) return false;
        if (!this.validWordRegex.test(trimmed)) return false;

        const bucket = this.bucket();
        const key = trimmed.toLowerCase();
        const now = Date.now();
        let entry = bucket[key];

        if (!entry) {
            entry = bucket[key] = { word: key, count: 0, last: now, variants: {} };
            this.evict(bucket);
        }

        entry.count ++;
        entry.last = now;

        const autoCased = options.autoCapitalized === true && /^\p{Lu}[^\p{Lu}]*$/u.test(trimmed);

        if (!autoCased) {
            if (!entry.variants[trimmed]) entry.variants[trimmed] = { count: 0, last: now };

            entry.variants[trimmed].count ++;
            entry.variants[trimmed].last = now;
        }

        entry.word = dominantCasing(entry, key);

        this.write();
        return true;
    }

    add(word) {
        if (!this.record(word)) return false;

        const bucket = this.bucket();
        const entry = bucket[word.trim().toLowerCase()];

        if (entry && entry.count < this.recordAfter) {
            entry.count = this.recordAfter;
            entry.last = Date.now();
            this.write();
        }

        return true;
    }

    suggestionsFor(prefix) {
        this.ensureLoaded();

        const bucket = this.data.languages[this.language];

        if (!bucket || typeof prefix !== 'string') return [];

        const wanted = prefix.toLowerCase();
        const matches = [];

        for (const key of Object.keys(bucket)) {
            const entry = bucket[key];

            if (entry.count < this.recordAfter) continue;
            if (key.length <= wanted.length) continue;
            if (!key.startsWith(wanted)) continue;

            matches.push(entry);
        }

        matches.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));

        return matches.map(entry => entry.word);
    }

    list() {
        this.ensureLoaded();

        const bucket = this.data.languages[this.language];

        if (!bucket) return [];

        return Object.values(bucket)
            .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
            .map(entry => ({ word: entry.word, count: entry.count }));
    }

    remove(lower) {
        this.ensureLoaded();

        const bucket = this.data.languages[this.language];

        if (!bucket || !bucket[lower]) return false;

        delete bucket[lower];
        this.write();
        return true;
    }

    clear() {
        this.ensureLoaded();

        delete this.data.languages[this.language];
        this.write();
    }

    destroy() {
        if (this.data) this.data = null;

        if (this.storageAvailable) {
            try {
                localStorage.removeItem(this.storageKey);
            } catch (err) {
                this.storageAvailable = false;
            }
        }
    }

    evict(bucket) {
        const keys = Object.keys(bucket);

        if (keys.length <= this.maxWords) return;

        keys.sort((a, b) => bucket[a].count - bucket[b].count || bucket[a].last - bucket[b].last);

        while (keys.length > this.maxWords) {
            delete bucket[keys.shift()];
        }
    }
}
