import { createReadStream, createWriteStream, existsSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createZstdDecompress } from 'node:zlib';
import { basename, join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodeNgramModel, fnv1a } from './ngram-format.mjs';
import { parseWordList } from '../src/word-lists.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const libDir = join(__dirname, '..');
const bundledDir = join(libDir, 'languages');
// Host reference copies (autocomplete.txt, ngrams.bin, composition.txt) are
// written only when HOST_DIR points at a host project root — builds never
// touch sibling checkouts otherwise.
const hostLanguagesDir = process.env.HOST_DIR ? join(resolve(process.env.HOST_DIR), 'languages') : null;
const cacheDir = join(__dirname, '.cache');

const config = JSON.parse(readFileSync(join(__dirname, 'wordlist-sources.json'), 'utf8'));
const manifestOrder = Object.keys(config.languages).filter(code => config.languages[code].mode !== 'composition');

const scriptRanges = {
    Latn: '\\p{Script=Latn}',
    Cyrl: '\\p{Script=Cyrl}',
    Arab: '\\p{Script=Arab}',
    Deva: '\\p{Script=Deva}',
    Beng: '\\p{Script=Beng}',
    Grek: '\\p{Script=Grek}',
    Hebr: '\\p{Script=Hebr}',
    Hang: '\\p{Script=Hang}',
    Taml: '\\p{Script=Taml}',
    Telu: '\\p{Script=Telu}',
    Gujr: '\\p{Script=Gujr}',
    Guru: '\\p{Script=Guru}',
    Mlym: '\\p{Script=Mlym}',
    Knda: '\\p{Script=Knda}',
    Ethi: '\\p{Script=Ethi}',
};

const jaSegmenter = new Intl.Segmenter('ja', { granularity: 'word' });
const zhSegmenter = new Intl.Segmenter('zh', { granularity: 'word' });

function loadProfanityFilter() {
    const filter = {};
    let current = null;

    for (const line of readFileSync(join(__dirname, 'profanity-filter.txt'), 'utf8').split('\n')) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith('#')) continue;

        const section = trimmed.match(/^\[(\w+)\]$/);

        if (section) {
            current = section[1].toLowerCase();
            filter[current] = new Set();
        } else if (current) {
            filter[current].add(trimmed.normalize('NFC').toLowerCase());
        }
    }

    return filter;
}

function escapeForCharacterClass(chars) {
    return chars.replace(/[\\\]\^-]/g, '\\$&');
}

// Connector candidates: format characters a language's orthography may use
// inside words. Whether a language actually uses one is derived from its
// corpus and shipped in languages/word-chars.js; hosts never configure this.
const connectorCandidates = '\u200C\u200D';

function tokenize(sentence, script, extras = '') {
    const normalized = sentence.normalize('NFC').toLowerCase();
    const connectors = escapeForCharacterClass(`'-${extras}`);
    const tokenRegex = new RegExp(`[${scriptRanges[script]}\\p{M}${connectors}]+`, 'gu');
    const edgeTrim = new RegExp(`^[${connectors}]+|[${connectors}]+$`, 'gu');
    const invalidToken = new RegExp(`[^\\p{L}\\p{M}\\p{N}${connectors}]`, 'u');
    const tokens = [];

    for (const match of normalized.matchAll(tokenRegex)) {
        const token = match[0].replace(edgeTrim, '');

        if (token.length < 2) continue;
        // Script classes also match script-specific punctuation; keep tokens parseWordList preserves.
        if (invalidToken.test(token)) continue;

        tokens.push(token);
    }

    return tokens;
}

/**
 * Connector characters a language's retained words actually use, restricted to
 * the candidate set; shipped to runtime in languages/word-chars.js.
 */
function deriveWordChars(words, candidates = connectorCandidates) {
    return [...new Set(words.join(''))].filter(ch => candidates.includes(ch)).join('');
}

function kataToHira(text) {
    return text.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function normalizeReading(text) {
    return kataToHira(text.normalize('NFC').toLowerCase().replaceAll(' ', ''));
}

function parseFurigana(annotated) {
    const surfaceUnits = [];
    const kanaParts = [];
    const aligns = [];
    const unitToAlign = [];
    let kanaLength = 0;

    const pushPlain = text => {
        for (const ch of text) {
            const alignIndex = aligns.length;

            aligns.push({ start: kanaLength, end: kanaLength + ch.length });
            for (let i = 0; i < ch.length; i++) unitToAlign.push(alignIndex);
            surfaceUnits.push(ch);
            kanaParts.push(ch);
            kanaLength += ch.length;
        }
    };

    const pushPair = (ch, reading) => {
        const alignIndex = aligns.length;

        aligns.push({ start: kanaLength, end: kanaLength + reading.length });
        for (let i = 0; i < ch.length; i++) unitToAlign.push(alignIndex);
        surfaceUnits.push(ch);
        kanaParts.push(reading);
        kanaLength += reading.length;
    };

    const re = /\[([^\]]+)\]/g;
    let last = 0;
    let match;

    while ((match = re.exec(annotated))) {
        pushPlain(annotated.slice(last, match.index));
        last = re.lastIndex;

        const inner = match[1].split('|');
        const seg = inner[0];
        const reading = inner.slice(1).join('');

        if (!reading) {
            pushPlain(seg);
            continue;
        }

        const segStart = kanaLength;
        const segChars = [...seg];

        if (inner.length === 2 && segChars.length === [...reading].length) {
            const readingChars = [...reading];

            for (let i = 0; i < segChars.length; i++) pushPair(segChars[i], readingChars[i]);
        } else {
            const blockEnd = segStart + reading.length;

            for (let i = 0; i < segChars.length; i++) {
                const alignIndex = aligns.length;

                aligns.push(i === 0 ? { start: segStart, end: blockEnd } : { start: blockEnd, end: blockEnd });
                for (let j = 0; j < segChars[i].length; j++) unitToAlign.push(alignIndex);
                surfaceUnits.push(segChars[i]);
            }

            kanaParts.push(reading);
            kanaLength = blockEnd;
        }
    }

    pushPlain(annotated.slice(last));

    return { surface: surfaceUnits.join(''), kana: kanaParts.join(''), aligns, unitToAlign };
}

const wordClass = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30FC]';

function extractJaReadings(annotated, byReading) {
    const { surface, kana, aligns, unitToAlign } = parseFurigana(annotated);

    if (!/\p{Script=Han}/u.test(surface)) return;

    for (const seg of jaSegmenter.segment(surface)) {
        if (!seg.isWordLike) continue;

        const word = seg.segment;

        if (!/\p{Script=Han}/u.test(word)) continue;
        if (!new RegExp(`^${wordClass}+$`, 'u').test(word)) continue;

        const firstAlign = unitToAlign[seg.index];
        const lastAlign = unitToAlign[seg.index + word.length - 1];

        if (firstAlign === undefined || lastAlign === undefined) continue;

        const start = aligns[firstAlign].start;
        const end = aligns[lastAlign].end;

        if (end <= start) continue;

        const raw = kana.slice(start, end);

        if (!new RegExp(`^[\\p{Script=Hiragana}\\p{Script=Katakana}\\u30FC]+$`, 'u').test(raw)) continue;

        const reading = normalizeReading(raw);

        if (!reading) continue;

        if (!byReading.has(reading)) byReading.set(reading, new Map());

        const words = byReading.get(reading);

        words.set(word, (words.get(word) || 0) + 1);
    }
}

function extractZhReadings(text, byReading, pinyinFn) {
    for (const seg of zhSegmenter.segment(text)) {
        if (!seg.isWordLike) continue;

        const word = seg.segment;

        if (!/^[\p{Script=Han}]+$/u.test(word)) continue;

        const reading = pinyinFn(word, { toneType: 'none', type: 'array', v: true }).join('');

        if (!/^[a-z]+$/.test(reading)) continue;

        if (!byReading.has(reading)) byReading.set(reading, new Map());

        const words = byReading.get(reading);

        words.set(word, (words.get(word) || 0) + 1);
    }
}

function emitComposition(byReading, banned, topReadings, maxCandidates) {
    const totals = [...byReading.entries()].map(([reading, words]) => {
        let total = 0;

        for (const count of words.values()) total += count;

        return { reading, total };
    });

    totals.sort((a, b) => b.total - a.total || (a.reading < b.reading ? -1 : a.reading > b.reading ? 1 : 0));

    const lines = [];

    for (const { reading } of totals.slice(0, topReadings)) {
        const words = [...byReading.get(reading).entries()]
            .filter(([word]) => !banned.has(word))
            .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .slice(0, maxCandidates)
            .map(([word]) => word);

        if (!words.length) continue;

        lines.push([reading, ...words].join(' '));
    }

    return lines.join('\n') + (lines.length ? '\n' : '');
}

function extractText(line, dump) {
    if (dump.format === 'text') return line;

    const parts = line.split('\t');

    if (dump.format === 'commonvoice') return parts[dump.sentenceColumn] ?? '';

    if (parts.length >= 3) return parts[2];
    if (parts.length === 2) return parts[1];

    return '';
}

async function download(url, dest) {
    const response = await fetch(url);

    if (!response.ok) throw new Error(`Download failed for ${url}: ${response.status}`);

    await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}

function decompressLines(path, onLine) {
    if (!path.endsWith('.bz2')) {
        return new Promise((resolve, reject) => {
            const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });

            rl.on('line', onLine);
            rl.on('close', resolve);
            rl.on('error', reject);
        });
    }

    return new Promise((resolve, reject) => {
        const child = spawn('bzip2', ['-dc', path]);
        const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
        let exitCode = null;
        let closed = false;

        const finish = () => exitCode === 0 ? resolve() : reject(new Error(`bzip2 exited with ${exitCode}`));

        rl.on('line', onLine);
        rl.on('close', () => {
            closed = true;
            if (exitCode !== null) finish();
        });
        child.on('exit', code => {
            exitCode = code;
            if (closed) finish();
        });
        child.on('error', reject);
    });
}

async function countLines(bz2Path) {
    let count = 0;

    await decompressLines(bz2Path, () => count++);

    return count;
}

function backupIfNonEmpty(path, previousPath) {
    if (existsSync(path) && readFileSync(path, 'utf8').trim()) copyFileSync(path, previousPath);
}

const attributionDir = join(libDir, 'attribution');

function writeIfChanged(path, text) {
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;

    writeFileSync(path, text);

    return true;
}

function writeWithBackup(path, previousPath, text) {
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;

    backupIfNonEmpty(path, previousPath);
    writeFileSync(path, text);

    return true;
}

function writeBufferIfChanged(path, buffer) {
    if (existsSync(path) && readFileSync(path).equals(buffer)) return false;

    writeFileSync(path, buffer);

    return true;
}

function writeBufferWithBackup(path, previousPath, buffer) {
    if (existsSync(path) && readFileSync(path).equals(buffer)) return false;

    if (existsSync(path) && readFileSync(path).length > 0) copyFileSync(path, previousPath);

    writeFileSync(path, buffer);

    return true;
}

function recordSources(record) {
    if (Array.isArray(record.sources)) return record.sources;
    if (!record.sourceFile) return [];

    return [{ name: 'Tatoeba', file: record.sourceFile, url: record.sourceUrl, license: record.license, sentences: record.sentences }];
}

function attributionRecord(stat, generated) {
    const sources = stat.dumps.map(dump => {
        const source = {
            name: dump.name,
            file: dump.file,
            url: dump.url,
            license: dump.license,
            sentences: dump.sentences,
        };

        if (dump.attribution) source.attribution = dump.attribution;
        if (dump.manual) source.manual = true;

        return source;
    });
    const record = {
        code: stat.code,
        mode: stat.mode,
        sources,
        sentences: sources.reduce((total, source) => total + source.sentences, 0),
    };

    if (stat.mode === 'words') {
        record.tokens = stat.tokens;
        record.kept = stat.kept;

        if (stat.ngrams) {
            record.ngramContexts = stat.ngrams.contexts;
            record.ngramPairs = stat.ngrams.pairs;
            record.trigramContexts = stat.ngrams.trigramContexts;
            record.trigramPairs = stat.ngrams.trigramPairs;
            record.ngramBytes = stat.ngrams.bytes;
        }
    } else {
        record.readings = stat.readings;
    }

    record.generated = generated;

    return record;
}

function writeAttributionRecords(stats) {
    mkdirSync(attributionDir, { recursive: true });

    const generated = new Date().toISOString().substring(0, 10);
    const changed = [];

    for (const stat of stats) {
        const record = attributionRecord(stat, generated);

        if (writeIfChanged(join(attributionDir, `${stat.code}.json`), JSON.stringify(record, null, 4) + '\n')) changed.push(stat.code);
    }

    return changed;
}

function regenerateManifest(exclude = []) {
    const codes = manifestOrder.filter(code => !exclude.includes(code) && existsSync(join(bundledDir, `${code}.js`)));
    const text = 'export default {\n' + codes.map(code => `    ${code}: () => import('./${code}.js'),`).join('\n') + '\n};\n';

    return writeIfChanged(join(bundledDir, 'index.js'), text);
}

function escapeStringLiteral(text) {
    return [...text].map(ch => {
        const point = ch.codePointAt(0);

        return point > 0xFFFF ? `\\u{${point.toString(16)}}` : `\\u${point.toString(16).padStart(4, '0')}`;
    }).join('');
}

/**
 * Merges per-language connector characters ({ [code]: string | null }) into
 * languages/word-chars.js — the static map the runtime tokenizes with. Codes
 * without entries (or with null) tokenize with apostrophes and hyphens only.
 */
async function mergeWordChars(updates) {
    const wordCharsPath = join(bundledDir, 'word-chars.js');
    let map = {};

    if (existsSync(wordCharsPath)) {
        try {
            map = (await import(pathToFileURL(wordCharsPath).href)).default ?? {};
        } catch (err) {
            map = {};
        }
    }

    for (const [code, chars] of Object.entries(updates)) {
        if (chars) map[code] = chars;
        else delete map[code];
    }

    const ordered = {};

    for (const code of manifestOrder) if (map[code]) ordered[code] = map[code];

    for (const code of Object.keys(map)) if (!ordered[code] && map[code]) ordered[code] = map[code];

    const entries = Object.entries(ordered)
        .map(([code, chars]) => `    ${/^[a-z][a-z0-9-]*$/i.test(code) ? code : JSON.stringify(code)}: '${escapeStringLiteral(chars)}',`);
    const text = 'export default ' + (entries.length ? '{\n' + entries.join('\n') + '\n};\n' : '{};\n');

    return writeIfChanged(wordCharsPath, text);
}

function loadAttributionRecords() {
    if (!existsSync(attributionDir)) return [];

    return readdirSync(attributionDir)
        .filter(name => name.endsWith('.json'))
        .sort()
        .map(name => JSON.parse(readFileSync(join(attributionDir, name), 'utf8')))
        .sort((a, b) => {
            const ai = manifestOrder.indexOf(a.code);
            const bi = manifestOrder.indexOf(b.code);
            const av = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
            const bv = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;

            return av - bv || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
        });
}

function sourceCells(record) {
    const sources = recordSources(record);
    const files = sources.map(source => `\`${source.file}\``).join('<br>');
    const licenses = [...new Set(sources.map(source => source.license))].join('<br>');
    const sentences = record.sentences ?? sources.reduce((total, source) => total + (source.sentences || 0), 0);

    return { files, licenses, sentences };
}

function regenerateAttribution() {
    const records = loadAttributionRecords();
    const wordRows = records
        .filter(record => record.mode === 'words')
        .map(record => {
            const { files, licenses, sentences } = sourceCells(record);

            return `| ${record.code} | ${files} | ${licenses} | ${sentences.toLocaleString('en')} | ${record.kept.toLocaleString('en')} | ${record.ngramContexts ? record.ngramContexts.toLocaleString('en') : '—'} | ${record.ngramPairs ? record.ngramPairs.toLocaleString('en') : '—'} | ${record.trigramContexts ? record.trigramContexts.toLocaleString('en') : '—'} | ${record.trigramPairs ? record.trigramPairs.toLocaleString('en') : '—'} | ${record.generated} |`;
        })
        .join('\n');
    const compositionRows = records
        .filter(record => record.mode === 'composition')
        .map(record => {
            const { files, licenses, sentences } = sourceCells(record);

            return `| ${record.code} | ${files} | ${licenses} | ${sentences.toLocaleString('en')} | ${record.readings.toLocaleString('en')} | ${record.generated} |`;
        })
        .join('\n');
    const manualSources = records.flatMap(record => recordSources(record)
        .filter(source => source.manual)
        .map(source => ({ code: record.code, ...source })));
    const creditSources = records.flatMap(record => recordSources(record)
        .filter(source => source.attribution)
        .map(source => ({ code: record.code, ...source })))
        .filter((source, index, all) => all.findIndex(entry => entry.attribution === source.attribution) === index);
    const manualSection = manualSources.length
        ? `
## Manually cached corpora

These sources cannot be downloaded automatically by the build script. Download
the archive from the link below and save it under \`tools/.cache/\` with a name
matching the listed pattern (browser-added timestamp prefixes are fine); the
build streams the corpus file out of the archive without extracting it, and
explicit builds fail with instructions while it is missing.

${manualSources.map(source => `- \`${source.code}\`: \`${source.file}\` — ${source.name} (${source.license}), from ${source.url}`).join('\n')}
`
        : '';
    const creditSection = creditSources.length
        ? `
## Source credits

The following sources require attribution when the bundled data is
redistributed:

${creditSources.map(source => `- ${source.attribution} (${source.license})`).join('\n')}
`
        : '';

    const text = `# Word List Attribution

The data files referenced below are generated from [Tatoeba](https://tatoeba.org)
downloads and other openly licensed corpora by \`tools/build-wordlists.mjs\`
(configuration: \`tools/wordlist-sources.json\`). This file itself is generated
from the per-language records in \`attribution/\`: building a single language
updates its record and refreshes this file, so per-language builds are preferred
over full rebuilds (\`--remove <code>\` removes a language).

## Word lists

Bundled lists in \`languages/\` (word-list modules and \`<code>.ngram.bin\`
bigram context models) and reference copies in the host project
(\`languages/<code>/autocomplete.txt\`, \`languages/<code>/ngrams.bin\`).

| Language | Source file | License | Sentences | Words kept | Bigram contexts | Bigram pairs | Trigram contexts | Trigram pairs | Generated |
|---|---|---|---|---|---|---|---|---|---|
${wordRows}

## Composition data

Reading-to-word conversion files used by the host's composition input
(\`languages/<code>/composition.txt\`); \`ja\` derives kana readings from Tatoeba's
furigana transcriptions, \`zh\` derives toneless pinyin readings with
[pinyin-pro](https://github.com/zh-lx/pinyin-pro) (MIT, build-time dependency only).

| Language | Source file | License | Segments | Readings | Generated |
|---|---|---|---|---|---|
${compositionRows}

## Source selection

Both the CC0 and the CC-BY 2.0 FR per-language sentence dumps are downloaded
for each Tatoeba source; the CC0 dump is used when it contains at least
${config.cc0MinSentences.toLocaleString('en')} sentences, otherwise the CC-BY
dump. Languages may combine several sources (for example Swahili uses the
\`swh\` and \`swc\` dumps), and every chosen file and license is recorded per
language above. Japanese furigana transcriptions are published under CC-BY 2.0
FR only, so the Japanese composition data is CC-BY regardless of the sentence
dump choice.
${manualSection}${creditSection}
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
\`languages/word-chars.js\`; minimum length 2),
frequency counting, profanity filtering (\`tools/profanity-filter.txt\`,
project-owned and user-editable), frequency-descending sort with alphabetical
tie-break, top ${config.topN} retained.

Context models: bigram counts are accumulated over the same sentence dumps
between consecutive retained vocabulary words within a sentence; successors
occurring fewer than ${config.ngramMinCount ?? 2} times are dropped and at most
${config.ngramTopK ?? 8} successors are kept per context, ranked by count with an
alphabetical tie-break. Trigram counts are accumulated for word pairs occurring
at least ${config.trigramMinPairCount ?? 3} times, capped at the
${config.trigramMaxContexts ?? 50000} most frequent pairs per language, with
successors occurring fewer than ${config.trigramMinCount ?? 3} times dropped and at
most ${config.trigramTopK ?? 4} successors kept per pair. Both tables
live in \`languages/<code>.ngram.bin\` as separate sections and reference positions in
the bundled word list, validated against it by hash at load time.

Composition data: CJK word segmentation via \`Intl.Segmenter\`; for Japanese,
kana readings are taken from the furigana annotations in the transcriptions
dump and katakana is folded to hiragana; for Mandarin, readings are toneless
pinyin with \`ü\` spelled \`v\`; candidates are the most frequent words per
reading, the most frequent ${config.compositionTopReadings.toLocaleString('en')} readings retained,
at most ${config.compositionMaxCandidates} candidates each. Profanity filtering applies where a
section for the language exists in \`tools/profanity-filter.txt\`.

## Superseded content

When HOST_DIR is set, lists replaced by this pipeline are retained in the host
project (\`languages/<code>/autocomplete-previous.txt\`,
\`languages/<code>/composition-previous.txt\`,
\`languages/<code>/ngrams-previous.bin\`) for reference only. They include
the pre-pipeline lists of undocumented provenance and the original
machine-assisted curation of the Arabic and Hindi lists.
`;

    return writeIfChanged(join(libDir, 'ATTRIBUTION.md'), text);
}

async function removeLanguages(codes) {
    mkdirSync(bundledDir, { recursive: true });
    mkdirSync(attributionDir, { recursive: true });

    for (const code of codes) {
        for (const path of [join(bundledDir, `${code}.js`), join(bundledDir, `${code}.ngram.bin`), join(attributionDir, `${code}.json`)]) {
            if (existsSync(path)) {
                rmSync(path);
                console.log(`[${code}] removed ${path}`);
            } else {
                console.log(`[${code}] nothing to remove at ${path}`);
            }
        }
    }

    regenerateManifest(codes);
    regenerateAttribution();

    await mergeWordChars(Object.fromEntries(codes.map(code => [code, null])));

    console.log('\nBundled lists removed. Host-side cleanup left to you, if applicable:');
    console.log('  - languages/<code>/ folder (keyboards, translations, reference word list, ngrams.bin and its backup)');
    console.log('  - registry entry in js/languages.js');
    console.log('  - [<code>] section in tools/profanity-filter.txt');
    console.log('  - entry in tools/wordlist-sources.json (full builds would otherwise re-add it)');
}

function escapeTemplateLiteral(text) {
    return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function dumpUrls(tatoebaCode) {
    return {
        ccby: `${config.ccbyBaseUrl}/${tatoebaCode}/${tatoebaCode}_sentences.tsv.bz2`,
        cc0: `${config.ccbyBaseUrl}/${tatoebaCode}/${tatoebaCode}_sentences_CC0.tsv.bz2`,
    };
}

/**
 * Downloads are cached under tools/.cache/ (keyed by URL filename) and kept
 * between runs, so repeated builds do not re-download the same files.
 */
async function downloadIfMissing(url, dest, label) {
    if (existsSync(dest)) {
        console.log(`[${label}] cached (${dest})`);
        return;
    }

    console.log(`[${label}] downloading ${url}`);
    await download(url, dest);
}

function languageSources(meta) {
    if (Array.isArray(meta.sources)) return meta.sources;

    return meta.tatoebaCode ? [{ type: 'tatoeba', code: meta.tatoebaCode }] : [];
}

async function chooseTatoebaDump(code, meta, source, cache) {
    const tatoebaCode = source.code;
    const urls = dumpUrls(tatoebaCode);
    const ccbyPath = join(cache, `${tatoebaCode}_sentences.tsv.bz2`);
    const cc0Path = join(cache, `${tatoebaCode}_sentences_CC0.tsv.bz2`);

    await downloadIfMissing(urls.ccby, ccbyPath, code);

    let cc0Count = 0;

    try {
        await downloadIfMissing(urls.cc0, cc0Path, code);
        cc0Count = await countLines(cc0Path);
    } catch (err) {
        console.log(`[${code}] CC0 dump unavailable for ${tatoebaCode} (${err.message}); falling back to CC-BY`);
    }

    const ccbyCount = await countLines(ccbyPath);
    const threshold = source.cc0MinSentences ?? meta.cc0MinSentences ?? config.cc0MinSentences;

    if (cc0Count >= threshold) {
        return { name: 'Tatoeba', path: cc0Path, file: `${tatoebaCode}_sentences_CC0.tsv.bz2`, url: urls.cc0, license: 'CC0 1.0', sentences: cc0Count, format: 'tatoeba' };
    }

    return { name: 'Tatoeba', path: ccbyPath, file: `${tatoebaCode}_sentences.tsv.bz2`, url: urls.ccby, license: 'CC-BY 2.0 FR', sentences: ccbyCount, format: 'tatoeba' };
}

function sha256File(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function md5File(path) {
    return createHash('md5').update(readFileSync(path)).digest('hex');
}

function escapeRegExp(text) {
    return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function findCacheFiles(cache, pattern) {
    if (!pattern.includes('*')) {
        const path = join(cache, pattern);

        return existsSync(path) ? [path] : [];
    }

    const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);

    return readdirSync(cache).filter(name => regex.test(name)).sort().map(name => join(cache, name));
}

function tarLines(archive, entry, onLine) {
    return new Promise((resolve, reject) => {
        const child = spawn('tar', ['-xzOf', archive, entry]);
        const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
        let exitCode = null;
        let closed = false;

        const finish = () => exitCode === 0 ? resolve() : reject(new Error(`tar exited with ${exitCode}`));

        rl.on('line', onLine);
        rl.on('close', () => {
            closed = true;
            if (exitCode !== null) finish();
        });
        child.on('exit', code => {
            exitCode = code;
            if (closed) finish();
        });
        child.on('error', reject);
    });
}

function readDumpLines(dump, onLine) {
    return dump.archiveEntry ? tarLines(dump.path, dump.archiveEntry, onLine) : decompressLines(dump.path, onLine);
}

function findArchiveEntry(archive, wanted) {
    return new Promise((resolve, reject) => {
        const child = spawn('tar', ['-tzf', archive]);
        let out = '';

        child.stdout.on('data', chunk => {
            out += chunk;
        });
        child.on('error', reject);
        child.on('exit', code => {
            if (code !== 0) {
                reject(new Error(`tar exited with ${code} while listing ${archive}`));
                return;
            }

            const match = out.split('\n').filter(Boolean).find(entry => entry === wanted || entry.endsWith(`/${wanted}`));

            if (!match) {
                reject(new Error(`archive ${archive} has no ${wanted}`));
                return;
            }

            resolve(match);
        });
    });
}

function firstArchiveLine(archive, entry) {
    return new Promise((resolve, reject) => {
        const child = spawn('tar', ['-xzOf', archive, entry]);
        const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
        let settled = false;

        rl.on('line', line => {
            if (settled) return;

            settled = true;
            child.kill();
            resolve(line);
        });
        rl.on('close', () => {
            if (settled) return;

            settled = true;
            reject(new Error(`archive ${archive} has no data for ${entry}`));
        });
        child.on('error', err => {
            if (settled) return;

            settled = true;
            reject(err);
        });
    });
}

async function resolveCommonVoiceDump(code, source, cache, required = true) {
    const candidates = findCacheFiles(cache, source.cacheFile);
    const pinned = source.sha256 ? candidates.find(candidate => sha256File(candidate) === source.sha256) : undefined;
    const path = pinned ?? candidates[0];

    if (!path) {
        if (!required) {
            console.log(`[${code}] skipping "${source.dataset}": no cached file matches ${source.cacheFile}`);
            return null;
        }

        throw new Error(
            `[${code}] Common Voice corpus not found in ${cache} (looking for ${source.cacheFile})\n` +
            `  Download "${source.dataset}" (${source.license}) from:\n` +
            `    ${source.url}\n` +
            `  (a free Mozilla Data Collective account is required) and save the archive\n` +
            `  in ${cache}; the build streams ${source.archiveFile} from it, no extraction\n` +
            `  needed, and the timestamp prefix some browsers add to the name is fine.`
        );
    }

    const actual = sha256File(path);

    if (source.sha256 && actual !== source.sha256) {
        throw new Error(`[${code}] sha256 mismatch for ${path}: expected ${source.sha256}, got ${actual}`);
    }

    if (!source.sha256) console.log(`[${code}] ${basename(path)} sha256 ${actual} (pin it in wordlist-sources.json)`);

    let archiveEntry = null;
    let header;

    if (/\.(tar\.gz|tgz)$/i.test(path)) {
        archiveEntry = await findArchiveEntry(path, source.archiveFile);
        header = await firstArchiveLine(path, archiveEntry);
    } else {
        header = readFileSync(path, 'utf8').split('\n', 1)[0];
    }

    const sentenceColumn = header.split('\t').indexOf('sentence');

    if (sentenceColumn === -1) throw new Error(`[${code}] ${path} has no "sentence" column`);

    const dump = {
        name: source.name ?? 'Common Voice',
        path,
        file: basename(path),
        url: source.url,
        license: source.license ?? 'CC0 1.0',
        attribution: source.attribution,
        manual: source.manual,
        sentences: 0,
        format: 'commonvoice',
        sentenceColumn,
        skipHeader: true,
        dedupe: true,
        archiveEntry,
    };

    await forEachText([dump], () => {
        dump.sentences ++;
    });

    return dump;
}

async function fetchJson(url, attempts = 4) {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await fetch(url);

            if (response.ok) return await response.json();

            lastError = new Error(`${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);

            if (response.status < 500 || attempt === attempts) break;
        } catch (err) {
            lastError = err;
        }

        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }

    throw lastError;
}

async function resolveHuggingFaceDump(code, source, cache) {
    const path = join(cache, source.cacheFile);
    const textField = source.textField ?? 'sentence';
    let sentences;

    if (existsSync(path)) {
        sentences = readFileSync(path, 'utf8').split('\n').filter(Boolean);
        console.log(`[${code}] cached ${source.cacheFile} (${sentences.length} rows)`);
    } else {
        sentences = [];

        for (const split of source.splits) {
            let offset = 0;
            let total = Infinity;

            while (offset < total) {
                const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(source.dataset)}&config=${encodeURIComponent(source.config ?? 'default')}&split=${encodeURIComponent(split)}&offset=${offset}&length=100`;
                const page = await fetchJson(url).catch(err => {
                    throw new Error(`[${code}] failed to fetch ${url}: ${err.message}`);
                });
                total = page.num_rows_total ?? sentences.length;

                for (const entry of page.rows ?? []) {
                    const text = entry.row?.[textField];

                    if (typeof text === 'string' && text.trim()) sentences.push(text.replace(/[\r\n]+/g, ' ').trim());
                }

                if (!page.rows?.length) break;

                offset += page.rows.length;
            }
        }

        writeFileSync(path, sentences.join('\n') + (sentences.length ? '\n' : ''));
        console.log(`[${code}] fetched ${sentences.length} rows from ${source.dataset}`);
    }

    const dump = {
        name: source.name ?? 'Hugging Face',
        path,
        file: source.dataset,
        url: source.url ?? `https://huggingface.co/datasets/${source.dataset}`,
        license: source.license ?? 'CC-BY 4.0',
        attribution: source.attribution,
        sentences: 0,
        format: 'text',
        dedupe: true,
        normalize: normalizeRepeats,
    };

    await forEachText([dump], () => {
        dump.sentences ++;
    });

    return dump;
}

function unzipList(archive) {
    return new Promise((resolve, reject) => {
        const child = spawn('unzip', ['-Z1', archive]);
        let out = '';

        child.stdout.on('data', chunk => {
            out += chunk;
        });
        child.on('error', reject);
        child.on('exit', code => {
            if (code !== 0) {
                reject(new Error(`unzip exited with ${code} while listing ${archive}`));
                return;
            }

            resolve(out.split('\n').filter(Boolean));
        });
    });
}

function unzipEntry(archive, entry) {
    return new Promise((resolve, reject) => {
        const child = spawn('unzip', ['-p', archive, entry]);
        const chunks = [];

        child.stdout.on('data', chunk => chunks.push(chunk));
        child.on('error', reject);
        child.on('exit', code => {
            if (code !== 0) {
                reject(new Error(`unzip exited with ${code} while reading ${entry}`));
                return;
            }

            resolve(Buffer.concat(chunks));
        });
    });
}

function normalizeRepeats(text) {
    return text.replace(/(.)\1{2,}/gu, '$1');
}

function decodeText(buffer) {
    const utf8 = new TextDecoder('utf-8').decode(buffer);
    const bad = (utf8.match(/\uFFFD/g) || []).length;

    if (!bad) return utf8;

    const cp1252 = new TextDecoder('windows-1252').decode(buffer);
    const badCp1252 = (cp1252.match(/\uFFFD/g) || []).length;

    return badCp1252 < bad ? cp1252 : utf8;
}

async function resolveZenodoDump(code, source, cache, required = true) {
    const path = join(cache, source.cacheFile);
    const textPath = join(cache, source.textCacheFile);
    let lines;

    if (existsSync(textPath)) {
        lines = readFileSync(textPath, 'utf8').split('\n').filter(Boolean);
        console.log(`[${code}] cached ${source.textCacheFile} (${lines.length} lines)`);
    } else {
        if (!existsSync(path)) {
            if (!required) {
                console.log(`[${code}] skipping "${source.name}": ${source.cacheFile} is not cached`);
                return null;
            }

            await downloadIfMissing(source.downloadUrl, path, code);
        }

        if (source.md5) {
            const actual = md5File(path);

            if (actual !== source.md5) {
                throw new Error(`[${code}] md5 mismatch for ${path}: expected ${source.md5}, got ${actual}`);
            }
        }

        lines = [];

        for (const entry of (await unzipList(path)).filter(name => name.toLowerCase().endsWith('.txt'))) {
            const text = decodeText(await unzipEntry(path, entry));

            for (const raw of text.split('\n')) {
                const line = raw
                    .replace(/^\s*speaker\s*\d+\s*:\s*/i, '')
                    .replace(/\uFFFD/g, "'")
                    .replace(/(.)\1{2,}/gu, '$1')
                    .replace(/[\r\t]+/g, ' ')
                    .trim();

                if (line.length < 2) continue;

                lines.push(line);
            }
        }

        writeFileSync(textPath, lines.join('\n') + (lines.length ? '\n' : ''));
        console.log(`[${code}] extracted ${lines.length} lines from ${source.file}`);
    }

    const dump = {
        name: source.name ?? 'Zenodo',
        path: textPath,
        file: source.file,
        url: source.url,
        license: source.license ?? 'CC-BY 4.0',
        attribution: source.attribution,
        sentences: 0,
        format: 'text',
        dedupe: true,
    };

    await forEachText([dump], () => {
        dump.sentences ++;
    });

    return dump;
}

async function fetchHpltManifest() {
    const response = await fetch('https://data.hplt-project.org/three/sorted/manifest.json');

    if (!response.ok) throw new Error(`failed to fetch HPLT manifest: ${response.status}`);

    const manifest = new Map();

    for (const line of (await response.text()).split('\n')) {
        const trimmed = line.trim();

        if (!trimmed) continue;

        const entry = JSON.parse(trimmed);

        manifest.set(entry.name, entry);
    }

    return manifest;
}

function orderHpltShards(urls) {
    const shardNumber = url => {
        const match = url.match(/(\d+)_(\d+)\.jsonl\.zst$/);

        return match ? { bin: Number(match[1]), shard: Number(match[2]) } : { bin: -1, shard: 0 };
    };

    return [...urls].sort((a, b) => {
        const first = shardNumber(a);
        const second = shardNumber(b);

        return second.bin - first.bin || first.shard - second.shard;
    });
}

function cleanHpltText(text) {
    return text
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

async function readHpltDocuments(lines, options, onDocument) {
    let documents = 0;

    for await (const line of lines) {
        if (!line.trim()) continue;
        if (options.stop && options.stop()) break;

        let document;

        try {
            document = JSON.parse(line);
        } catch (err) {
            continue;
        }

        if (!document || typeof document.text !== 'string' || !document.text.trim()) continue;
        if (options.filter && document.filter && document.filter !== options.filter) continue;

        if (options.hpltCode && Array.isArray(document.lang) && Array.isArray(document.prob)) {
            const index = document.lang.indexOf(options.hpltCode);

            if (index === -1 || document.prob[index] < (options.minProb ?? 0.5)) continue;
        }

        onDocument(document);
        documents ++;

        if (documents >= options.maxDocuments) break;
    }

    return documents;
}

async function resolveHpltDump(code, source, cache) {
    const textPath = join(cache, `hplt_${source.pack}.txt`);
    let shards = [];

    if (existsSync(textPath)) {
        console.log(`[${code}] cached ${basename(textPath)}`);
    } else {
        const entry = (await fetchHpltManifest()).get(source.pack);

        if (!entry) throw new Error(`[${code}] HPLT pack "${source.pack}" not found in the manifest`);

        const maxDocuments = source.maxDocuments ?? 25000;
        const maxSegments = source.maxSegments ?? 150000;
        const lines = [];
        let documents = 0;

        for (const url of orderHpltShards(entry.urls)) {
            if (documents >= maxDocuments || lines.length >= maxSegments) break;

            console.log(`[${code}] streaming ${url}`);

            const response = await fetch(url);

            if (!response.ok) throw new Error(`[${code}] failed to fetch ${url}: ${response.status}`);

            const stream = Readable.fromWeb(response.body).pipe(createZstdDecompress());
            const rl = createInterface({ input: stream, crlfDelay: Infinity });
            const before = documents;

            documents += await readHpltDocuments(rl, {
                hpltCode: source.pack,
                minProb: source.minProb,
                filter: source.filter ?? 'keep',
                maxDocuments: maxDocuments - documents,
                stop: () => lines.length >= maxSegments,
            }, document => {
                for (const raw of cleanHpltText(document.text).split('\n')) {
                    const segment = raw.trim();

                    if (segment.length >= 2) lines.push(segment);
                }
            });

            shards.push(basename(url));

            rl.close();
            stream.destroy();

            console.log(`[${code}] ${documents} documents (${documents - before} from ${basename(url)})`);
        }

        writeFileSync(textPath, lines.join('\n') + (lines.length ? '\n' : ''));
        console.log(`[${code}] cached ${lines.length} segments in ${basename(textPath)} (sha256 ${sha256File(textPath).slice(0, 12)}…)`);
    }

    const dump = {
        name: 'HPLT',
        path: textPath,
        file: shards.length ? `${source.pack} (${shards.join(', ')})` : source.pack,
        url: source.url ?? 'https://hplt-project.org/datasets/v3.0',
        license: source.license ?? 'CC0 1.0',
        attribution: source.attribution,
        sentences: 0,
        format: 'text',
        dedupe: true,
    };

    await forEachText([dump], () => {
        dump.sentences ++;
    });

    return dump;
}

async function resolveDumps(code, meta, cache, required = true) {
    const dumps = [];

    for (const source of languageSources(meta)) {
        let dump;

        if (source.type === 'tatoeba') {
            dump = await chooseTatoebaDump(code, meta, source, cache);
        } else if (source.type === 'commonvoice') {
            dump = await resolveCommonVoiceDump(code, source, cache, required);
        } else if (source.type === 'huggingface') {
            dump = await resolveHuggingFaceDump(code, source, cache);
        } else if (source.type === 'zenodo') {
            dump = await resolveZenodoDump(code, source, cache, required);
        } else if (source.type === 'hplt') {
            dump = await resolveHpltDump(code, source, cache);
        } else {
            throw new Error(`[${code}] unsupported source type "${source.type}"`);
        }

        if (dump) dumps.push(dump);
    }

    if (!dumps.length) return null;

    return dumps;
}

async function forEachText(dumps, onText) {
    for (const dump of dumps) {
        const seen = dump.dedupe ? new Set() : null;
        let first = true;

        await readDumpLines(dump, line => {
            if (first) {
                first = false;
                if (dump.skipHeader) return;
            }

            let text = extractText(line, dump);

            if (!text) return;

            if (dump.normalize) text = dump.normalize(text);

            if (seen) {
                const key = text.normalize('NFC');

                if (seen.has(key)) return;

                seen.add(key);
            }

            onText(text);
        });
    }
}

function compareWords(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

async function countTrigrams(code, source, dumps, kept, pairCounts, vocabularySize, idByWord, extras) {
    const trigramTopK = source.trigramTopK ?? config.trigramTopK ?? 4;
    const trigramMinPairCount = source.trigramMinPairCount ?? config.trigramMinPairCount ?? 3;
    const trigramMinCount = source.trigramMinCount ?? config.trigramMinCount ?? 3;
    const trigramMaxContexts = source.trigramMaxContexts ?? config.trigramMaxContexts ?? 50000;

    if (trigramTopK <= 0) return [];

    const candidates = [];

    for (const [key, count] of pairCounts) {
        if (count >= trigramMinPairCount) candidates.push([key, count]);
    }

    if (!candidates.length) return [];

    candidates.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const selected = new Set(candidates.slice(0, trigramMaxContexts).map(([key]) => key));

    console.log(`[${code}] counting trigrams (${selected.size} selected pairs)`);

    const trigramCounts = new Map();

    await forEachText(dumps, text => {
        let previous = -1;
        let previous2 = -1;

        for (const token of tokenize(text, source.script, extras)) {
            const id = idByWord.get(token);

            if (id === undefined) {
                previous = -1;
                previous2 = -1;
                continue;
            }

            if (previous !== -1 && previous2 !== -1) {
                const pairKey = previous2 * vocabularySize + previous;

                if (selected.has(pairKey)) {
                    const key = pairKey * vocabularySize + id;
                    trigramCounts.set(key, (trigramCounts.get(key) || 0) + 1);
                }
            }

            previous2 = previous;
            previous = id;
        }
    });

    const byPair = new Map();

    for (const [key, count] of trigramCounts) {
        const pair = Math.floor(key / vocabularySize);
        const successor = key % vocabularySize;
        let list = byPair.get(pair);

        if (!list) byPair.set(pair, list = []);

        list.push({ id: successor, count });
    }

    const contexts = [];

    for (const pair of [...byPair.keys()].sort((a, b) => a - b)) {
        const successors = byPair.get(pair)
            .filter(entry => entry.count >= trigramMinCount)
            .sort((a, b) => b.count - a.count || compareWords(kept[a.id][0], kept[b.id][0]) || a.id - b.id)
            .slice(0, trigramTopK);

        if (successors.length) {
            contexts.push({ a: Math.floor(pair / vocabularySize), b: pair % vocabularySize, successors });
        }
    }

    return contexts;
}

async function buildNgrams(code, source, dumps, kept, extras) {
    const vocabularySize = kept.length;
    const topK = source.ngramTopK ?? config.ngramTopK ?? 8;
    const minCount = source.ngramMinCount ?? config.ngramMinCount ?? 2;
    const idByWord = new Map();

    for (let i = 0; i < vocabularySize; i ++) idByWord.set(kept[i][0], i);

    console.log(`[${code}] counting bigrams (${vocabularySize} vocabulary words)`);

    const pairCounts = new Map();

    await forEachText(dumps, text => {
        let previous = -1;

        for (const token of tokenize(text, source.script, extras)) {
            const id = idByWord.get(token);

            if (id === undefined) {
                previous = -1;
                continue;
            }

            if (previous !== -1) {
                const key = previous * vocabularySize + id;
                pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
            }

            previous = id;
        }
    });

    const trigramContexts = await countTrigrams(code, source, dumps, kept, pairCounts, vocabularySize, idByWord, extras);
    const byContext = new Map();

    for (const [key, count] of pairCounts) {
        const context = Math.floor(key / vocabularySize);
        const successor = key % vocabularySize;
        let list = byContext.get(context);

        if (!list) byContext.set(context, list = []);

        list.push({ id: successor, count });
    }

    const contexts = [];

    for (const id of [...byContext.keys()].sort((a, b) => a - b)) {
        const successors = byContext.get(id)
            .filter(entry => entry.count >= minCount)
            .sort((a, b) => b.count - a.count || compareWords(kept[a.id][0], kept[b.id][0]))
            .slice(0, topK);

        if (successors.length) contexts.push({ id, successors });
    }

    const words = kept.map(([word]) => word);
    const buffer = contexts.length
        ? Buffer.from(encodeNgramModel({ language: code, vocabHash: fnv1a(words.join('\n')), contexts, trigramContexts }))
        : null;
    const bundledPath = join(bundledDir, `${code}.ngram.bin`);

    if (buffer) {
        writeBufferIfChanged(bundledPath, buffer);

        if (hostLanguagesDir) writeBufferWithBackup(join(hostLanguagesDir, code, 'ngrams.bin'), join(hostLanguagesDir, code, 'ngrams-previous.bin'), buffer);
    } else {
        rmSync(bundledPath, { force: true });

        if (hostLanguagesDir) rmSync(join(hostLanguagesDir, code, 'ngrams.bin'), { force: true });
    }

    const pairs = contexts.reduce((total, context) => total + context.successors.length, 0);
    const trigramPairs = trigramContexts.reduce((total, context) => total + context.successors.length, 0);

    console.log(`[${code}] ${contexts.length} bigram contexts, ${pairs} pairs; ${trigramContexts.length} trigram contexts, ${trigramPairs} pairs (${buffer ? buffer.byteLength.toLocaleString('en') : 0} bytes)`);

    return {
        contexts: contexts.length,
        pairs,
        trigramContexts: trigramContexts.length,
        trigramPairs,
        bytes: buffer ? buffer.byteLength : 0,
    };
}

async function buildWords(code, source, dumps, profanity, stats) {
    const licenses = [...new Set(dumps.map(dump => dump.license))].join(', ');
    const sentences = dumps.reduce((total, dump) => total + dump.sentences, 0);
    const candidates = source.wordChars ?? connectorCandidates;

    console.log(`[${code}] counting tokens (${source.script}, ${licenses})`);
    const counts = new Map();

    await forEachText(dumps, text => {
        for (const token of tokenize(text, source.script, candidates)) {
            counts.set(token, (counts.get(token) || 0) + 1);
        }
    });

    const entries = [...counts.entries()].sort((a, b) =>
        b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
    );

    const banned = profanity[code] || new Set();
    const filtered = entries.filter(([word]) => !banned.has(word));
    const kept = filtered.slice(0, source.topN ?? config.topN);
    const text = kept.map(([word]) => word).join('\n') + '\n';
    // Connector characters the retained words actually use; only these ship to runtime.
    const wordChars = source.wordChars ?? deriveWordChars(kept.map(([word]) => word), candidates);
    const roundTripped = parseWordList(text, wordChars);

    if (roundTripped.length !== kept.length || roundTripped.some((word, i) => word !== kept[i][0])) {
        const parsed = new Set(roundTripped);
        const offending = kept.map(([word]) => word).filter(word => !parsed.has(word));

        throw new Error(`[${code}] word list does not survive parseWordList (${offending.length} lost): ${offending.slice(0, 5).join(', ')}`);
    }

    console.log(`[${code}] ${sentences} sentences, ${counts.size} unique tokens, ${kept.length} kept (${entries.length - filtered.length} filtered)` + (wordChars ? `, connector chars ${[...wordChars].map(ch => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')}` : ''));

    if (hostLanguagesDir) {
        mkdirSync(join(hostLanguagesDir, code), { recursive: true });
        writeWithBackup(join(hostLanguagesDir, code, 'autocomplete.txt'), join(hostLanguagesDir, code, 'autocomplete-previous.txt'), text);
    }

    const ngrams = await buildNgrams(code, source, dumps, kept, candidates);
    writeIfChanged(join(bundledDir, `${code}.js`), `export default \`${escapeTemplateLiteral(text)}\`;\n`);

    stats.push({ code, mode: 'words', dumps, tokens: counts.size, kept: kept.length, ngrams, wordChars });
}

async function buildZhComposition(source, dump, profanity, stats) {
    const { pinyin } = await import('pinyin-pro');
    const byReading = new Map();
    const banned = profanity.zh || new Set();
    let sentences = 0;

    console.log(`[zh] deriving pinyin readings (${dump.license})`);

    await decompressLines(dump.path, line => {
        const text = extractText(line, dump);

        if (!text) return;

        sentences ++;

        extractZhReadings(text, byReading, pinyin);
    });

    const text = emitComposition(byReading, banned, source.compositionTopReadings ?? config.compositionTopReadings, source.compositionMaxCandidates ?? config.compositionMaxCandidates);

    console.log(`[zh] ${sentences} sentences, ${byReading.size} readings`);

    if (hostLanguagesDir) writeWithBackup(join(hostLanguagesDir, 'zh', 'composition.txt'), join(hostLanguagesDir, 'zh', 'composition-previous.txt'), text);

    stats.push({ code: 'zh', mode: 'composition', dumps: [dump], readings: byReading.size, sentences });
}

async function buildJaComposition(source, profanity, stats, cache) {
    const url = `${config.ccbyBaseUrl}/jpn/jpn_transcriptions.tsv.bz2`;
    const path = join(cache, 'jpn_transcriptions.tsv.bz2');
    const byReading = new Map();
    const banned = profanity.ja || new Set();
    let rows = 0;

    await downloadIfMissing(url, path, 'ja');
    console.log('[ja] deriving kana readings from furigana transcriptions');

    await decompressLines(path, line => {
        const parts = line.split('\t');

        if (parts.length < 5) return;

        rows ++;

        extractJaReadings(parts.slice(4).join('\t'), byReading);
    });

    const text = emitComposition(byReading, banned, source.compositionTopReadings ?? config.compositionTopReadings, source.compositionMaxCandidates ?? config.compositionMaxCandidates);

    console.log(`[ja] ${rows} transcriptions, ${byReading.size} readings`);

    if (hostLanguagesDir) writeWithBackup(join(hostLanguagesDir, 'ja', 'composition.txt'), join(hostLanguagesDir, 'ja', 'composition-previous.txt'), text);

    stats.push({ code: 'ja', mode: 'composition', dumps: [{ name: 'Tatoeba', file: 'jpn_transcriptions.tsv.bz2', url, license: 'CC-BY 2.0 FR', sentences: rows }], readings: byReading.size, sentences: rows });
}

async function main() {
    const rawArgs = process.argv.slice(2).map(arg => arg.toLowerCase());
    const removing = rawArgs.includes('--remove');
    const codes = rawArgs.filter(arg => arg !== '--remove');

    if (removing && !codes.length) {
        console.error('Usage: node tools/build-wordlists.mjs --remove <code> [<code>...]');
        process.exit(1);
    }

    const unknown = codes.filter(code => !config.languages[code] && !(removing && existsSync(join(attributionDir, `${code}.json`))));

    if (unknown.length) {
        console.error(`Unknown language(s): ${unknown.join(', ')}`);
        process.exit(1);
    }

    if (removing) {
        await removeLanguages(codes);
        return;
    }

    const subset = codes.length ? codes : [];
    const buildCodes = subset.length ? subset : Object.keys(config.languages);
    const profanity = loadProfanityFilter();
    mkdirSync(cacheDir, { recursive: true });
    const stats = [];

    for (const code of buildCodes) {
        const source = config.languages[code];

        if (code === 'ja') {
            await buildJaComposition(source, profanity, stats, cacheDir);
            continue;
        }

        const dumps = await resolveDumps(code, source, cacheDir, subset.length > 0);

        if (!dumps) continue;

        if (source.mode === 'composition') {
            await buildZhComposition(source, dumps[0], profanity, stats);
        } else {
            await buildWords(code, source, dumps, profanity, stats);
        }
    }

    const changedRecords = writeAttributionRecords(stats);

    await mergeWordChars(Object.fromEntries(stats.filter(stat => stat.mode === 'words').map(stat => [stat.code, stat.wordChars])));

    regenerateManifest();
    regenerateAttribution();

    if (subset.length) {
        console.log(`\nSubset build${changedRecords.length ? ` — attribution record(s) updated for ${changedRecords.join(', ')}` : ' — attribution unchanged'}. ATTRIBUTION.md is in sync.`);
    } else {
        console.log('\nFull build complete. Tip: prefer per-language builds (node tools/build-wordlists.mjs <code>) to avoid re-downloading every corpus.');
    }

    if (!process.env.HOST_DIR && stats.length) {
        console.log('Host reference copies not written (set HOST_DIR=<host project root> to write them).');
    }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}

export { cleanHpltText, connectorCandidates, decodeText, deriveWordChars, extractText, findArchiveEntry, findCacheFiles, forEachText, languageSources, orderHpltShards, readHpltDocuments, recordSources, resolveCommonVoiceDump, resolveDumps, resolveHpltDump, sourceCells, tokenize };
