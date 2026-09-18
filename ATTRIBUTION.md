# Word List Attribution

The data files referenced below are generated from [Tatoeba](https://tatoeba.org)
downloads by `tools/build-wordlists.mjs` (configuration:
`tools/wordlist-sources.json`). This file itself is generated from the
per-language records in `attribution/`: building a single language updates its
record and refreshes this file, so per-language builds are preferred over full
rebuilds (`--remove <code>` removes a language).

## Word lists

Bundled lists in `data/` and reference copies in the host project
(`languages/<code>/autocomplete.txt`).

| Language | Source file | License | Sentences | Words kept | Generated |
|---|---|---|---|---|---|
| en | `eng_sentences_CC0.tsv.bz2` | CC0 1.0 | 41,503 | 10,000 | 2026-09-18 |
| fr | `fra_sentences.tsv.bz2` | CC-BY 2.0 FR | 726,280 | 10,000 | 2026-09-17 |
| es | `spa_sentences.tsv.bz2` | CC-BY 2.0 FR | 442,006 | 10,000 | 2026-09-17 |
| de | `deu_sentences.tsv.bz2` | CC-BY 2.0 FR | 780,494 | 10,000 | 2026-09-17 |
| pt | `por_sentences.tsv.bz2` | CC-BY 2.0 FR | 444,455 | 10,000 | 2026-09-17 |
| id | `ind_sentences.tsv.bz2` | CC-BY 2.0 FR | 28,275 | 10,000 | 2026-09-17 |
| ru | `rus_sentences_CC0.tsv.bz2` | CC0 1.0 | 23,035 | 10,000 | 2026-09-17 |
| ar | `ara_sentences.tsv.bz2` | CC-BY 2.0 FR | 68,541 | 10,000 | 2026-09-17 |
| hi | `hin_sentences.tsv.bz2` | CC-BY 2.0 FR | 16,475 | 8,036 | 2026-09-17 |
| bn | `ben_sentences.tsv.bz2` | CC-BY 2.0 FR | 15,813 | 10,000 | 2026-09-18 |

## Composition data

Reading-to-word conversion files used by the host's composition input
(`languages/<code>/composition.txt`); `ja` derives kana readings from Tatoeba's
furigana transcriptions, `zh` derives toneless pinyin readings with
[pinyin-pro](https://github.com/zh-lx/pinyin-pro) (MIT, build-time dependency only).

| Language | Source file | License | Segments | Readings | Generated |
|---|---|---|---|---|---|
| ja | `jpn_transcriptions.tsv.bz2` | CC-BY 2.0 FR | 249,000 | 19,903 | 2026-09-17 |
| zh | `cmn_sentences.tsv.bz2` | CC-BY 2.0 FR | 89,040 | 20,287 | 2026-09-17 |

## Source selection

Both the CC0 and the CC-BY 2.0 FR per-language sentence dumps are downloaded
for each word-list and Mandarin source; the CC0 dump is used when it contains
at least 20,000 sentences, otherwise the
CC-BY dump. The chosen file and license are recorded per language above.
Japanese furigana transcriptions are published under CC-BY 2.0 FR only, so the
Japanese composition data is CC-BY regardless of the sentence dump choice.

## License

CC0 1.0 files are released into the public domain; no attribution is required
(https://creativecommons.org/publicdomain/zero/1.0/). Tatoeba sentences and
transcriptions under CC-BY 2.0 FR (Creative Commons Attribution 2.0 France,
https://creativecommons.org/licenses/by/2.0/fr/) require attribution:
"Tatoeba.org" with a link to https://tatoeba.org. pinyin-pro is MIT licensed
and is used only to build the Mandarin data; it is not shipped or executed at
runtime.

## Transformation

Word lists: NFC normalization, lowercasing, token extraction (per-language
script letters, combining marks, apostrophes and hyphens; minimum length 2),
frequency counting, profanity filtering (`tools/profanity-filter.txt`,
project-owned and user-editable), frequency-descending sort with alphabetical
tie-break, top 10000 retained.

Composition data: CJK word segmentation via `Intl.Segmenter`; for Japanese,
kana readings are taken from the furigana annotations in the transcriptions
dump and katakana is folded to hiragana; for Mandarin, readings are toneless
pinyin with `ü` spelled `v`; candidates are the most frequent words per
reading, the most frequent 5,000 readings retained,
at most 10 candidates each. Profanity filtering applies where a
section for the language exists in `tools/profanity-filter.txt`.

## Superseded content

Lists replaced by this pipeline are retained in the host project
(`languages/<code>/autocomplete-previous.txt`,
`languages/<code>/composition-previous.txt`) for reference only. They include
the pre-pipeline lists of undocumented provenance and the original
machine-assisted curation of the Arabic and Hindi lists.
