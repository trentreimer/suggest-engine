export class UserWords {
    constructor({ storagePrefix = 'suggest-engine', promoteThreshold = 2, maxWords = 300 } = {}) {
        this.storageKey = `${storagePrefix}:user-words`;
        this.promoteThreshold = promoteThreshold;
        this.maxWords = maxWords;
        this.validWordRegex = /^[\p{L}\p{M}'\-]+$/u;
        this.language = 'en';
        this.data = null;
        this.storageAvailable = true;
    }

    setLanguage(language) {
        this.language = String(language || 'en').toLowerCase();
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

    record(word) {
        if (typeof word !== 'string') return false;

        const trimmed = word.trim();

        if (trimmed.length < 2) return false;
        if (!this.validWordRegex.test(trimmed)) return false;

        const bucket = this.bucket();
        const key = trimmed.toLowerCase();
        const now = Date.now();

        if (bucket[key]) {
            bucket[key].count ++;
            bucket[key].last = now;
            bucket[key].word = trimmed;
        } else {
            bucket[key] = { word: trimmed, count: 1, last: now };
            this.evict(bucket);
        }

        this.write();
        return true;
    }

    add(word) {
        if (!this.record(word)) return false;

        const bucket = this.bucket();
        const entry = bucket[word.trim().toLowerCase()];

        if (entry && entry.count < this.promoteThreshold) {
            entry.count = this.promoteThreshold;
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

            if (entry.count < this.promoteThreshold) continue;
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
