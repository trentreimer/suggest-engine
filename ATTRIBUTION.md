# Word List Attribution

The data files referenced below are generated from [Tatoeba](https://tatoeba.org)
downloads and other openly licensed corpora by `tools/build-wordlists.mjs`
(configuration: `tools/wordlist-sources.json`). This file itself is generated
from the per-language records in `attribution/`: building a single language
updates its record and refreshes this file, so per-language builds are preferred
over full rebuilds (`--remove <code>` removes a language).

## Word lists

Bundled lists in `languages/` (word-list modules and `<code>.ngram.bin`
bigram context models) and reference copies in the host project
(`languages/<code>/autocomplete.txt`, `languages/<code>/ngrams.bin`).

| Language | Source file | License | Sentences | Words kept | Bigram contexts | Bigram pairs | Trigram contexts | Trigram pairs | Generated |
|---|---|---|---|---|---|---|---|---|---|
| en | `eng_sentences_CC0.tsv.bz2` | CC0 1.0 | 41,503 | 10,000 | 6,885 | 20,130 | 6,170 | 8,475 | 2026-09-19 |
| fr | `fra_sentences.tsv.bz2` | CC-BY 2.0 FR | 726,753 | 10,000 | 9,820 | 59,373 | 37,358 | 82,334 | 2026-09-19 |
| es | `spa_sentences.tsv.bz2` | CC-BY 2.0 FR | 442,135 | 10,000 | 9,690 | 49,255 | 29,347 | 56,077 | 2026-09-19 |
| de | `deu_sentences.tsv.bz2` | CC-BY 2.0 FR | 781,130 | 10,000 | 9,890 | 61,209 | 39,127 | 92,841 | 2026-09-19 |
| pt | `por_sentences.tsv.bz2` | CC-BY 2.0 FR | 444,636 | 10,000 | 9,576 | 48,409 | 27,956 | 52,946 | 2026-09-19 |
| id | `ind_sentences.tsv.bz2` | CC-BY 2.0 FR | 28,311 | 10,000 | 2,464 | 6,576 | 1,686 | 2,450 | 2026-09-19 |
| ru | `rus_sentences_CC0.tsv.bz2` | CC0 1.0 | 23,036 | 10,000 | 4,400 | 9,008 | 2,039 | 2,462 | 2026-09-19 |
| ar | `ara_sentences.tsv.bz2` | CC-BY 2.0 FR | 68,543 | 10,000 | 4,909 | 11,600 | 2,060 | 2,664 | 2026-09-19 |
| hi | `hin_sentences.tsv.bz2` | CC-BY 2.0 FR | 16,475 | 8,035 | 2,365 | 5,994 | 1,667 | 2,133 | 2026-09-19 |
| bn | `ben_sentences.tsv.bz2` | CC-BY 2.0 FR | 15,813 | 10,000 | 2,856 | 6,200 | 573 | 684 | 2026-09-19 |
| sw | `swh_sentences.tsv.bz2`<br>`swc_sentences.tsv.bz2` | CC-BY 2.0 FR | 28,405 | 10,000 | 4,155 | 10,408 | 1,586 | 2,115 | 2026-09-19 |
| pcm | `1789491984474-cv-corpus-27.0-2026-09-11-pcm.tar.gz`<br>`asr-nigerian-pidgin/nigerian-pidgin-1.0`<br>`CENCOS corpus.zip` | CC0 1.0<br>CC-BY 4.0 | 10,830 | 8,000 | 2,482 | 6,996 | 5,762 | 8,342 | 2026-09-19 |
| it | `ita_sentences.tsv.bz2` | CC-BY 2.0 FR | 987,629 | 10,000 | 9,707 | 58,068 | 37,509 | 85,302 | 2026-09-20 |
| tr | `tur_sentences.tsv.bz2` | CC-BY 2.0 FR | 749,204 | 10,000 | 9,012 | 51,484 | 24,156 | 43,228 | 2026-09-20 |
| vi | `vie_sentences.tsv.bz2` | CC-BY 2.0 FR | 33,184 | 5,013 | 2,410 | 9,441 | 6,213 | 9,164 | 2026-09-20 |
| fa | `pes_sentences.tsv.bz2` | CC-BY 2.0 FR | 31,792 | 10,000 | 4,232 | 11,076 | 1,958 | 2,657 | 2026-09-22 |
| mr | `mar_sentences.tsv.bz2` | CC-BY 2.0 FR | 86,809 | 10,000 | 7,323 | 21,052 | 6,849 | 8,938 | 2026-09-22 |
| ha | `hau_sentences.tsv.bz2` | CC-BY 2.0 FR | 21,848 | 10,000 | 2,665 | 7,739 | 1,962 | 2,881 | 2026-09-20 |
| tl | `tgl_sentences.tsv.bz2` | CC-BY 2.0 FR | 79,097 | 10,000 | 8,307 | 23,374 | 15,349 | 22,225 | 2026-09-20 |
| uk | `ukr_sentences.tsv.bz2` | CC-BY 2.0 FR | 188,811 | 10,000 | 6,799 | 21,913 | 9,259 | 14,017 | 2026-09-20 |
| pl | `pol_sentences.tsv.bz2` | CC-BY 2.0 FR | 137,173 | 10,000 | 6,996 | 20,678 | 6,880 | 9,754 | 2026-09-20 |
| nl | `nld_sentences.tsv.bz2` | CC-BY 2.0 FR | 201,168 | 10,000 | 7,170 | 24,943 | 16,610 | 28,190 | 2026-09-20 |
| ko | `kor_sentences.tsv.bz2` | CC-BY 2.0 FR | 15,940 | 10,000 | 1,470 | 2,646 | 75 | 76 | 2026-09-20 |
| he | `heb_sentences.tsv.bz2` | CC-BY 2.0 FR | 212,692 | 10,000 | 8,373 | 30,134 | 11,342 | 16,485 | 2026-09-20 |
| el | `ell_sentences.tsv.bz2` | CC-BY 2.0 FR | 42,554 | 10,000 | 4,202 | 10,062 | 3,270 | 4,681 | 2026-09-20 |
| ur | `urd_Arab` | CC0 1.0 | 130,101 | 10,000 | 9,995 | 78,747 | 49,410 | 172,735 | 2026-09-20 |
| ta | `tam_Taml (10_1.jsonl.zst)` | CC0 1.0 | 138,949 | 10,000 | 9,986 | 71,840 | 12,851 | 19,882 | 2026-09-20 |
| te | `tel_Telu (10_1.jsonl.zst)` | CC0 1.0 | 106,524 | 10,000 | 9,996 | 78,770 | 27,191 | 52,044 | 2026-09-20 |
| am | `amh_Ethi (10_1.jsonl.zst, 9_1.jsonl.zst)` | CC0 1.0 | 136,073 | 10,000 | 9,997 | 76,136 | 24,248 | 42,235 | 2026-09-20 |
| yo | `yor_Latn` | CC0 1.0 | 136,493 | 10,000 | 9,912 | 58,096 | 44,341 | 109,335 | 2026-09-20 |
| zu | `zul_Latn (10_1.jsonl.zst, 9_1.jsonl.zst)` | CC0 1.0 | 134,197 | 10,000 | 9,993 | 72,539 | 21,220 | 34,185 | 2026-09-20 |
| gu | `guj_Gujr (10_1.jsonl.zst, 9_1.jsonl.zst)` | CC0 1.0 | 132,912 | 10,000 | 9,996 | 78,342 | 36,934 | 82,609 | 2026-09-20 |
| pa | `pan_Guru (10_1.jsonl.zst, 9_1.jsonl.zst)` | CC0 1.0 | 123,313 | 10,000 | 9,997 | 78,480 | 46,392 | 138,141 | 2026-09-20 |
| ml | `mal_Mlym (10_1.jsonl.zst)` | CC0 1.0 | 137,257 | 10,000 | 9,966 | 69,629 | 8,175 | 11,705 | 2026-09-20 |
| kn | `kan_Knda (10_1.jsonl.zst, 9_1.jsonl.zst)` | CC0 1.0 | 137,802 | 10,000 | 9,981 | 72,708 | 11,451 | 17,845 | 2026-09-20 |
| om | `gaz_Latn (10_1.jsonl.zst, 9_1.jsonl.zst, 8_1.jsonl.zst)` | CC0 1.0 | 131,196 | 10,000 | 9,974 | 74,389 | 30,796 | 61,482 | 2026-09-20 |
| ig | `ibo_Latn (9_1.jsonl.zst, 8_1.jsonl.zst)` | CC0 1.0 | 136,374 | 10,000 | 9,954 | 58,849 | 43,138 | 100,947 | 2026-09-20 |
| xh | `xho_Latn (10_1.jsonl.zst, 9_1.jsonl.zst)` | CC0 1.0 | 131,796 | 10,000 | 9,985 | 68,056 | 23,353 | 38,121 | 2026-09-20 |
| so | `som_Latn` | CC0 1.0 | 140,518 | 10,000 | 9,994 | 75,095 | 34,916 | 73,440 | 2026-09-20 |
| sn | `sna_Latn` | CC0 1.0 | 136,240 | 10,000 | 9,983 | 69,243 | 21,171 | 36,721 | 2026-09-20 |
| rw | `kin_Latn` | CC0 1.0 | 136,019 | 10,000 | 9,989 | 73,984 | 31,967 | 63,042 | 2026-09-20 |
| ny | `nya_Latn (10_1.jsonl.zst, 9_1.jsonl.zst)` | CC0 1.0 | 136,301 | 10,000 | 9,983 | 67,986 | 31,480 | 60,577 | 2026-09-20 |
| wo | `wol_Latn (9_1.jsonl.zst, 8_1.jsonl.zst, 7_1.jsonl.zst, 6_1.jsonl.zst, 5_1.jsonl.zst)` | CC0 1.0 | 136,129 | 10,000 | 9,925 | 61,344 | 41,106 | 87,830 | 2026-09-20 |

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
for each Tatoeba source; the CC0 dump is used when it contains at least
20,000 sentences, otherwise the CC-BY
dump. Languages may combine several sources (for example Swahili uses the
`swh` and `swc` dumps), and every chosen file and license is recorded per
language above. Japanese furigana transcriptions are published under CC-BY 2.0
FR only, so the Japanese composition data is CC-BY regardless of the sentence
dump choice.

## Manually cached corpora

These sources cannot be downloaded automatically by the build script. Download
the archive from the link below and save it under `tools/.cache/` with a name
matching the listed pattern (browser-added timestamp prefixes are fine); the
build streams the corpus file out of the archive without extracting it, and
explicit builds fail with instructions while it is missing.

- `pcm`: `1789491984474-cv-corpus-27.0-2026-09-11-pcm.tar.gz` — Common Voice (CC0 1.0), from https://mozilladatacollective.com/datasets/cmu5ufsxn007snq07xuxba0uc

## Source credits

The following sources require attribution when the bundled data is
redistributed:

- Rufai, A. M., Abeeb, A., Oduntan, E., Arulogun, T., Adegboro, O., & Ajisafe, D. (2025). Towards End-to-End Training of Automatic Speech Recognition for Nigerian Pidgin. arXiv:2010.11123. Dataset: asr-nigerian-pidgin/nigerian-pidgin-1.0, https://huggingface.co/datasets/asr-nigerian-pidgin/nigerian-pidgin-1.0 (CC-BY 4.0)
- Agbo, O. F., & Plag, I. (2022). Corpus of English and Nigerian Pidgin Code-switching (CENCOS), https://doi.org/10.5281/zenodo.7314016 (CC-BY 4.0)
- HPLT v3.0 (High Performance Language Technologies), CC0 1.0, https://hplt-project.org/datasets/v3.0 (CC0 1.0)

## License

CC0 1.0 files are released into the public domain; no attribution is required
(https://creativecommons.org/publicdomain/zero/1.0/). Tatoeba sentences and
transcriptions under CC-BY 2.0 FR (Creative Commons Attribution 2.0 France,
https://creativecommons.org/licenses/by/2.0/fr/) require attribution:
"Tatoeba.org" with a link to https://tatoeba.org. Non-Tatoeba sources are
credited with their licenses in the tables above; CC0 sources require no
attribution but are recorded for provenance. The profanity filter used during
generation includes entries derived from the Shutterstock LDNOOBW list
(CC-BY 4.0,
https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words)
and its CC0 V2 follow-up
(https://github.com/LDNOOBWV2/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words_V2),
trimmed to entries that occur in the bundled word lists. pinyin-pro is MIT
licensed and is used only to build the Mandarin data; it is not shipped or
executed at runtime.

## Transformation

Word lists: NFC normalization, lowercasing, token extraction (per-language
script letters, combining marks, apostrophes and hyphens, plus corpus-derived
per-language connector characters such as ZWNJ/ZWJ, shipped in
`languages/word-chars.js`; minimum length 2),
frequency counting, profanity filtering (`tools/profanity-filter.txt`,
project-owned and user-editable), frequency-descending sort with alphabetical
tie-break, top 10000 retained.

Context models: bigram counts are accumulated over the same sentence dumps
between consecutive retained vocabulary words within a sentence; successors
occurring fewer than 2 times are dropped and at most
8 successors are kept per context, ranked by count with an
alphabetical tie-break. Trigram counts are accumulated for word pairs occurring
at least 3 times, capped at the
50000 most frequent pairs per language, with
successors occurring fewer than 3 times dropped and at
most 4 successors kept per pair. Both tables
live in `languages/<code>.ngram.bin` as separate sections and reference positions in
the bundled word list, validated against it by hash at load time.

Composition data: CJK word segmentation via `Intl.Segmenter`; for Japanese,
kana readings are taken from the furigana annotations in the transcriptions
dump and katakana is folded to hiragana; for Mandarin, readings are toneless
pinyin with `ü` spelled `v`; candidates are the most frequent words per
reading, the most frequent 5,000 readings retained,
at most 10 candidates each. Profanity filtering applies where a
section for the language exists in `tools/profanity-filter.txt`.

## Superseded content

When HOST_DIR is set, lists replaced by this pipeline are retained in the host
project (`languages/<code>/autocomplete-previous.txt`,
`languages/<code>/composition-previous.txt`,
`languages/<code>/ngrams-previous.bin`) for reference only. They include
the pre-pipeline lists of undocumented provenance and the original
machine-assisted curation of the Arabic and Hindi lists.
