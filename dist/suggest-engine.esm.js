// src/user-words.js
var UserWords = class {
  constructor({ storagePrefix = "suggest-engine", promoteThreshold = 2, maxWords = 300 } = {}) {
    this.storageKey = `${storagePrefix}:user-words`;
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

// src/ngrams.js
var NGRAM_MAGIC = 1196311891;
var NGRAM_VERSION = 1;
var NGRAM_BIGRAM_SECTION = 1;
var NGRAM_TRIGRAM_SECTION = 2;
var SECTION_ENTRY_BYTES = 10;
function fnv1a(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
var NgramModel = class {
  constructor(buffer) {
    if (ArrayBuffer.isView(buffer)) {
      buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    if (!(buffer instanceof ArrayBuffer)) throw new TypeError("NgramModel expects an ArrayBuffer");
    this.buffer = buffer;
    this.language = "";
    this.vocabHash = 0;
    this.contextCount = 0;
    this.entryCount = 0;
    this.contexts = null;
    this.offsets = null;
    this.successorIds = null;
    this.counts = null;
    this.trigramContextCount = 0;
    this.trigramEntryCount = 0;
    this.trigramKeys = null;
    this.trigramOffsets = null;
    this.trigramSuccessorIds = null;
    this.trigramCounts = null;
    this.parseHeader();
    this.parseSections();
  }
  parseHeader() {
    if (this.buffer.byteLength < 19) throw new Error("Invalid ngram model: truncated header");
    const view = new DataView(this.buffer);
    if (view.getUint32(0, true) !== NGRAM_MAGIC) throw new Error("Invalid ngram model: bad magic");
    const version = view.getUint16(4, true);
    if (version !== NGRAM_VERSION) throw new Error(`Unsupported ngram model version: ${version}`);
    const languageLength = view.getUint8(6);
    let cursor = 7;
    if (cursor + languageLength + 6 > this.buffer.byteLength) throw new Error("Invalid ngram model: truncated header");
    let language = "";
    for (let i = 0; i < languageLength; i++) language += String.fromCharCode(view.getUint8(cursor + i));
    cursor += languageLength;
    this.language = language;
    this.vocabHash = view.getUint32(cursor, true);
    this.sectionTableOffset = cursor + 6;
    this.sectionCount = view.getUint16(cursor + 4, true);
  }
  parseSections() {
    const view = new DataView(this.buffer);
    const tableEnd = this.sectionTableOffset + this.sectionCount * SECTION_ENTRY_BYTES;
    if (tableEnd > this.buffer.byteLength) throw new Error("Invalid ngram model: truncated section table");
    for (let i = 0; i < this.sectionCount; i++) {
      const entry = this.sectionTableOffset + i * SECTION_ENTRY_BYTES;
      const id = view.getUint8(entry);
      const offset = view.getUint32(entry + 2, true);
      const length = view.getUint32(entry + 6, true);
      if (offset % 4 !== 0 || offset + length > this.buffer.byteLength) {
        throw new Error("Invalid ngram model: section out of bounds");
      }
      if (id === NGRAM_BIGRAM_SECTION) this.parseBigramSection(offset, length);
      else if (id === NGRAM_TRIGRAM_SECTION) this.parseTrigramSection(offset, length);
    }
  }
  parseBigramSection(offset, length) {
    if (length < 8) throw new Error("Invalid ngram model: truncated bigram section");
    const view = new DataView(this.buffer);
    const contextCount = view.getUint32(offset, true);
    const entryCount = view.getUint32(offset + 4, true);
    const contextsStart = offset + 8;
    const offsetsStart = contextsStart + contextCount * 2 + contextCount % 2 * 2;
    const successorsStart = offsetsStart + (contextCount + 1) * 4;
    const countsStart = successorsStart + entryCount * 2;
    if (countsStart + entryCount * 2 > offset + length) throw new Error("Invalid ngram model: truncated bigram section");
    this.contextCount = contextCount;
    this.entryCount = entryCount;
    this.contexts = new Uint16Array(this.buffer, contextsStart, contextCount);
    this.offsets = new Uint32Array(this.buffer, offsetsStart, contextCount + 1);
    this.successorIds = new Uint16Array(this.buffer, successorsStart, entryCount);
    this.counts = new Uint16Array(this.buffer, countsStart, entryCount);
  }
  bigram(id) {
    const contexts = this.contexts;
    if (!contexts || !Number.isInteger(id)) return null;
    let low = 0;
    let high = contexts.length - 1;
    while (low <= high) {
      const mid = low + high >> 1;
      const value = contexts[mid];
      if (value === id) {
        const start = this.offsets[mid];
        const end = this.offsets[mid + 1];
        return { ids: this.successorIds.subarray(start, end), counts: this.counts.subarray(start, end) };
      }
      if (value < id) low = mid + 1;
      else high = mid - 1;
    }
    return null;
  }
  parseTrigramSection(offset, length) {
    if (length < 8) throw new Error("Invalid ngram model: truncated trigram section");
    const view = new DataView(this.buffer);
    const contextCount = view.getUint32(offset, true);
    const entryCount = view.getUint32(offset + 4, true);
    const keysStart = offset + 8;
    const offsetsStart = keysStart + contextCount * 4;
    const successorsStart = offsetsStart + (contextCount + 1) * 4;
    const countsStart = successorsStart + entryCount * 2;
    if (countsStart + entryCount * 2 > offset + length) throw new Error("Invalid ngram model: truncated trigram section");
    this.trigramContextCount = contextCount;
    this.trigramEntryCount = entryCount;
    this.trigramKeys = new Uint16Array(this.buffer, keysStart, contextCount * 2);
    this.trigramOffsets = new Uint32Array(this.buffer, offsetsStart, contextCount + 1);
    this.trigramSuccessorIds = new Uint16Array(this.buffer, successorsStart, entryCount);
    this.trigramCounts = new Uint16Array(this.buffer, countsStart, entryCount);
  }
  trigram(first, second) {
    const keys = this.trigramKeys;
    if (!keys || !Number.isInteger(first) || !Number.isInteger(second)) return null;
    let low = 0;
    let high = this.trigramContextCount - 1;
    while (low <= high) {
      const mid = low + high >> 1;
      const a = keys[mid * 2];
      const b = keys[mid * 2 + 1];
      if (a === first && b === second) {
        const start = this.trigramOffsets[mid];
        const end = this.trigramOffsets[mid + 1];
        return { ids: this.trigramSuccessorIds.subarray(start, end), counts: this.trigramCounts.subarray(start, end) };
      }
      if (a < first || a === first && b < second) low = mid + 1;
      else high = mid - 1;
    }
    return null;
  }
};

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
function buildSource(words) {
  const lowered = new Array(words.length);
  const buckets = /* @__PURE__ */ new Map();
  for (let i = 0; i < words.length; i++) {
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
    if (typeof import.meta !== "undefined" && import.meta.url) {
      return new URL("../languages/", import.meta.url).href;
    }
  } catch (err) {
  }
  return null;
}
var SuggestEngine = class {
  constructor(options = {}) {
    this.language = String(options.language ?? "en").toLowerCase();
    this.maxSuggestions = options.maxSuggestions ?? 5;
    this.wordBoundaryChars = options.wordBoundaryChars ?? "'-";
    this.boundaryRegex = new RegExp(`[^\\p{L}\\p{M}${escapeForCharacterClass(this.wordBoundaryChars)}]`, "u");
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
    this.language = String(language || "en").toLowerCase();
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
      this.bundledManifest = (await import("./chunks/languages-QH2C23FT.js")).default;
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
    if (typeof source === "string") {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Unable to fetch ${source}`);
      model = new NgramModel(await response.arrayBuffer());
    } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
      model = new NgramModel(source);
    }
    if (!(model instanceof NgramModel)) throw new TypeError("Unsupported ngram model source");
    this.ngramsByLanguage[this.language] = model;
    delete this.ngramIndexes[this.language];
    return true;
  }
  async loadBundledNgrams(baseUrl) {
    const language = this.language;
    if (!/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(language)) return false;
    const base = baseUrl ?? defaultNgramBase();
    if (!base) throw new Error("loadBundledNgrams requires a baseUrl (the URL of the languages/ directory)");
    const prefix = String(base).endsWith("/") ? base : `${base}/`;
    const response = await fetch(`${prefix}${language}.ngram.bin`);
    if (!response.ok) return false;
    this.ngramsByLanguage[language] = new NgramModel(await response.arrayBuffer());
    delete this.ngramIndexes[language];
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
  wordsBefore(text, index, count = 2) {
    if (typeof text !== "string") return [];
    const words = [];
    let cursor = Math.min(index ?? text.length, text.length);
    while (words.length < count && cursor > 0) {
      while (cursor > 0 && this.boundaryRegex.test(text.charAt(cursor - 1))) cursor--;
      const end = cursor;
      while (cursor > 0 && !this.boundaryRegex.test(text.charAt(cursor - 1))) cursor--;
      if (end === cursor) break;
      words.push(text.substring(cursor, end));
    }
    return words;
  }
  suggest(word, context) {
    const previousWords = typeof context === "string" && context.length ? this.wordsBefore(context, context.length, 2) : [];
    return this.suggestInternal(word, previousWords);
  }
  suggestAt(text, caret) {
    const word = this.wordBefore(text, caret);
    const end = Math.min(caret ?? text.length, text.length) - word.length;
    return this.suggestInternal(word, this.wordsBefore(text, end, 2));
  }
  nextWords(context) {
    const previousWords = typeof context === "string" && context.length ? this.wordsBefore(context, context.length, 2) : [];
    return this.nextWordsInternal(previousWords);
  }
  suggestInternal(word, previousWords) {
    if (typeof word !== "string" || word.length === 0) return [];
    const wanted = word.toLowerCase();
    const limit = this.maxSuggestions;
    const seen = /* @__PURE__ */ new Set();
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
      for (const full of this.contextMatches(wanted, previousWords)) addSuggestion(full, "bundled");
    }
    if (this.userWordsStore) {
      for (const full of this.userWordsStore.suggestionsFor(word)) addSuggestion(full, "user-words");
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
    const seen = /* @__PURE__ */ new Set();
    const results = [];
    const index = previousWords.length ? this.ngramIndex(this.language) : null;
    if (index) {
      const collect = (slice) => {
        if (!slice) return;
        for (let i = 0; i < slice.ids.length && results.length < limit; i++) {
          const successor = slice.ids[i];
          const key = index.lowered[successor];
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({ text: index.words[successor], insertSuffix: index.words[successor], source: "bundled" });
        }
      };
      const previousId = index.ids.get(previousWords[0].toLowerCase());
      if (previousWords.length >= 2) {
        const first = index.ids.get(previousWords[1].toLowerCase());
        if (first !== void 0 && previousId !== void 0) collect(index.model.trigram(first, previousId));
      }
      if (previousId !== void 0) collect(index.model.bigram(previousId));
    }
    if (this.userWordsStore) {
      for (const entry of this.userWordsStore.list()) {
        if (results.length >= limit) break;
        const key = entry.word.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ text: entry.word, insertSuffix: entry.word, source: "user-words" });
      }
    }
    return results;
  }
  ngramIndex(language) {
    const cached = this.ngramIndexes[language];
    if (cached !== void 0) return cached;
    const model = this.ngramsByLanguage[language];
    const source = this.sourcesByLanguage[language]?.bundled;
    if (!model || !source) return null;
    const hash = fnv1a(source.words.join("\n"));
    if (hash !== model.vocabHash) {
      console.warn(`suggest-engine: ngram model for "${language}" does not match the bundled word list; context ranking disabled`);
      this.ngramIndexes[language] = null;
      return null;
    }
    const ids = /* @__PURE__ */ new Map();
    for (let i = 0; i < source.words.length; i++) {
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
    const seen = /* @__PURE__ */ new Set();
    const collect = (slice) => {
      if (!slice) return;
      for (let i = 0; i < slice.ids.length; i++) {
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
      if (first !== void 0 && previousId !== void 0) collect(index.model.trigram(first, previousId));
    }
    if (previousId !== void 0) collect(index.model.bigram(previousId));
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
};
export {
  NgramModel,
  SuggestEngine,
  UserWords,
  parseWordList,
  resolveWordList
};
