// src/word-lists.js
function parseWordList(text, extraChars = "") {
  const words = [];
  if (typeof text !== "string") return words;
  const truncation = new RegExp(`[^\\p{L}\\p{M}\\p{N}'\\-${escapeForCharacterClass(extraChars)}].*$`, "u");
  for (const line of text.split("\n")) {
    const word = line.trim().replaceAll("\u02BC", "'").replaceAll("\u2019", "'").replace(truncation, "");
    if (word.length > 1) words.push(word);
  }
  return words;
}
async function resolveWordList(source, extraChars = "") {
  if (Array.isArray(source)) return dedupe(parseWordList(source.join("\n"), extraChars));
  if (source && typeof source === "object" && typeof source.text === "string") {
    return dedupe(parseWordList(source.text, extraChars));
  }
  if (typeof source === "string") {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Unable to fetch ${source}`);
    return dedupe(parseWordList(await response.text(), extraChars));
  }
  throw new TypeError("Unsupported word list source");
}
function escapeForCharacterClass(chars) {
  return chars.replace(/[\\\]\^-]/g, "\\$&");
}
function dedupe(words) {
  return [...new Set(words)];
}

// src/user-words.js
var UserWords = class {
  constructor({ storagePrefix = "suggest-engine", recordAfter = 2, maxWords = 300 } = {}) {
    this.storageKey = `${storagePrefix}:user-words`;
    this.recordAfter = recordAfter;
    this.maxWords = maxWords;
    this.language = "en";
    this.minLength = 2;
    this.data = null;
    this.storageAvailable = true;
    this.setLanguage(this.language);
  }
  setLanguage(language, extraChars = "", minLength = 2) {
    this.language = String(language || "en").toLowerCase();
    this.minLength = minLength;
    this.validWordRegex = new RegExp(`^[\\p{L}\\p{M}'\\-${escapeForCharacterClass(extraChars)}]+$`, "u");
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
    if (trimmed.length < this.minLength) return false;
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
    if (!bucket || typeof prefix !== "string") return [];
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

// languages/word-chars.js
var word_chars_default = {
  fa: "\u200C",
  mr: "\u200D"
};

// languages/compositions.js
var compositions_default = {
  ja: { reading: "kana", load: () => import("./chunks/ja-S7I5ANBQ.js") },
  zh: { reading: "pinyin", load: () => import("./chunks/zh-Z74ITQ5A.js") }
};

// languages/segmenters.js
var segmenters_default = {
  th: "th"
};

// src/composition.js
function kataToHira(text) {
  return text.replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 96));
}
function normalizeReading(text) {
  return kataToHira(String(text ?? "").normalize("NFC").toLowerCase().replaceAll(" ", ""));
}
var t9DigitKeys = {
  a: "2",
  b: "2",
  c: "2",
  d: "3",
  e: "3",
  f: "3",
  g: "4",
  h: "4",
  i: "4",
  j: "5",
  k: "5",
  l: "5",
  m: "6",
  n: "6",
  o: "6",
  p: "7",
  q: "7",
  r: "7",
  s: "7",
  t: "8",
  u: "8",
  v: "8",
  w: "9",
  x: "9",
  y: "9",
  z: "9"
};
function readingToDigits(reading) {
  let digits = "";
  for (const char of reading) {
    const digit = t9DigitKeys[char];
    if (!digit) return null;
    digits += digit;
  }
  return digits;
}
function isReadingLike(text, reading) {
  if (typeof text !== "string" || !text.length) return false;
  return reading === "kana" ? /^[\p{Script=Hiragana}\p{Script=Katakana}\u30FC]+$/u.test(text) : /^[a-z]+$/.test(text);
}
function parseComposition(text, reading) {
  const entries = [];
  const exact = /* @__PURE__ */ new Map();
  const readingByCandidate = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  const vocab = [];
  for (const line of String(text ?? "").split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const key = normalizeReading(parts[0]);
    const candidates = parts.slice(1);
    if (!key) continue;
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(...candidates);
    entries.push({ reading: key, candidates });
    for (const candidate of candidates) {
      if (!readingByCandidate.has(candidate)) readingByCandidate.set(candidate, key);
      if (!seen.has(candidate)) {
        seen.add(candidate);
        vocab.push(candidate);
      }
    }
  }
  return { reading, entries, exact, readingByCandidate, vocab };
}
function compositionCandidates(composition, buffer) {
  const seen = /* @__PURE__ */ new Set();
  const candidates = [];
  const push = (text) => {
    if (!seen.has(text)) {
      seen.add(text);
      candidates.push(text);
    }
  };
  if (!composition || typeof buffer !== "string" || !buffer.length) return candidates;
  if (/^\d+$/.test(buffer)) {
    for (const entry of composition.entries) {
      const digits = readingToDigits(entry.reading);
      if (digits !== null && digits.startsWith(buffer)) for (const text of entry.candidates) push(text);
    }
    return candidates;
  }
  const wanted = normalizeReading(buffer);
  if (!wanted) return candidates;
  for (const text of composition.exact.get(wanted) || []) push(text);
  for (const entry of composition.entries) {
    if (entry.reading.startsWith(wanted)) for (const text of entry.candidates) push(text);
  }
  return candidates;
}
var voicedPairs = [
  ["\u304B\u304D\u304F\u3051\u3053", "\u304C\u304E\u3050\u3052\u3054"],
  ["\u3055\u3057\u3059\u305B\u305D", "\u3056\u3058\u305A\u305C\u305E"],
  ["\u305F\u3061\u3064\u3066\u3068", "\u3060\u3062\u3065\u3067\u3069"],
  ["\u306F\u3072\u3075\u3078\u307B", "\u3070\u3073\u3076\u3079\u307C"],
  ["\u30AB\u30AD\u30AF\u30B1\u30B3", "\u30AC\u30AE\u30B0\u30B2\u30B4"],
  ["\u30B5\u30B7\u30B9\u30BB\u30BD", "\u30B6\u30B8\u30BA\u30BC\u30BE"],
  ["\u30BF\u30C1\u30C4\u30C6\u30C8", "\u30C0\u30C2\u30C5\u30C7\u30C9"],
  ["\u30CF\u30D2\u30D5\u30D8\u30DB", "\u30D0\u30D3\u30D6\u30D9\u30DC"],
  ["\u30A6", "\u30F4"]
];
var semiVoicedPairs = [
  ["\u306F\u3072\u3075\u3078\u307B", "\u3071\u3074\u3077\u307A\u307D"],
  ["\u30CF\u30D2\u30D5\u30D8\u30DB", "\u30D1\u30D4\u30D7\u30DA\u30DD"]
];
var dakutenForward = /* @__PURE__ */ new Map();
var dakutenBackward = /* @__PURE__ */ new Map();
var semiVoicedForward = /* @__PURE__ */ new Map();
var semiVoicedBackward = /* @__PURE__ */ new Map();
for (const [base, voiced] of voicedPairs) {
  for (let i = 0; i < base.length; i++) {
    dakutenForward.set(base[i], voiced[i]);
    dakutenBackward.set(voiced[i], base[i]);
  }
}
for (const [base, voiced] of semiVoicedPairs) {
  for (let i = 0; i < base.length; i++) {
    semiVoicedForward.set(base[i], voiced[i]);
    semiVoicedBackward.set(voiced[i], base[i]);
  }
}
function voiceKanaChar(char, mark) {
  const backward = mark === "\u309C" ? semiVoicedBackward : dakutenBackward;
  const forward = mark === "\u309C" ? semiVoicedForward : dakutenForward;
  if (backward.has(char)) return backward.get(char);
  if (forward.has(char)) return forward.get(char);
  return null;
}

// src/engine.js
var userWordsDefaults = {
  storagePrefix: "suggest-engine",
  recordAfter: 2,
  maxWords: 300
};
var cjkCharClass = {
  kana: "[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30FC]",
  pinyin: "[\\p{Script=Han}]"
};
function normalizeUserWords(option) {
  if (!option) return null;
  const provided = option === true ? {} : option;
  return {
    storagePrefix: provided.storagePrefix ?? userWordsDefaults.storagePrefix,
    recordAfter: provided.recordAfter ?? userWordsDefaults.recordAfter,
    maxWords: provided.maxWords ?? userWordsDefaults.maxWords
  };
}
function wordCharsFor(language) {
  return language && word_chars_default[language] || "";
}
function segmenterFor(language) {
  const locale = language && segmenters_default[language];
  if (!locale || typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return null;
  return new Intl.Segmenter(locale, { granularity: "word" });
}
function compositionMinLength(language) {
  return compositions_default[language] ? 1 : 2;
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
    if (typeof language !== "string" || !language.trim()) {
      throw new TypeError("setLanguage requires a language code");
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
    const kind = compositions_default[language]?.reading;
    const nonWord = `[^\\p{L}\\p{M}'\\-${escapeForCharacterClass(wordCharsFor(language))}]`;
    this.compositionCharRegex = null;
    this.segmenter = segmenterFor(language);
    if (kind) {
      this.compositionCharRegex = new RegExp(cjkCharClass[kind], "u");
      this.boundaryRegex = new RegExp(`(?:${nonWord}|${this.compositionCharRegex.source})`, "u");
      this.separatorRegex = new RegExp(nonWord, "u");
    } else {
      this.boundaryRegex = new RegExp(nonWord, "u");
      this.separatorRegex = null;
    }
  }
  async addWordList(name, source) {
    if (!this.language) throw new Error("Set a language with setLanguage() before adding word lists");
    const words = await resolveWordList(source, wordCharsFor(this.language));
    if (!this.sourcesByLanguage[this.language]) this.sourcesByLanguage[this.language] = {};
    this.sourcesByLanguage[this.language][name] = buildSource(words);
    delete this.ngramIndexes[this.language];
  }
  async loadWordList(lang) {
    const language = String(lang || this.language).toLowerCase();
    if (!/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(language)) return false;
    if (!this.bundledManifest) {
      this.bundledManifest = (await import("./chunks/languages-HQVHSWLI.js")).default;
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
    if (!this.language) throw new Error("Set a language with setLanguage() before adding a context model");
    let model = source;
    if (typeof source === "string") {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Unable to fetch ${source}`);
      model = new NgramModel(await response.arrayBuffer());
    } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
      model = new NgramModel(source);
    }
    if (!(model instanceof NgramModel)) throw new TypeError("Unsupported context model source");
    this.ngramsByLanguage[this.language] = model;
    delete this.ngramIndexes[this.language];
    return true;
  }
  async loadSuggestionContext(baseUrl) {
    const language = this.language;
    if (!/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(language)) return false;
    const base = baseUrl ?? defaultNgramBase();
    if (!base) throw new Error("loadSuggestionContext requires a baseUrl (the URL of the languages/ directory)");
    const prefix = String(base).endsWith("/") ? base : `${base}/`;
    const response = await fetch(`${prefix}${language}.ngram.bin`);
    if (!response.ok) return false;
    this.ngramsByLanguage[language] = new NgramModel(await response.arrayBuffer());
    delete this.ngramIndexes[language];
    return true;
  }
  async loadComposition(lang) {
    const language = String(lang || this.language).toLowerCase();
    if (!/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(language)) return false;
    const entry = compositions_default[language];
    if (!entry) return false;
    const module = await entry.load();
    const composition = parseComposition(module.default, entry.reading);
    this.compositionsByLanguage[language] = composition;
    if (!this.sourcesByLanguage[language]) this.sourcesByLanguage[language] = {};
    this.sourcesByLanguage[language].bundled = buildSource(composition.vocab);
    delete this.ngramIndexes[language];
    return true;
  }
  get compositionActive() {
    return !!compositions_default[this.language];
  }
  compositionBuffer() {
    return this.compositionBuffers[this.language] || "";
  }
  compositionAppend(key) {
    if (typeof key !== "string" || !key.length) return [];
    if (!this.compositionsByLanguage[this.language]) return [];
    this.compositionBuffers[this.language] = this.compositionBuffer() + key;
    return this.compositionSuggestions();
  }
  compositionBackspace() {
    const buffer = this.compositionBuffer();
    if (!buffer) return false;
    const chars = [...buffer];
    chars.pop();
    this.compositionBuffers[this.language] = chars.join("");
    return true;
  }
  compositionReset() {
    this.compositionBuffers[this.language] = "";
  }
  compositionVoiceLast(mark) {
    const buffer = this.compositionBuffer();
    if (!buffer) return false;
    const chars = [...buffer];
    const replacement = voiceKanaChar(chars[chars.length - 1], mark);
    if (!replacement) return false;
    chars[chars.length - 1] = replacement;
    this.compositionBuffers[this.language] = chars.join("");
    return true;
  }
  compositionSuggestions(context, limit = this.maxSuggestions) {
    const composition = this.compositionsByLanguage[this.language];
    if (!composition) return [];
    const buffer = this.compositionBuffer();
    if (!buffer) return [];
    const previousWords = typeof context === "string" && context.length ? this.previousWords(context, context.length, 2) : [];
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
        const collect = (slice) => {
          if (!slice) return;
          for (let i = 0; i < slice.ids.length; i++) add(index.words[slice.ids[i]], "bundled");
        };
        const previousId = index.ids.get(previousWords[0].toLowerCase());
        if (previousWords.length >= 2) {
          const first = index.ids.get(previousWords[1].toLowerCase());
          if (first !== void 0 && previousId !== void 0) collect(index.model.trigram(first, previousId));
        }
        if (previousId !== void 0) collect(index.model.bigram(previousId));
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
        const matches = digits ? (readingToDigits(reading) || "").startsWith(digits) : reading.startsWith(wanted);
        if (matches) add(entry.word, "user-words");
      }
    }
    for (const text of base) {
      if (results.length >= limit) break;
      add(text, "bundled");
    }
    return results;
  }
  wordAt(text, index) {
    if (typeof text !== "string") return "";
    const end = Math.min(index ?? text.length, text.length);
    if (this.segmenter) return this.segmentedWordAt(text, end);
    let start = 0;
    for (let i = end - 1; i >= 0; i--) {
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
    if (end <= 0) return "";
    for (const part of this.segmenter.segment(text)) {
      const stop = part.index + part.segment.length;
      if (stop < end) continue;
      if (part.index > end) break;
      return part.isWordLike ? text.slice(part.index, end) : "";
    }
    return "";
  }
  previousWords(text, index, count = 2) {
    if (typeof text !== "string") return [];
    const end = Math.min(index ?? text.length, text.length);
    if (this.segmenter) return this.segmentedPreviousWords(text, end, count);
    if (this.separatorRegex) {
      const words2 = [];
      let cursor2 = end;
      while (words2.length < count && cursor2 > 0) {
        while (cursor2 > 0 && this.separatorRegex.test(text.charAt(cursor2 - 1))) cursor2--;
        if (!cursor2) break;
        if (this.compositionCharRegex.test(text.charAt(cursor2 - 1))) {
          words2.push(text.charAt(cursor2 - 1));
          cursor2--;
          continue;
        }
        const stop = cursor2;
        while (cursor2 > 0 && !this.separatorRegex.test(text.charAt(cursor2 - 1)) && !this.compositionCharRegex.test(text.charAt(cursor2 - 1))) cursor2--;
        words2.push(text.slice(cursor2, stop));
      }
      return words2;
    }
    const words = [];
    let cursor = end;
    while (words.length < count && cursor > 0) {
      while (cursor > 0 && this.boundaryRegex.test(text.charAt(cursor - 1))) cursor--;
      const stop = cursor;
      while (cursor > 0 && !this.boundaryRegex.test(text.charAt(cursor - 1))) cursor--;
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
    const previousWords = typeof context === "string" && context.length ? this.previousWords(context, context.length, 2) : [];
    return this.suggestInternal(word, previousWords);
  }
  suggestAt(text, caret) {
    const composition = this.language ? this.compositionsByLanguage[this.language] : null;
    if (composition && this.compositionBuffer()) {
      const end2 = Math.min(caret ?? text.length, text.length);
      return this.compositionSuggestionsInternal(composition, this.previousWords(text, end2, 2), this.compositionBuffer());
    }
    const word = this.wordAt(text, caret);
    const end = Math.min(caret ?? text.length, text.length) - word.length;
    return this.suggestInternal(word, this.previousWords(text, end, 2));
  }
  nextWords(context) {
    const previousWords = typeof context === "string" && context.length ? this.previousWords(context, context.length, 2) : [];
    return this.nextWordsInternal(previousWords);
  }
  suggestInternal(word, previousWords) {
    if (!this.language) return [];
    if (typeof word !== "string" || word.length === 0) return [];
    const composition = this.compositionsByLanguage[this.language];
    if (composition && this.compositionBuffer()) return this.compositionSuggestionsInternal(composition, previousWords, this.compositionBuffer());
    if (composition && isReadingLike(word, composition.reading)) {
      const results2 = this.compositionSuggestionsInternal(composition, previousWords, word);
      if (results2.length) return results2;
    }
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
    if (!this.language) return [];
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
      console.warn(`suggest-engine: context model for "${language}" does not match the bundled word list; context ranking disabled`);
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
    if (!this.userWordsStore || !this.language || typeof word !== "string") return false;
    return this.userWordsStore.remove(word.trim().toLowerCase());
  }
  clearUserWords() {
    if (this.userWordsStore && this.language) this.userWordsStore.clear();
  }
  enableUserWords(options) {
    if (this.userWordsStore) return;
    const source = options !== void 0 ? options : this.userWordsOptions ?? true;
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
};

// src/jamo.js
var CHO = ["\u3131", "\u3132", "\u3134", "\u3137", "\u3138", "\u3139", "\u3141", "\u3142", "\u3143", "\u3145", "\u3146", "\u3147", "\u3148", "\u3149", "\u314A", "\u314B", "\u314C", "\u314D", "\u314E"];
var JUNG = ["\u314F", "\u3150", "\u3151", "\u3152", "\u3153", "\u3154", "\u3155", "\u3156", "\u3157", "\u3158", "\u3159", "\u315A", "\u315B", "\u315C", "\u315D", "\u315E", "\u315F", "\u3160", "\u3161", "\u3162", "\u3163"];
var JONG = ["", "\u3131", "\u3132", "\u3133", "\u3134", "\u3135", "\u3136", "\u3137", "\u3139", "\u313A", "\u313B", "\u313C", "\u313D", "\u313E", "\u313F", "\u3140", "\u3141", "\u3142", "\u3144", "\u3145", "\u3146", "\u3147", "\u3148", "\u314A", "\u314B", "\u314C", "\u314D", "\u314E"];
var CHO_INDEX = new Map(CHO.map((jamo, index) => [jamo, index]));
var JUNG_INDEX = new Map(JUNG.map((jamo, index) => [jamo, index]));
var JONG_INDEX = new Map(JONG.map((jamo, index) => [jamo, index]));
var MEDIAL_COMPOUND = {
  "\u3157\u314F": "\u3158",
  "\u3157\u3150": "\u3159",
  "\u3157\u3163": "\u315A",
  "\u315C\u3153": "\u315D",
  "\u315C\u3154": "\u315E",
  "\u315C\u3163": "\u315F",
  "\u3161\u3163": "\u3162"
};
var MEDIAL_SPLIT = { "\u3158": "\u3157", "\u3159": "\u3157", "\u315A": "\u3157", "\u315D": "\u315C", "\u315E": "\u315C", "\u315F": "\u315C", "\u3162": "\u3161" };
var FINAL_COMPOUND = {
  "\u3131\u3145": "\u3133",
  "\u3134\u3148": "\u3135",
  "\u3134\u314E": "\u3136",
  "\u3139\u3131": "\u313A",
  "\u3139\u3141": "\u313B",
  "\u3139\u3142": "\u313C",
  "\u3139\u3145": "\u313D",
  "\u3139\u314C": "\u313E",
  "\u3139\u314D": "\u313F",
  "\u3139\u314E": "\u3140",
  "\u3142\u3145": "\u3144"
};
var FINAL_SPLIT = {
  "\u3133": ["\u3131", "\u3145"],
  "\u3135": ["\u3134", "\u3148"],
  "\u3136": ["\u3134", "\u314E"],
  "\u313A": ["\u3139", "\u3131"],
  "\u313B": ["\u3139", "\u3141"],
  "\u313C": ["\u3139", "\u3142"],
  "\u313D": ["\u3139", "\u3145"],
  "\u313E": ["\u3139", "\u314C"],
  "\u313F": ["\u3139", "\u314D"],
  "\u3140": ["\u3139", "\u314E"],
  "\u3144": ["\u3142", "\u3145"]
};
var CONJOINING = /* @__PURE__ */ new Map();
for (let i = 0; i < CHO.length; i++) CONJOINING.set(String.fromCodePoint(4352 + i), CHO[i]);
for (let i = 0; i < JUNG.length; i++) CONJOINING.set(String.fromCodePoint(4449 + i), JUNG[i]);
for (let i = 1; i < JONG.length; i++) CONJOINING.set(String.fromCodePoint(4519 + i), JONG[i]);
function isSyllable(char) {
  const code = char.codePointAt(0);
  return code >= 44032 && code <= 55203;
}
function isConsonant(char) {
  return char !== "" && CHO_INDEX.has(char);
}
function isVowel(char) {
  return char !== "" && JUNG_INDEX.has(char);
}
function isFinal(char) {
  return char !== "" && JONG_INDEX.has(char);
}
function syllable(cho, jung, jong = "") {
  return String.fromCodePoint(44032 + (CHO_INDEX.get(cho) * 21 + JUNG_INDEX.get(jung)) * 28 + JONG_INDEX.get(jong));
}
function splitSyllable(char) {
  const offset = char.codePointAt(0) - 44032;
  return {
    cho: CHO[Math.floor(offset / 588)],
    jung: JUNG[Math.floor(offset % 588 / 28)],
    jong: JONG[offset % 28]
  };
}
function composeJamo(text) {
  if (typeof text !== "string" || !text) return "";
  let out = "";
  let cho = "";
  let jung = "";
  let jong = "";
  const flush = () => {
    if (cho && jung) out += syllable(cho, jung, jong);
    else out += cho || jung;
    cho = jung = jong = "";
  };
  const feed = (raw) => {
    const char = CONJOINING.get(raw) ?? raw;
    if (isConsonant(char)) {
      if (cho && jung && !jong) {
        if (isFinal(char)) {
          jong = char;
        } else {
          flush();
          cho = char;
        }
      } else if (cho && jung && jong) {
        const combined = FINAL_COMPOUND[jong + char];
        if (combined) {
          jong = combined;
        } else {
          flush();
          cho = char;
        }
      } else if (cho) {
        flush();
        cho = char;
      } else {
        cho = char;
      }
      return;
    }
    if (isVowel(char)) {
      if (cho && !jung) {
        jung = char;
      } else if (cho && jung && !jong) {
        const combined = MEDIAL_COMPOUND[jung + char];
        if (combined) {
          jung = combined;
        } else {
          flush();
          jung = char;
        }
      } else if (cho && jung && jong) {
        const split = FINAL_SPLIT[jong];
        const kept = split ? split[0] : "";
        out += syllable(cho, jung, kept);
        cho = split ? split[1] : jong;
        jung = char;
        jong = "";
      } else {
        flush();
        jung = char;
      }
      return;
    }
    flush();
    out += char;
  };
  for (const char of text) {
    if (isSyllable(char)) {
      const parts = splitSyllable(char);
      feed(parts.cho);
      feed(parts.jung);
      if (parts.jong) feed(parts.jong);
    } else {
      feed(char);
    }
  }
  flush();
  return out;
}
function backspaceHangul(text) {
  if (typeof text !== "string" || !text) return null;
  const chars = [...text];
  const last = chars[chars.length - 1];
  if (isSyllable(last)) {
    const { cho, jung, jong } = splitSyllable(last);
    let replacement;
    if (jong) {
      const split = FINAL_SPLIT[jong];
      replacement = syllable(cho, jung, split ? split[0] : "");
    } else if (MEDIAL_SPLIT[jung]) {
      replacement = syllable(cho, MEDIAL_SPLIT[jung], "");
    } else {
      replacement = cho;
    }
    chars[chars.length - 1] = replacement;
    return chars.join("");
  }
  const char = CONJOINING.get(last) ?? last;
  if (isConsonant(char) || isVowel(char)) {
    chars.pop();
    return chars.join("");
  }
  return null;
}
export {
  NgramModel,
  SuggestEngine,
  UserWords,
  backspaceHangul,
  composeJamo,
  parseWordList,
  resolveWordList,
  voiceKanaChar
};
