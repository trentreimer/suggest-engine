# Renaming plan: "ngram" jargon → "context" vocabulary

Goal: make the API intuitive for users who don't know what ngrams are. The
concept these names hide is "a model that predicts likely next words from the
preceding one or two words" — "context model" captures that without jargon, and
the README already leans on it ("context ranking", "Bundled context models",
`contextMatches()`, `suggest(word, context)`).

## Scope decisions

- **API + internals renamed**; `.ngram.bin` data filenames untouched.
- **Breaking change, no aliases** (v0.4.0, pre-1.0) — version bump to 0.5.0.
- Also rename `wordBefore`/`wordsBefore` (one-letter-apart pair, easy to mix up).

## Name mapping

### Public API (`SuggestEngine`)

| Current | New |
|---|---|
| `loadBundledNgrams(baseUrl?)` | `loadBundledContext(baseUrl?)` |
| `addNgramModel(source)` | `addContextModel(source)` |
| `wordBefore(text, caret)` | `precedingWord(text, caret)` |
| `wordsBefore(text, index, count)` | `precedingWords(text, index, count)` |

### Exports & internals

| Current | New |
|---|---|
| `NgramModel` (class, exported from `src/index.js`) | `ContextModel` |
| `src/ngrams.js` | `src/context-model.js` |
| `ngramsByLanguage` / `ngramIndexes` | `contextModelsByLanguage` / `contextIndexes` |
| `ngramIndex()` (private method) | `contextIndex()` |
| `defaultNgramBase()` | `defaultContextBase()` |

### Kept as-is

- `languages/<code>.ngram.bin` filenames, package.json build script.
- Tool config keys (`ngramTopK`, `ngramMinCount`, `trigramTopK`, …).
- `tools/ngram-format.mjs` / `encodeNgramModel` (the binary format genuinely is
  bigram+trigram sections).
- `contextMatches()` / `suggest(word, context)` — already use "context" vocabulary.
- User-words API entirely.

Rejected candidates: `loadSuggestionContext()` reads as if it loads
suggestions; `loadContext()` loses the "bundled data" pairing that
`loadBundledWordList()` establishes.

## Changes by file

1. **`src/ngrams.js` → `src/context-model.js`** — rename file; rename class to
   `ContextModel`; update user-facing error strings ("Unsupported ngram model
   source" → "Unsupported context model source", hash-mismatch warning text).
2. **`src/engine.js`** — update import; rename the 4 public methods and 4
   internals above; update the `loadBundledContext requires a baseUrl` error
   message.
3. **`src/index.js`** — export `ContextModel` from the new module path.
4. **`test/ngrams.test.js` → `test/context-model.test.js`** — rename file;
   update imports, class usage, method names, and test titles
   (`addNgramModel accepts buffers…` → `addContextModel…`, etc.). URL fixtures
   like `en.ngram.bin` stay since data filenames don't change.
5. **`test/engine.test.js`** — update `wordBefore`/`wordsBefore` call sites and
   test titles.
6. **`tools/bench-suggest.mjs`, `tools/build-wordlists.mjs`,
   `tools/ngram-format.mjs`** — update imports to the renamed class/module path
   only; no logic changes.
7. **`README.md`** — update quick start, full example, API method table,
   Server-side section, and "Bundled context models" section; note that the
   data files keep their `.ngram.bin` names; bump jsDelivr examples to the new
   names.
8. **`package.json`** — bump version to `0.5.0`; rebuild `dist/` with
   `npm run build` so the committed bundle matches.

## Verification

- `npm test` — full suite green
- `npm run build` — rebuild dist; spot-check the bundle exports `ContextModel`
  and the new method names
- `rg -n "ngram|Ngram"` — confirm remaining hits are only the intentional ones
  (`.ngram.bin` filenames, `tools/ngram-format.mjs`, build config keys,
  ATTRIBUTION.md data notes)
