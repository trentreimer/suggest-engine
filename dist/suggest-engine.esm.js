// src/user-words.js
var UserWords = class {
  constructor({ storagePrefix = "suggest-engine", promoteThreshold = 2, maxWords = 300 } = {}) {
    this.storageKey = `${storagePrefix}:personal-words`;
    this.promoteThreshold = promoteThreshold;
    this.maxWords = maxWords;
    this.validWordRegex = /^[\p{L}\p{M}'\-]+$/u;
    this.language = "en";
    this.data = null;
    this.storageAvailable = true;
  }
  setLanguage(language) {
    this.language = String(language || "en").toLowerCase();
  }
  ensureLoaded() {
    if (this.data) return;
    this.data = { version: 1, languages: {} };
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.version === 1 && parsed.languages && typeof parsed.languages === "object") {
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
    if (typeof word !== "string") return false;
    const trimmed = word.trim();
    if (trimmed.length < 2) return false;
    if (!this.validWordRegex.test(trimmed)) return false;
    const bucket = this.bucket();
    const key = trimmed.toLowerCase();
    const now = Date.now();
    if (bucket[key]) {
      bucket[key].count++;
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
    if (!bucket || typeof prefix !== "string") return [];
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
    return matches.map((entry) => entry.word);
  }
  list() {
    this.ensureLoaded();
    const bucket = this.data.languages[this.language];
    if (!bucket) return [];
    return Object.values(bucket).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).map((entry) => ({ word: entry.word, count: entry.count }));
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
};

// src/word-lists.js
function parseWordList(text) {
  const words = [];
  if (typeof text !== "string") return words;
  for (const line of text.split("\n")) {
    const word = line.trim().replaceAll("\u02BC", "'").replaceAll("\u2019", "'").replace(/[^\p{L}\p{M}\p{N}'\-].*$/u, "");
    if (word.length > 1) words.push(word);
  }
  return words;
}
async function resolveWordList(source) {
  if (Array.isArray(source)) return dedupe(parseWordList(source.join("\n")));
  if (source && typeof source === "object" && typeof source.text === "string") {
    return dedupe(parseWordList(source.text));
  }
  if (typeof source === "string") {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Unable to fetch ${source}`);
    return dedupe(parseWordList(await response.text()));
  }
  throw new TypeError("Unsupported word list source");
}
function dedupe(words) {
  return [...new Set(words)];
}

// src/engine.js
var userWordsDefaults = {
  storagePrefix: "suggest-engine",
  promoteThreshold: 2,
  maxWords: 300
};
function normalizeUserWords(option) {
  if (!option) return null;
  const provided = option === true ? {} : option;
  return {
    storagePrefix: provided.storagePrefix ?? userWordsDefaults.storagePrefix,
    promoteThreshold: provided.promoteThreshold ?? userWordsDefaults.promoteThreshold,
    maxWords: provided.maxWords ?? userWordsDefaults.maxWords
  };
}
function escapeForCharacterClass(chars) {
  return chars.replace(/[\\\]\^-]/g, "\\$&");
}
var SuggestEngine = class {
  constructor(options = {}) {
    this.language = String(options.language ?? "en").toLowerCase();
    this.maxSuggestions = options.maxSuggestions ?? 5;
    this.wordBoundaryChars = options.wordBoundaryChars ?? "'-";
    this.boundaryRegex = new RegExp(`[^\\p{L}\\p{M}${escapeForCharacterClass(this.wordBoundaryChars)}]`, "u");
    const userWordsOptions = normalizeUserWords(options.userWords);
    this.userWordsOptions = userWordsOptions;
    this.userWords = userWordsOptions ? new UserWords(userWordsOptions) : null;
    this.userWords?.setLanguage(this.language);
    this.sourcesByLanguage = {};
    this.bundledManifest = null;
  }
  setLanguage(language) {
    this.language = String(language || "en").toLowerCase();
    this.userWords?.setLanguage(this.language);
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
      this.bundledManifest = (await import("./chunks/data-QDXGNWN2.js")).default;
    }
    const loader = this.bundledManifest[language];
    if (!loader) return false;
    const module = await loader();
    if (!this.sourcesByLanguage[language]) this.sourcesByLanguage[language] = {};
    this.sourcesByLanguage[language].bundled = parseWordList(module.default);
    return true;
  }
  wordBefore(text, index) {
    if (typeof text !== "string") return "";
    const end = Math.min(index ?? text.length, text.length);
    let start = 0;
    for (let i = end - 1; i >= 0; i--) {
      if (this.boundaryRegex.test(text.charAt(i))) {
        start = i + 1;
        break;
      }
    }
    return text.substring(start, end);
  }
  suggest(word) {
    if (typeof word !== "string" || word.length === 0) return [];
    const wanted = word.toLowerCase();
    const seen = /* @__PURE__ */ new Set();
    const results = [];
    const addSuggestion = function(full, source) {
      if (full.length <= word.length) return;
      if (full.substring(0, word.length).toLowerCase() !== wanted) return;
      const key = full.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ text: full, insertSuffix: full.substring(word.length), source });
    };
    if (this.userWords) {
      for (const full of this.userWords.suggestionsFor(word)) {
        addSuggestion(full, "personal");
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
    return this.userWords ? this.userWords.record(word) : false;
  }
  addWord(word) {
    return this.userWords ? this.userWords.add(word) : false;
  }
  personalWords() {
    return this.userWords ? this.userWords.list() : [];
  }
  removePersonalWord(lower) {
    return this.userWords ? this.userWords.remove(lower) : false;
  }
  clearPersonalWords() {
    if (this.userWords) this.userWords.clear();
  }
  enableUserWords() {
    if (this.userWords || !this.userWordsOptions) return;
    this.userWords = new UserWords(this.userWordsOptions);
    this.userWords.setLanguage(this.language);
  }
  disableUserWords() {
    this.userWords?.destroy();
    this.userWords = null;
  }
};
export {
  SuggestEngine,
  UserWords,
  parseWordList,
  resolveWordList
};
