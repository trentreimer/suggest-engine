# Public API renaming plan

The README already says "context"; the API still says "ngram".
User-facing vocabulary is two nouns:

- **word list** — the words you can complete
- **suggestion context** — what usually follows the previous 1–2 words

Keep two load calls. Drop "ngram", "bigram", and "trigram" from host-facing
method names and docs. Keep them in the on-disk format and build tools.

## Loaders

Typical usage becomes:

```js
await engine.loadWordList();
await engine.loadSuggestionContext();
```

| Current | Proposed | Why |
|---|---|---|
| `loadBundledWordList(lang?)` | `loadWordList(lang?)` | "Bundled" is library-speak; this only ever loads shipped data |
| `loadBundledNgrams(baseUrl?)` | `loadSuggestionContext(baseUrl?)` | Drops ngram; uses the chosen term |
| `addWordList(name, source)` | keep | Custom lists still need a name |

## Rest of the host API

| Current | Proposed | Notes |
|---|---|---|
| `suggest(word, context?)` | keep | `context` = preceding text, which now matches the feature name |
| `suggestAt(text, caret)` | keep | Host entry point; "at the caret" is fine |
| `nextWords(context)` | keep | Already plain language |
| `wordBefore(text, caret)` | `wordAt(text, caret)` | Misleading today — returns the word *ending at the caret* (`'Sar'`), not the previous word |
| `wordsBefore(text, index, count)` | `previousWords(text, index, count)` | Becomes clear once singular `wordBefore` is gone |
| `recordWord(word)` | `learnWord(word)` | Matches "user word learning" in the README |
| `addWord(word)` | keep | Immediate add |
| `removeUserWord(lower)` | `removeWord(word)` | Symmetric with `addWord` |
| `clearUserWords()` / `userWords()` / `enableUserWords()` / `disableUserWords()` | keep | Already obvious |
| `setLanguage(lang)` | keep | |
| `{ text, insertSuffix, source }` | keep | Host-accurate; `insertSuffix` is what editors splice in |
| `promoteThreshold` | `learnAfter` | "Typed twice → suggestible" without the promote metaphor |
| `parseWordList` / `resolveWordList` | keep | Advanced helpers |

## Leave as implementation detail

- On-disk `*.ngram.bin`, magic bytes, `NgramModel` internals — format names, not host names. Renaming files breaks CDN URLs.
- `source: 'bundled'` on results — hosts may already switch on it.
- Trigram/bigram in ranking docs — one sentence of "previous two words, then previous word" is enough; no need for those words in method names.

## Implementation notes

- README and examples switch to the new names; tests cover both.
- Binary files stay `*.ngram.bin`.
