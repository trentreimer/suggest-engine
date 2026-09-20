# suggest-engine

Editor-agnostic autocomplete suggestion engine with optional user word learning
and optional bigram context ranking. Words a user types repeatedly (names of
family, friends, places) are learned on-device and suggested ahead of shipped
dictionaries; when context data is loaded, suggestions also account for the word
that precedes the caret.

Zero runtime dependencies. Plain ES modules.

## Quick start

Suggestions work out of the box with the bundled English word list.

```js
import { SuggestEngine } from 'https://cdn.jsdelivr.net/gh/trentreimer/suggest-engine@v0.4.0/dist/suggest-engine.esm.js';

const engine = new SuggestEngine();

await engine.loadBundledWordList();
await engine.loadBundledNgrams();   // optional bigram context data

engine.suggest('hel');
// → [{ text: 'help', insertSuffix: 'p', source: 'bundled' }, ...]

engine.suggest('wo', 'in the ');
// → [{ text: 'world', ... }, ...] — the previous word promotes likely continuations
```

Inline in a page, the same entry point works from a module script:

```html
<script type="module">
    import { SuggestEngine } from 'https://cdn.jsdelivr.net/gh/trentreimer/suggest-engine@v0.4.0/dist/suggest-engine.esm.js';

    const engine = new SuggestEngine();

    await engine.loadBundledWordList();
    await engine.loadBundledNgrams();

    console.log(engine.suggest('hel'));
</script>
```

`text` is the completed word and `insertSuffix` is what to insert after the
typed prefix. From a local clone, import `./src/index.js` instead. Node and Bun
cannot import remote modules — see [Server-side](#server-side).

### Server-side

Browsers (`<script type="module">`) and Deno can import the CDN URL directly;
Node and Bun cannot import `https:` modules, so install the package from its Git
repository or vendor `dist/` together with `languages/`:

```sh
npm install github:trentreimer/suggest-engine
```

`loadBundledWordList()` resolves bundled language data relative to the bundle,
so it works from an installed or vendored copy. `loadBundledNgrams()` uses
`fetch`, and its default base URL is a `file:` path under Node, which Node's
`fetch` rejects: pass an `http(s)` base URL, or hand the bytes to
`addNgramModel()`:

```js
import { readFileSync } from 'node:fs';

await engine.loadBundledWordList();
await engine.addNgramModel(readFileSync('node_modules/suggest-engine/languages/en.ngram.bin'));
```

## Full example

```js
import { SuggestEngine } from 'https://cdn.jsdelivr.net/gh/trentreimer/suggest-engine@v0.4.0/dist/suggest-engine.esm.js';

const engine = new SuggestEngine({
    language: 'en',
    maxSuggestions: 5,
    userWords: { storagePrefix: 'myapp' },   // optional component; see below
});

await engine.addWordList('main', '/wordlists/en.txt');   // url | string[] | { text }
await engine.loadBundledNgrams();                         // context ranking for the bundled data
engine.setLanguage('ar');                                 // switches sources + user-words bucket
await engine.addWordList('main', '/wordlists/ar.txt');

const word = engine.wordBefore('Hello Sar', 10);          // → 'Sar'
const suggestions = engine.suggest(word, 'Hello ');       // context: text before the current word
// → [{ text: 'Sarah', insertSuffix: 'rah', source: 'user-words' }, ...]

engine.suggestAt('Hello Sar', 10);                        // word + preceding word in one call
// → same ranking as above, derived from text and caret

engine.nextWords('Hello');                                // likely next words with no prefix typed
// → [{ text: 'Sarah', insertSuffix: 'Sarah', source: 'user-words' }, ...]

engine.recordWord('Sarah');   // call when the user completes a word
```

The host owns all editor interaction: feed the engine text plus a caret index,
insert `insertSuffix` at the caret when a suggestion is chosen, and call
`recordWord` when a word is completed (space, punctuation, Enter, or choosing a
suggestion all count as completion).

### Context ranking

When an ngram model is loaded for the active language and a context is passed,
matches predicted by the two preceding words (trigram) are promoted first,
followed by matches predicted by the preceding word alone (bigram), each in
count order; matching user words come next, then remaining matches in source
order. Without context — or without an ngram model, or when the model does not
match the bundled word list — results are exactly the frequency-ranked ones:

| Priority | `suggest(word)` | `suggest(word, context)` with a model |
|---|---|---|
| 1 | user words (by frequency) | trigram matches (count order) |
| 2 | sources in registration order | bigram-only matches (count order) |
| 3 | — | user words (by frequency) |
| 4 | — | sources in registration order |

Models are compact and validated by hash at load time; a mismatched or missing
model silently disables context ranking. `suggestAt(text, caret)` derives both
the word being typed and up to two preceding words from the host's own text, so
no extra state is needed; `nextWords(context)` serves keyboard-style "word after
the space" suggestions when no prefix is typed.

## API

### Constructor options

| Option | Default | Description |
|---|---|---|
| `language` | `'en'` | Active language; user words are bucketed per language |
| `maxSuggestions` | `5` | Maximum results returned by `suggest()` |
| `wordBoundaryChars` | `"'-"` | Extra non-letter characters treated as part of a word (letters and combining marks are always included) |
| `userWords` | *(omitted)* | Optional user-word learning component; see below |

### User words (`userWords`)

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
`recordWord()` / `addWord()` return `false`; `userWords()` returns `[]`;
`removeUserWord()` / `clearUserWords()` are no-ops. No storage access occurs.

### Methods

| Method | Description |
|---|---|
| `setLanguage(lang)` | Switch active language for sources and the user-words bucket |
| `addWordList(name, source)` | Register a word list for the current language (`url` string, `string[]`, or `{ text }`); same name replaces |
| `addNgramModel(source)` | Register a bigram model for the current language (`url` string, `ArrayBuffer`, or `NgramModel`); same language replaces |
| `loadBundledNgrams(baseUrl?)` | Fetch the bundled `<language>.ngram.bin` (resolves `false` when none ships); the default base URL resolves relative to the module, so pass one where no module URL is available (for example Node) |
| `wordBefore(text, caret)` | Word ending at the caret (`'`/`-`-aware) |
| `wordsBefore(text, index, count)` | Up to `count` words ending before `index`, nearest first (used for context) |
| `suggest(word, context?)` | Ranked suggestions: with `context` (the text before the current word) and a matching ngram model, trigram matches first (count order), then bigram-only matches, then user words (frequency order), then word lists **in registration order** — word list order is suggestion priority, so ship lists most-common-first; deduped case-insensitively; `text` carries the word's own casing, `insertSuffix` is what to insert after the typed prefix |
| `suggestAt(text, caret)` | `wordBefore` + preceding-word context + `suggest` in one call; the host's normal entry point |
| `nextWords(context)` | Likely next words when no prefix is typed: trigram successors of the last two words, then bigram successors of the last word, then user words by frequency |
| `recordWord(word)` | Count a completed word (validates letters/marks plus `'`/`-`, minimum length 2) |
| `addWord(word)` | Add immediately suggestible (manual entry) |
| `userWordsEnabled` | `true` while the user-words component is active (getter) |
| `userWords()` | `[{ word, count }]` sorted by frequency |
| `removeUserWord(lower)` | Remove one word (lowercase key) |
| `clearUserWords()` | Remove all words for the active language |
| `enableUserWords()` | Re-enable the user-words component after a `disableUserWords()`; starts from empty storage (no-op if already enabled or never configured) |
| `disableUserWords()` | Disable the component and wipe its stored words for **all** languages (no-op if already disabled) |

### Bundled word lists

The library ships frequency-ordered word lists for 43 languages in
`languages/` (one JS module per language, plus a manifest): `en`, `fr`, `es`,
`de`, `pt`, `id`, `ru`, `ar`, `hi`, `bn`, `sw`, `pcm`, `it`, `tr`, `vi`, `fa`,
`mr`, `ha`, `tl`, `uk`, `pl`, `nl`, `ko`, `he`, `el`, `ur`, `ta`, `te`, `am`,
`yo`, `zu`, `gu`, `pa`, `ml`, `kn`, `om`, `ig`, `xh`, `so`, `sn`, `rw`, `ny`,
and `wo`. `pcm` combines a manually cached Common Voice archive (CC0) with two
automatically fetched CC-BY 4.0 corpora; rebuilding it needs the archive
described in [Regenerating the data](#regenerating-the-data). The `ur`, `ta`,
`te`, `am`, `yo`, `zu`, `gu`, `pa`, `ml`, `kn`, `om`, `ig`, `xh`, `so`, `sn`,
`rw`, `ny`, and `wo` lists are sampled from the CC0 HPLT v3.0 web corpora, also
described there.
Load the list for the active language with:

```js
await engine.loadBundledWordList();       // current language; resolves false if none bundled
await engine.loadBundledWordList('ar');   // explicit language
```

Registering does not switch the active language — call `setLanguage()` first, as
with any source. Hosts can layer their own `addWordList()` sources on top;
earlier-registered sources rank ahead of bundled data. The `languages/*.js` files hold
the lists verbatim as template literals and are parsed with `parseWordList`, so
regenerating from raw word-list text is a copy-paste into a template literal.

### Bundled context models

Context models ship alongside the word lists as `languages/<code>.ngram.bin`
for every bundled word-list language — a bigram section plus a trigram section
where the corpus supports one — and are copied to `dist/languages/` so the CDN
build can fetch them next to the bundle:

```js
await engine.loadBundledNgrams();         // current language; false if none bundled
await engine.loadBundledNgrams('https://cdn.example/languages/');   // explicit base
```

`loadBundledNgrams()` resolves the default base relative to the ESM bundle
(`dist/languages/`), which works for both a local clone and jsDelivr. Under Node
that default is a `file:` URL, which Node's `fetch` rejects — pass an `http(s)`
base URL there, or use `addNgramModel()` with the file contents (see
[Server-side](#server-side)). Models are
compact typed arrays decoded without parsing, reference positions in the bundled
word list, and are validated against it by hash at load time. Sizes range from
about 50KB (bn) to about 1.5MB (ur, whose HPLT web sample is the deepest); an
app only loads the language it is using. Loading is optional and
asynchronous; suggestions keep working without it, and context ranking simply
switches on once the model and the bundled list for that language are both
present.

Corpus provenance, licensing and generation details are documented in
[ATTRIBUTION.md](ATTRIBUTION.md).

### Regenerating the data

**Prefer per-language builds.** `node tools/build-wordlists.mjs <code>` (for
example `node tools/build-wordlists.mjs bn`) adds or updates just that one
language: its bundled word list or composition file, its context model
(`languages/<code>.ngram.bin`), the host project's reference copies
(`autocomplete.txt`, `ngrams.bin`), and its attribution record
(`attribution/<code>.json`).
`ATTRIBUTION.md` is regenerated from the per-language records after every
build, so it stays in sync without a full rebuild. Files whose generated
content did not change are left untouched — no rewrite, no `-previous.txt`
backup.

A full build (`node tools/build-wordlists.mjs`, no arguments) re-downloads and
regenerates every language and is only needed after changing global
configuration in `tools/wordlist-sources.json` (for example `topN`,
`cc0MinSentences`, `ngramTopK`, `ngramMinCount`, `trigramTopK`,
`trigramMinPairCount`, `trigramMinCount`, or `trigramMaxContexts`).

A language may combine several sources: `sw` concatenates Tatoeba's `swh` and
`swc` dumps, and `pcm` reads the Common Voice archive described below. Source
types and per-language overrides (`topN`, ngram thresholds) live in
`tools/wordlist-sources.json` alongside the source list.

`hplt` sources fetch the CC0 HPLT v3.0 manifest, stream the highest-quality
shards first, and stop at `maxDocuments` (default 25,000) or `maxSegments`
(default 150,000), whichever comes first; the normalized sample is cached under
`tools/.cache/hplt_<pack>.txt`, so later builds run offline. The segment budget
matters because HPLT documents are web pages of varying length.

The host project's reference copies are written to a sibling `click.totype.org`
checkout by default; set `HOST_DIR=/path/to/host` to target a different host
project root.

#### Manually cached corpora

Common Voice corpora are distributed through the Mozilla Data Collective, which
requires a free account, so the build cannot download them. For `pcm`, sign in,
download **Common Voice Scripted Speech 27.0 - Nigerian Pidgin English**
(CC0 1.0), and save the archive anywhere under `tools/.cache/` with a name
matching `*cv-corpus-*-pcm.tar.gz`; browser-added timestamp prefixes are fine.
The build verifies the pinned sha256, streams `pcm/validated_sentences.tsv` out
of the archive without extracting it, and reports the download link when no
match is found: an explicit `node tools/build-wordlists.mjs pcm` fails with
instructions, while a full rebuild skips `pcm` and keeps the rest of the data.
With the archive cached, `node tools/build-wordlists.mjs pcm` produces the
bundled data like any other language.

`pcm` also reads two CC-BY 4.0 corpora automatically: the
`asr-nigerian-pidgin/nigerian-pidgin-1.0` transcripts through the Hugging Face
datasets server, and the CENCOS Zip archive from Zenodo. Their citations and
licenses are recorded in [ATTRIBUTION.md](ATTRIBUTION.md); no manual step is
needed for them.

Remove a language from the bundled data with
`node tools/build-wordlists.mjs --remove <code>`: this deletes its bundled data
module and attribution record, then regenerates the manifest and
`ATTRIBUTION.md`. Host-side cleanup is left to the caller (`languages/<code>/`,
the registry entry in `js/languages.js`, the language's section in
`tools/profanity-filter.txt`, and its entry in `tools/wordlist-sources.json`).

Configuration lives in `tools/wordlist-sources.json`; `pinyin-pro` (MIT) is a
build-time devDependency used for the Mandarin readings. Only CC0, CC-BY, and
other attribution-only sources are used for bundled data — no share-alike,
non-commercial, or no-derivatives corpora — so the package stays usable in
commercial projects. Profanity filter seeds for some languages are derived from
the Shutterstock LDNOOBW list (CC-BY 4.0) and its CC0 V2 follow-up, trimmed to
entries that occur in the bundled word lists. Corpus provenance, licensing and
generation details are documented in [ATTRIBUTION.md](ATTRIBUTION.md).

### Storage

User words live in `localStorage` under `${storagePrefix}:user-words` with
schema `{ version: 1, languages: { [lang]: { [word]: { word, count, last } } } }`.
Everything stays on-device. If storage is unavailable (private browsing), learning
falls back to in-memory for the session. The `UserWords` class is exported for
projects that want the learning component standalone.

## Editor adapter notes

**textarea** — caret is `el.selectionStart`; text is `el.value`. Insert by splicing
the value and restoring the caret. Word completion can be detected on `input` events
ending with a non-word character, or on `keydown` Enter. `engine.suggestAt(el.value,
el.selectionStart)` gives context-aware suggestions with no extra bookkeeping; call
`engine.nextWords(el.value)` when the caret sits right after a space.

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
npm run bench   # tools/bench-suggest.mjs — ns/call for context and no-context paths
npm run build   # esbuild → dist/
```

`npm run build` writes `dist/suggest-engine.esm.js` — the ESM entry; bundled
language data loads lazily from `dist/chunks/` on demand, and bundled context
models are copied to `dist/languages/` for `loadBundledNgrams()`.

The bundle and bundled data are committed, so version tags are directly
consumable through jsDelivr
(`cdn.jsdelivr.net/gh/trentreimer/suggest-engine@<tag>/dist/...`) with no npm
step. Bump the tag when `src/`, `languages/` or the bundle format changes.
