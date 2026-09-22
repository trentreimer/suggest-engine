# suggest-engine

Editor-agnostic autocomplete suggestion engine with optional user word learning
and optional context ranking. Words a user types repeatedly are learned on-device 
and suggested ahead of shipped dictionaries. 

When context data is loaded, suggestions also account for the word that precedes 
the caret.

Zero runtime dependencies. Plain ES modules.

## Quick start

A language is required — pass one to the constructor or call `setLanguage()`; the engine
stays inert until then.

```js
import { SuggestEngine } from 'https://cdn.jsdelivr.net/gh/trentreimer/suggest-engine@v0.11.0/dist/suggest-engine.esm.js';

const engine = new SuggestEngine({ language: 'en' });

await engine.loadWordList();   // Loads word list for the selected language
await engine.loadSuggestionContext();   // optional suggestion context data

engine.suggest('hel');
// → [{ text: 'help', insertSuffix: 'p', source: 'bundled' }, ...]

engine.suggest('wo', 'in the ');
// → [{ text: 'world', ... }, ...] — the previous word promotes likely continuations
```

## Full example

Note: This example uses hard-coded strings to demonstrate `wordAt()`, `suggestAt()`,
`suggestAt()`, etc. but an application would often supply strings programmatically.

```js
import { SuggestEngine } from 'https://cdn.jsdelivr.net/gh/trentreimer/suggest-engine@v0.11.0/dist/suggest-engine.esm.js';

const engine = new SuggestEngine({
    language: 'en',
    maxSuggestions: 5,
    userWords: { storagePrefix: 'myapp' }, // optional component; see below
});

await engine.loadWordList();
// Add a custom list of words as well
await engine.addWordList('main', '/wordlists/en.txt'); // url | string[] | { text }
// Context ranking - works best with the default word list
await engine.loadSuggestionContext();

const word = engine.wordAt('Hello Sar', 10); // → 'Sar'
const suggestions = engine.suggest(word, 'Hello '); // context: text before the current word
// → [{ text: 'Sarah', insertSuffix: 'rah', source: 'user-words' }, ...]

engine.suggestAt('Hello Sar', 10); // word + preceding word in one call
// → same ranking as above, derived from text and caret

engine.nextWords('Hello'); // likely next words with no prefix typed
// → [{ text: 'Sarah', insertSuffix: 'Sarah', source: 'user-words' }, ...]

engine.recordWord('Sarah'); // call when the user completes a word
```

The host owns all editor interaction: feed the engine text plus a caret index,
insert `insertSuffix` at the caret when a suggestion is chosen, and call
`recordWord` when a word is completed (space, punctuation, Enter, or choosing a
suggestion all count as completion).

### Supported languages

The engine ships data for 61 languages: 59 word-list languages, whose bundled
dictionaries complete typed prefixes, plus Mandarin and Japanese as
composition languages, which convert pinyin or kana readings into characters
(see [Composition languages](#composition-languages)).

| Code | Language | Data |
|---|---|---|
| `en` | English | word list |
| `fr` | French | word list |
| `es` | Spanish | word list |
| `de` | German | word list |
| `pt` | Portuguese | word list |
| `id` | Indonesian | word list |
| `ru` | Russian | word list |
| `ar` | Arabic | word list |
| `hi` | Hindi | word list |
| `bn` | Bengali | word list |
| `sw` | Swahili | word list |
| `pcm` | Nigerian Pidgin | word list |
| `it` | Italian | word list |
| `tr` | Turkish | word list |
| `vi` | Vietnamese | word list |
| `fa` | Persian | word list |
| `mr` | Marathi | word list |
| `ha` | Hausa | word list |
| `tl` | Tagalog | word list |
| `uk` | Ukrainian | word list |
| `pl` | Polish | word list |
| `nl` | Dutch | word list |
| `ko` | Korean | word list |
| `he` | Hebrew | word list |
| `el` | Greek | word list |
| `ur` | Urdu | word list |
| `ta` | Tamil | word list |
| `te` | Telugu | word list |
| `am` | Amharic | word list |
| `yo` | Yoruba | word list |
| `zu` | Zulu | word list |
| `gu` | Gujarati | word list |
| `pa` | Punjabi | word list |
| `ml` | Malayalam | word list |
| `kn` | Kannada | word list |
| `om` | Oromo | word list |
| `ig` | Igbo | word list |
| `xh` | Xhosa | word list |
| `so` | Somali | word list |
| `sn` | Shona | word list |
| `rw` | Kinyarwanda | word list |
| `ny` | Chichewa | word list |
| `wo` | Wolof | word list |
| `ps` | Pashto | word list |
| `uz` | Uzbek | word list |
| `az` | Azerbaijani | word list |
| `sd` | Sindhi | word list |
| `ne` | Nepali | word list |
| `as` | Assamese | word list |
| `or` | Odia | word list |
| `si` | Sinhala | word list |
| `th` | Thai | word list (segmented) |
| `kk` | Kazakh | word list |
| `tg` | Tajik | word list |
| `tt` | Tatar | word list |
| `ug` | Uyghur | word list |
| `ckb` | Central Kurdish | word list |
| `kat` | Georgian | word list |
| `hye` | Armenian | word list |
| `zh` | Mandarin | composition (pinyin) |
| `ja` | Japanese | composition (kana) |

Corpus provenance, licensing and generation details for all bundled data are
documented in [ATTRIBUTION.md](ATTRIBUTION.md).

### Custom vocabulary only

The bundled dictionaries are opt-in. An application that only wants a small
list of suggestions simply never calls `loadWordList()` and registers its own
words:

```js
const engine = new SuggestEngine({ language: 'en' });
await engine.addWordList('personal', ['mama', 'Sarah', 'school', 'water']);

engine.suggest('sc');
// → [{ text: 'school', insertSuffix: 'hool', source: 'personal' }]
```

Registration order is suggestion priority, and user-word learning works as
usual. One caveat: `nextWords()` successors and context ranking are keyed to
the bundled word list (context models are hash-validated against it), so with
custom lists only, `suggest(word, context)` falls back to plain source order
and `nextWords()` falls back to user words.

### Context ranking

When context data is loaded for the active language and a context is passed,
matches predicted by the previous two words are promoted first, followed by
matches predicted by the previous word alone, each in count order; matching user
words come next, then remaining matches in source order. Without context — or
without context data, or when the data does not match the bundled word list —
results are exactly the frequency-ranked ones:

| Priority | `suggest(word)` | `suggest(word, context)` with context data |
|---|---|---|
| 1 | user words (by frequency) | matches for the previous two words (count order) |
| 2 | sources in registration order | matches for the previous word alone (count order) |
| 3 | — | user words (by frequency) |
| 4 | — | sources in registration order |

Models are compact and validated by hash at load time; a mismatched or missing
model silently disables context ranking. `suggestAt(text, caret)` derives both
the word being typed and up to two preceding words from the host's own text, so
no extra state is needed; `nextWords(context)` serves keyboard-style "word after
the space" suggestions when no prefix is typed.

### Word characters

Word boundaries are language-owned. Letters and combining marks are always word
characters, apostrophes and hyphens connect everywhere, and a language may add
connector characters of its own — derived from its corpus at build time and
shipped in `languages/word-chars.js` (for example ZWNJ for Persian, ZWJ for
Marathi, so `می‌روم` is one word). One rule governs all three places that
define word characters: tokenizing host text (`wordAt`/`previousWords`),
parsing word lists (`parseWordList`), and validating learned user words.
`setLanguage()` applies the language's set; hosts never configure it.

### Segmented languages

Some scripts are written without inter-word spaces, so a word-character run
would swallow a whole phrase. Thai (`th`) is bundled this way: the build splits
corpus text and the runtime splits host text with `Intl.Segmenter`
(`granularity: 'word'`) instead of the boundary regex. The segmentation locale
is shipped in `languages/segmenters.js`, derived from each language's `segment`
config, so `wordAt`/`previousWords` and the bundled word list agree. `suggest`,
`suggestAt`, context ranking and `nextWords` work as for any word-list language.
Because word boundaries are inherently ambiguous, the engine trusts the
segmenter's choice; a partial word the segmenter splits differently may complete
against the trailing piece rather than the whole run.

## API

### Constructor options

| Option | Default | Description |
|---|---|---|
| `language` | *(required)* | Active language; user words are bucketed per language. Pass it here or call `setLanguage()` — suggestions stay empty and word learning is off until a language is set |
| `maxSuggestions` | `5` | Maximum results returned by `suggest()` |
| `userWords` | *(omitted)* | Optional user-word learning component; see below |

### User words (`userWords`)

Presence enables the component; absence disables it entirely:

| `userWords` | Behaviour |
|---|---|
| *(omitted)* / `false` / `null` | Component off — zero storage reads or writes |
| `true` | On, all defaults |
| `{}` | On, all defaults |
| `{ storagePrefix, recordAfter, maxWords }` | On, provided knobs override defaults |

Defaults for unspecified properties: `storagePrefix: 'suggest-engine'`,
`recordAfter: 2` (a word typed twice becomes suggestible),
`maxWords: 300` (eviction by lowest count, then oldest use).

**Disabled contract:** `suggest()` returns word-list results only;
`recordWord()` / `addWord()` return `false`; `userWords()` returns `[]`;
`removeWord()` / `clearUserWords()` are no-ops. No storage access occurs.
The component can be enabled later with `enableUserWords()`, optionally with
the same option shapes as the constructor.

### Methods

| Method | Description |
|---|---|
| `setLanguage(lang)` | Switch active language for sources, the user-words bucket, and the tokenizer's connector characters; throws `TypeError` when called without a language |
| `addWordList(name, source)` | Register a word list for the current language (`url` string, `string[]`, or `{ text }`); same name replaces; requires a language to be set first |
| `addContextModel(source)` | Register suggestion context data for the current language (`url` string, `ArrayBuffer`, or `NgramModel`); same language replaces; requires a language to be set first |
| `loadSuggestionContext(baseUrl?)` | Fetch the bundled `<language>.ngram.bin` (resolves `false` when none ships); the default base URL resolves relative to the module, so pass one where no module URL is available (for example Node) |
| `loadComposition(lang?)` | Load the bundled reading-to-candidate data for the current language (resolves `false` when the language ships none) — see [Composition languages](#composition-languages) |
| `compositionActive` | `true` while the active language is a composition language (getter) |
| `compositionAppend(key)` / `compositionBackspace()` / `compositionReset()` / `compositionBuffer()` | Maintain the composition reading buffer; `append` accepts pinyin/kana keys or T9 digits and returns the current candidates, `backspace` reports whether anything was removed |
| `compositionVoiceLast(mark)` | Apply Japanese voicing (`゛` dakuten or `゜` handakuten) to the last kana of the buffer; `false` when it does not apply |
| `compositionSuggestions(context?, limit?)` | Ranked candidates for the active buffer (context-first when context data and prior text are available) |
| `wordAt(text, caret)` | Word ending at the caret — letters, combining marks, apostrophes/hyphens, and the active language's connector characters are word characters |
| `previousWords(text, index, count)` | Up to `count` words ending before `index`, nearest first (used for context) |
| `suggest(word, context?)` | Ranked suggestions: with `context` (the text before the current word) and matching context data, matches for the previous two words first (count order), then matches for the previous word alone, then user words (frequency order), then word lists **in registration order** — word list order is suggestion priority, so ship lists most-common-first; deduped case-insensitively; `text` carries the word's own casing, `insertSuffix` is what to insert after the typed prefix |
| `suggestAt(text, caret)` | `wordAt` + preceding-word context + `suggest` in one call; the host's normal entry point |
| `nextWords(context)` | Likely next words when no prefix is typed: successors of the last two words, then successors of the last word, then user words by frequency |
| `recordWord(word)` | Count a completed word (validates letters/marks plus `'`/`-`, minimum length 2) |
| `addWord(word)` | Add immediately suggestible (manual entry) |
| `userWordsEnabled` | `true` while the user-words component is active (getter) |
| `userWords()` | `[{ word, count }]` sorted by frequency |
| `removeWord(word)` | Remove one word (any casing) |
| `clearUserWords()` | Remove all words for the active language |
| `enableUserWords(options?)` | Enable the user-words component — with the same option shapes as the constructor's `userWords` (`true`/`{}`/`{ storagePrefix, recordAfter, maxWords }`). With no argument it resumes the previously configured options, or all defaults if never configured; provided options replace the stored config for later disable/enable cycles. No-op if already enabled or when passed `false`/`null` |
| `disableUserWords()` | Disable the component and wipe its stored words for **all** languages (no-op if already disabled) |

### Bundled word lists

The library ships frequency-ordered word lists for 59 languages in
`languages/` (one JS module per language, plus a manifest and the
connector-character map `word-chars.js`) — the bundled word-list languages are
listed in [Supported languages](#supported-languages). `pcm` combines a manually
cached Common Voice archive (CC0) with two
automatically fetched CC-BY 4.0 corpora; rebuilding it needs the archive
described in [Regenerating the data](#regenerating-the-data). The `ur`, `ta`,
`te`, `am`, `yo`, `zu`, `gu`, `pa`, `ml`, `kn`, `om`, `ig`, `xh`, `so`, `sn`,
`rw`, `ny`, `wo`, `ps`, `uz`, `az`, `sd`, `ne`, `as`, `or`, `si`, `th`, `kk`,
`tg`, `tt`, `ug`, `ckb`, `kat`, and `hye` lists are sampled from the CC0 HPLT
v3.0 web corpora, also described there.
Load the list for the active language with:

```js
await engine.loadWordList();       // current language; resolves false if none bundled
await engine.loadWordList('ar');   // explicit language
```

Registering does not switch the active language — call `setLanguage()` first, as
with any source. Hosts can layer their own `addWordList()` sources on top;
earlier-registered sources rank ahead of bundled data. The `languages/*.js` files hold
the lists verbatim as template literals and are parsed with `parseWordList`
using the active language's connector characters (see
[Word characters](#word-characters)), so regenerating from raw word-list text is
a copy-paste into a template literal.

### Bundled context models

Context models ship alongside the word lists as `languages/<code>.ngram.bin`
for every bundled word-list and composition language — a section of one-word
contexts plus a section of two-word contexts where the corpus supports them —
and are copied to
`dist/languages/` so the CDN
build can fetch them next to the bundle:

```js
await engine.loadSuggestionContext();         // current language; false if none bundled
await engine.loadSuggestionContext('https://cdn.example/languages/');   // explicit base
```

`loadSuggestionContext()` resolves the default base relative to the ESM bundle
(`dist/languages/`), which works for both a local clone and jsDelivr. Under Node
that default is a `file:` URL, which Node's `fetch` rejects — pass an `http(s)`
base URL there, or use `addContextModel()` with the file contents (see
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

### Composition languages

Mandarin (`zh`) and Japanese (`ja`) ship as composition languages. Instead of
word lists completed by prefix, they bundle reading-to-candidate tables —
toneless pinyin for `zh`, kana readings for `ja` — with ngram context models
over the candidate vocabulary. The host drives the reading buffer; the engine
turns it into ranked candidates:

```js
const engine = new SuggestEngine({ language: 'zh' });

await engine.loadComposition();
await engine.loadSuggestionContext();   // optional context ranking

engine.compositionAppend('ni');
// → [{ text: '你', insertSuffix: '你', source: 'bundled' }, ...]

engine.compositionSuggestions('你好');   // context: committed text so far
engine.compositionBackspace();
engine.compositionReset();
```

- `compositionAppend(key)` accepts pinyin/kana keys or T9 digits (`2`–`9`) and
  returns the current candidates. `compositionBackspace()` and
  `compositionReset()` maintain the buffer, `compositionBuffer()` reports the
  pending reading, `compositionVoiceLast(mark)` applies Japanese dakuten or
  handakuten to the last kana, and `compositionActive` tells composition
  languages apart.
- Candidates rank context-first: trigram then bigram continuations of the
  committed text, then learned user words whose reading matches, then corpus
  frequency. `suggestAt(text, caret)` returns candidates for the active buffer
  ranked against the text before the caret, and `suggest(reading, context)`
  doubles as a stateless lookup — pass pinyin or kana as the word.
  `nextWords(context)` predicts the next character or word from committed
  text.
- Picking a candidate belongs to the host: insert the candidate's `text`, then
  call `recordWord(text)` — composition languages learn single characters, so
  frequent characters surface ahead of corpus frequency next time.
  `compositionSuggestions(context?, limit?)` exposes the ranking for hosts
  that render candidates themselves.

### Korean input

Korean (`ko`) is a word-list language, but 2-beolsik keyboards type decomposed
jamo (`ㅎ`, `ㅏ`, `ㄴ`) while real text — and the bundled word list — uses
composed syllable blocks (`한`). The engine exports two pure helpers for hosts
to apply to editor text, the same way `voiceKanaChar` handles dakuten:

```js
import { composeJamo, backspaceHangul } from 'suggest-engine';

composeJamo('ㅎㅏㄴ');          // → '한'
composeJamo('한ㅏ');            // → '하나' (a vowel moves the final consonant)
backspaceHangul('한');          // → '하'
backspaceHangul('하');          // → 'ㅎ'
backspaceHangul('없');          // → '업'
backspaceHangul('abc');         // → null (nothing Hangul to step back)
```

A host composes the trailing Hangul run as the user types, so the document
holds proper syllable blocks and `suggestAt` matches the bundled list with no
further configuration. `backspaceHangul` steps back one composition state
(final, then medial, then the jamo itself), matching Korean IME behaviour;
`null` means the run does not end in Hangul and the host should delete a
character instead.

### Server-side

Browsers (`<script type="module">`) and Deno can import the CDN URL directly;
Node and Bun cannot import `https:` modules, so install the package from its Git
repository or vendor `dist/` together with `languages/`:

```sh
npm install github:trentreimer/suggest-engine
```

`loadWordList()` resolves bundled language data relative to the bundle,
so it works from an installed or vendored copy. `loadSuggestionContext()` uses
`fetch`, and its default base URL is a `file:` path under Node, which Node's
`fetch` rejects: pass an `http(s)` base URL, or hand the bytes to
`addContextModel()`:

```js
import { readFileSync } from 'node:fs';

await engine.loadWordList();
await engine.addContextModel(readFileSync('node_modules/suggest-engine/languages/en.ngram.bin'));
```

### Regenerating the data

**Prefer per-language builds.** `node tools/build-wordlists.mjs <code>` (for
example `node tools/build-wordlists.mjs bn`) adds or updates just that one
language: its bundled word list or composition file, its context model
(`languages/<code>.ngram.bin`), its attribution record
(`attribution/<code>.json`), and its entry in the connector-character map
(`languages/word-chars.js`, see [Word characters](#word-characters)).
`ATTRIBUTION.md` is regenerated from the per-language records after every
build, so it stays in sync without a full rebuild. Files whose generated
content did not change are left untouched — no rewrite, no `-previous.txt`
backup. When `HOST_DIR=/path/to/host` is set, the build additionally writes the
host project's reference copies (`autocomplete.txt`, `ngrams.bin`,
`composition.txt`) under `<HOST_DIR>/languages/`; without it, nothing outside
this repository is touched.

A full build (`node tools/build-wordlists.mjs`, no arguments) re-downloads and
regenerates every language and is only needed after changing global
configuration in `tools/wordlist-sources.json` (for example `topN`,
`cc0MinSentences`, `ngramTopK`, `ngramMinCount`, `trigramTopK`,
`trigramMinPairCount`, `trigramMinCount`, or `trigramMaxContexts`).

A language may combine several sources: `sw` concatenates Tatoeba's `swh` and
`swc` dumps, and `pcm` reads the Common Voice archive described below. Source
types and per-language overrides (`topN`, ngram thresholds, and `wordChars` to
fix a language's connector characters instead of deriving them from the corpus)
live in `tools/wordlist-sources.json` alongside the source list.

`hplt` sources fetch the CC0 HPLT v3.0 manifest, stream the highest-quality
shards first, and stop at `maxDocuments` (default 25,000) or `maxSegments`
(default 150,000), whichever comes first; the normalized sample is cached under
`tools/.cache/hplt_<pack>.txt`, so later builds run offline. The segment budget
matters because HPLT documents are web pages of varying length.

Host projects are updated independently of this repository. A build writes
host reference copies only when `HOST_DIR=/path/to/host` names the host
project root; for example `HOST_DIR=../click.totype.org
node tools/build-wordlists.mjs zh` refreshes the site's reference copies of
the bundled data.

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
harakat, Devanagari matras), zero-width joiners/non-joiners inside words
(Persian `می‌روم`, Devanagari half forms), and emoji stay intact.

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
models are copied to `dist/languages/` for `loadSuggestionContext()`.

The bundle and bundled data are committed, so version tags are directly
consumable through jsDelivr
(`cdn.jsdelivr.net/gh/trentreimer/suggest-engine@<tag>/dist/...`) with no npm
step. Bump the tag when `src/`, `languages/` or the bundle format changes, and
update the example URLs above to match — `npm test` checks the README's CDN
examples against `package.json` and fails when they disagree.
