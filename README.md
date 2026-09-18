# suggest-engine

Editor-agnostic autocomplete suggestion engine with optional personal word learning.
Words a user types repeatedly (names of family, friends, places) are learned on-device 
and suggested ahead of shipped dictionaries.

Zero runtime dependencies. Plain ES modules.

## Usage

```js
import { SuggestEngine } from 'https://cdn.jsdelivr.net/gh/trentreimer/suggest-engine@v0.1.0/dist/suggest-engine.esm.js';

const engine = new SuggestEngine({
    language: 'en',
    maxSuggestions: 5,
    userWords: { storagePrefix: 'myapp' },   // optional component; see below
});

await engine.addWordList('main', '/wordlists/en.txt');   // url | string[] | { text }
engine.setLanguage('ar');                                 // switches sources + personal bucket
await engine.addWordList('main', '/wordlists/ar.txt');

const word = engine.wordBefore('Hello Sar', 10);          // → 'Sar'
const suggestions = engine.suggest(word);
// → [{ text: 'Sarah', insertSuffix: 'rah', source: 'personal' }, ...]

engine.recordWord('Sarah');   // call when the user completes a word
```

The host owns all editor interaction: feed the engine text plus a caret index,
insert `insertSuffix` at the caret when a suggestion is chosen, and call
`recordWord` when a word is completed (space, punctuation, Enter, or choosing a
suggestion all count as completion).

The ESM build loads bundled language data lazily from `dist/chunks/` next to it.
For a classic `<script>` tag, use the self-contained IIFE build
`dist/suggest-engine.js`, which exposes `SuggestEngine`, `UserWords`,
`parseWordList` and `resolveWordList` on `window.SuggestEngine`. From a local
clone, import `./src/index.js` instead.

## API

### Constructor options

| Option | Default | Description |
|---|---|---|
| `language` | `'en'` | Active language; personal words are bucketed per language |
| `maxSuggestions` | `5` | Maximum results returned by `suggest()` |
| `wordBoundaryChars` | `"'-"` | Extra non-letter characters treated as part of a word (letters and combining marks are always included) |
| `userWords` | *(omitted)* | Optional personal-learning component; see below |

### Personal learning (`userWords`)

Presence enables the component; absence disables it entirely:

| `userWords` | Behaviour |
|---|---|
| *(omitted)* / `false` / `null` | Component off — zero storage reads or writes |
| `true` | On, all defaults |
| `{}` | On, all defaults |
| `{ storagePrefix, promoteThreshold, maxWords }` | On, provided knobs override defaults |

Defaults for unspecified properties: `storagePrefix: 'suggest-engine'`,
`promoteThreshold: 2` (a word typed twice becomes suggestible),
`maxWords: 300` (eviction by lowest count, then oldest use).

**Disabled contract:** `suggest()` returns word-list results only;
`recordWord()` / `addWord()` return `false`; `personalWords()` returns `[]`;
`removePersonalWord()` / `clearPersonalWords()` are no-ops. No storage access occurs.

### Methods

| Method | Description |
|---|---|
| `setLanguage(lang)` | Switch active language for sources and the personal bucket |
| `addWordList(name, source)` | Register a word list for the current language (`url` string, `string[]`, or `{ text }`); same name replaces |
| `wordBefore(text, caret)` | Word ending at the caret (`'`/`-`-aware) |
| `suggest(word)` | Ranked suggestions: personal words first (frequency order), then word lists **in registration order** — word list order is suggestion priority, so ship lists most-common-first; deduped case-insensitively; `text` carries the word's own casing, `insertSuffix` is what to insert after the typed prefix |
| `recordWord(word)` | Count a completed word (validates letters/marks plus `'`/`-`, minimum length 2) |
| `addWord(word)` | Add immediately suggestible (manual entry) |
| `personalWords()` | `[{ word, count }]` sorted by frequency |
| `removePersonalWord(lower)` | Remove one word (lowercase key) |
| `clearPersonalWords()` | Remove all words for the active language |
| `enableUserWords()` | Re-enable the personal-words component after a `disableUserWords()`; starts from empty storage (no-op if already enabled or never configured) |
| `disableUserWords()` | Disable the component and wipe its stored words for **all** languages (no-op if already disabled) |

### Bundled word lists

The library ships frequency-ordered word lists for `en`, `fr`, `es`, `de`, `pt`,
`id`, `ru`, `ar`, `hi`, and `bn` in `data/` (one JS module per language, plus a
manifest).
Load the list for the active language with:

```js
await engine.loadBundledWordList();       // current language; resolves false if none bundled
await engine.loadBundledWordList('ar');   // explicit language
```

Registering does not switch the active language — call `setLanguage()` first, as
with any source. Hosts can layer their own `addWordList()` sources on top;
earlier-registered sources rank ahead of bundled data. The `data/*.js` files hold
the lists verbatim as template literals and are parsed with `parseWordList`, so
regenerating from raw word-list text is a copy-paste into a template literal.

Corpus provenance, licensing and generation details are documented in
[ATTRIBUTION.md](ATTRIBUTION.md).

### Regenerating the data

**Prefer per-language builds.** `node tools/build-wordlists.mjs <code>` (for
example `node tools/build-wordlists.mjs bn`) adds or updates just that one
language: its bundled word list or composition file, the host project's
reference copy, and its attribution record (`attribution/<code>.json`).
`ATTRIBUTION.md` is regenerated from the per-language records after every
build, so it stays in sync without a full rebuild. Files whose generated
content did not change are left untouched — no rewrite, no `-previous.txt`
backup.

A full build (`node tools/build-wordlists.mjs`, no arguments) re-downloads and
regenerates every language and is only needed after changing global
configuration in `tools/wordlist-sources.json` (for example `topN` or
`cc0MinSentences`).

The host project's reference copies are written to a sibling `click.totype.org`
checkout by default; set `HOST_DIR=/path/to/host` to target a different host
project root.

Remove a language from the bundled data with
`node tools/build-wordlists.mjs --remove <code>`: this deletes its bundled data
module and attribution record, then regenerates the manifest and
`ATTRIBUTION.md`. Host-side cleanup is left to the caller (`languages/<code>/`,
the registry entry in `js/languages.js`, the language's section in
`tools/profanity-filter.txt`, and its entry in `tools/wordlist-sources.json`).

Configuration lives in `tools/wordlist-sources.json`; `pinyin-pro` (MIT) is a
build-time devDependency used for the Mandarin readings. Corpus provenance,
licensing and generation details are documented in
[ATTRIBUTION.md](ATTRIBUTION.md).

### Storage

Personal words live in `localStorage` under `${storagePrefix}:personal-words` with
schema `{ version: 1, languages: { [lang]: { [word]: { word, count, last } } } }`.
Everything stays on-device. If storage is unavailable (private browsing), learning
falls back to in-memory for the session. The `UserWords` class is exported for
projects that want the learning component standalone.

## Editor adapter notes

**textarea** — caret is `el.selectionStart`; text is `el.value`. Insert by splicing
the value and restoring the caret. Word completion can be detected on `input` events
ending with a non-word character, or on `keydown` Enter.

**Quill** — caret index is `quill.getSelection().index` (UTF-16 code units, matching
`getText`); insert with `quill.insertText(index, insertSuffix)`. Deleting one
character should delete a grapheme cluster, not a code point — use
`Intl.Segmenter` with `granularity: 'grapheme'` so combining marks (Arabic
harakat, Devanagari matras) and emoji stay intact.

**contenteditable** — computing a plain-text caret index is the fiddly part; walk
text nodes up to the caret and sum lengths, or maintain a mirror string as Quill
does. Prefer a text-aware editor API over raw DOM caret math when available.

## Development

```sh
npm install
npm test        # node --test
npm run build   # esbuild → dist/
```

`npm run build` writes two bundles:

- `dist/suggest-engine.esm.js` — ESM entry; bundled language data loads lazily
  from `dist/chunks/` on demand.
- `dist/suggest-engine.js` — self-contained IIFE exposing the exports on
  `window.SuggestEngine`, for plain `<script>` tags.

Both are committed, so version tags are directly consumable through jsDelivr
(`cdn.jsdelivr.net/gh/trentreimer/suggest-engine@<tag>/dist/...`) with no npm
step. Bump the tag when `src/`, `data/` or the bundle format changes.
