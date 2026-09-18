import { createWriteStream, existsSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const libDir = join(__dirname, '..');
const bundledDir = join(libDir, 'languages');
const repoRoot = process.env.HOST_DIR ? resolve(process.env.HOST_DIR) : join(libDir, '..', 'click.totype.org');
const hostLanguagesDir = join(repoRoot, 'languages');
const cacheDir = join(__dirname, '.cache');

const config = JSON.parse(readFileSync(join(__dirname, 'wordlist-sources.json'), 'utf8'));
const manifestOrder = Object.keys(config.languages).filter(code => config.languages[code].mode !== 'composition');

const scriptRanges = {
    Latn: '\\p{Script=Latn}',
    Cyrl: '\\p{Script=Cyrl}',
    Arab: '\\p{Script=Arab}',
    Deva: '\\p{Script=Deva}',
    Beng: '\\p{Script=Beng}',
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

function tokenize(sentence, script) {
    const normalized = sentence.normalize('NFC').toLowerCase();
    const tokenRegex = new RegExp(`[${scriptRanges[script]}\\p{M}${escapeForCharacterClass("'\\-")}]+`, 'gu');
    const tokens = [];

    for (const match of normalized.matchAll(tokenRegex)) {
        const token = match[0].replace(/^['\-]+|['\-]+$/g, '');

        if (token.length >= 2) tokens.push(token);
    }

    return tokens;
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

function extractText(line) {
    const parts = line.split('\t');

    if (parts.length >= 3) return parts[2];
    if (parts.length === 2) return parts[1];

    return '';
}

async function download(url, dest) {
    const response = await fetch(url);

    if (!response.ok) throw new Error(`Download failed for ${url}: ${response.status}`);

    await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}

function decompressLines(bz2Path, onLine) {
    return new Promise((resolve, reject) => {
        const child = spawn('bzip2', ['-dc', bz2Path]);
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

function attributionRecord(stat, generated) {
    const meta = config.languages[stat.code];
    const record = {
        code: stat.code,
        mode: stat.mode,
        tatoebaCode: meta.tatoebaCode,
        sourceFile: stat.source.file,
        sourceUrl: `${config.ccbyBaseUrl}/${meta.tatoebaCode}/${stat.source.file}`,
        license: stat.source.license,
        sentences: stat.source.sentences,
    };

    if (stat.mode === 'words') {
        record.tokens = stat.tokens;
        record.kept = stat.kept;
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
    const codes = manifestOrder.filter(code => !exclude.includes(code));
    const text = 'export default {\n' + codes.map(code => `    ${code}: () => import('./${code}.js'),`).join('\n') + '\n};\n';

    return writeIfChanged(join(bundledDir, 'index.js'), text);
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

function regenerateAttribution() {
    const records = loadAttributionRecords();
    const wordRows = records
        .filter(record => record.mode === 'words')
        .map(record => `| ${record.code} | \`${record.sourceFile}\` | ${record.license} | ${record.sentences.toLocaleString('en')} | ${record.kept.toLocaleString('en')} | ${record.generated} |`)
        .join('\n');
    const compositionRows = records
        .filter(record => record.mode === 'composition')
        .map(record => `| ${record.code} | \`${record.sourceFile}\` | ${record.license} | ${record.sentences.toLocaleString('en')} | ${record.readings.toLocaleString('en')} | ${record.generated} |`)
        .join('\n');

    const text = `# Word List Attribution

The data files referenced below are generated from [Tatoeba](https://tatoeba.org)
downloads by \`tools/build-wordlists.mjs\` (configuration:
\`tools/wordlist-sources.json\`). This file itself is generated from the
per-language records in \`attribution/\`: building a single language updates its
record and refreshes this file, so per-language builds are preferred over full
rebuilds (\`--remove <code>\` removes a language).

## Word lists

Bundled lists in \`languages/\` and reference copies in the host project
(\`languages/<code>/autocomplete.txt\`).

| Language | Source file | License | Sentences | Words kept | Generated |
|---|---|---|---|---|---|
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
for each word-list and Mandarin source; the CC0 dump is used when it contains
at least ${config.cc0MinSentences.toLocaleString('en')} sentences, otherwise the
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
frequency counting, profanity filtering (\`tools/profanity-filter.txt\`,
project-owned and user-editable), frequency-descending sort with alphabetical
tie-break, top ${config.topN} retained.

Composition data: CJK word segmentation via \`Intl.Segmenter\`; for Japanese,
kana readings are taken from the furigana annotations in the transcriptions
dump and katakana is folded to hiragana; for Mandarin, readings are toneless
pinyin with \`ü\` spelled \`v\`; candidates are the most frequent words per
reading, the most frequent ${config.compositionTopReadings.toLocaleString('en')} readings retained,
at most ${config.compositionMaxCandidates} candidates each. Profanity filtering applies where a
section for the language exists in \`tools/profanity-filter.txt\`.

## Superseded content

Lists replaced by this pipeline are retained in the host project
(\`languages/<code>/autocomplete-previous.txt\`,
\`languages/<code>/composition-previous.txt\`) for reference only. They include
the pre-pipeline lists of undocumented provenance and the original
machine-assisted curation of the Arabic and Hindi lists.
`;

    return writeIfChanged(join(libDir, 'ATTRIBUTION.md'), text);
}

function removeLanguages(codes) {
    mkdirSync(bundledDir, { recursive: true });
    mkdirSync(attributionDir, { recursive: true });

    for (const code of codes) {
        for (const path of [join(bundledDir, `${code}.js`), join(attributionDir, `${code}.json`)]) {
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

    console.log('\nBundled lists removed. Host-side cleanup left to you, if applicable:');
    console.log('  - languages/<code>/ folder (keyboards, translations, reference word list)');
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

async function chooseDump(code, source, cache) {
    const tatoebaCode = source.tatoebaCode;
    const urls = dumpUrls(tatoebaCode);
    const ccbyPath = join(cache, `${tatoebaCode}_sentences.tsv.bz2`);
    const cc0Path = join(cache, `${tatoebaCode}_sentences_CC0.tsv.bz2`);

    await downloadIfMissing(urls.ccby, ccbyPath, code);

    let cc0Count = 0;

    try {
        await downloadIfMissing(urls.cc0, cc0Path, code);
        cc0Count = await countLines(cc0Path);
    } catch (err) {
        console.log(`[${code}] CC0 dump unavailable (${err.message}); falling back to CC-BY`);
    }

    const ccbyCount = await countLines(ccbyPath);
    const threshold = source.cc0MinSentences ?? config.cc0MinSentences;

    if (cc0Count >= threshold) {
        return { path: cc0Path, file: `${tatoebaCode}_sentences_CC0.tsv.bz2`, url: urls.cc0, license: 'CC0 1.0', sentences: cc0Count, ccbyCount };
    }

    return { path: ccbyPath, file: `${tatoebaCode}_sentences.tsv.bz2`, url: urls.ccby, license: 'CC-BY 2.0 FR', sentences: ccbyCount, ccbyCount };
}

async function buildWords(code, source, dump, profanity, stats) {
    console.log(`[${code}] counting tokens (${source.script}, ${dump.license})`);
    const counts = new Map();

    await decompressLines(dump.path, line => {
        const text = extractText(line);

        if (!text) return;

        for (const token of tokenize(text, source.script)) {
            counts.set(token, (counts.get(token) || 0) + 1);
        }
    });

    const entries = [...counts.entries()].sort((a, b) =>
        b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
    );

    const banned = profanity[code] || new Set();
    const filtered = entries.filter(([word]) => !banned.has(word));
    const kept = filtered.slice(0, config.topN);
    const text = kept.map(([word]) => word).join('\n') + '\n';

    console.log(`[${code}] ${dump.sentences} sentences, ${counts.size} unique tokens, ${kept.length} kept (${entries.length - filtered.length} filtered)`);

    const referencePath = join(hostLanguagesDir, code, 'autocomplete.txt');

    writeWithBackup(referencePath, join(hostLanguagesDir, code, 'autocomplete-previous.txt'), text);
    writeIfChanged(join(bundledDir, `${code}.js`), `export default \`${escapeTemplateLiteral(text)}\`;\n`);

    stats.push({ code, mode: 'words', source: dump, tokens: counts.size, kept: kept.length });
}

async function buildZhComposition(source, dump, profanity, stats) {
    const { pinyin } = await import('pinyin-pro');
    const byReading = new Map();
    const banned = profanity.zh || new Set();
    let sentences = 0;

    console.log(`[zh] deriving pinyin readings (${dump.license})`);

    await decompressLines(dump.path, line => {
        const text = extractText(line);

        if (!text) return;

        sentences ++;

        extractZhReadings(text, byReading, pinyin);
    });

    const text = emitComposition(byReading, banned, source.compositionTopReadings ?? config.compositionTopReadings, source.compositionMaxCandidates ?? config.compositionMaxCandidates);

    console.log(`[zh] ${sentences} sentences, ${byReading.size} readings`);

    writeWithBackup(join(hostLanguagesDir, 'zh', 'composition.txt'), join(hostLanguagesDir, 'zh', 'composition-previous.txt'), text);

    stats.push({ code: 'zh', mode: 'composition', source: dump, readings: byReading.size, sentences });
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

    writeWithBackup(join(hostLanguagesDir, 'ja', 'composition.txt'), join(hostLanguagesDir, 'ja', 'composition-previous.txt'), text);

    stats.push({ code: 'ja', mode: 'composition', source: { file: 'jpn_transcriptions.tsv.bz2', url, license: 'CC-BY 2.0 FR', sentences: rows }, readings: byReading.size, sentences: rows });
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
        removeLanguages(codes);
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

        const dump = await chooseDump(code, source, cacheDir);

        if (source.mode === 'composition') {
            await buildZhComposition(source, dump, profanity, stats);
        } else {
            await buildWords(code, source, dump, profanity, stats);
        }
    }

    const changedRecords = writeAttributionRecords(stats);

    regenerateManifest();
    regenerateAttribution();

    if (subset.length) {
        console.log(`\nSubset build${changedRecords.length ? ` — attribution record(s) updated for ${changedRecords.join(', ')}` : ' — attribution unchanged'}. ATTRIBUTION.md is in sync.`);
    } else {
        console.log('\nFull build complete. Tip: prefer per-language builds (node tools/build-wordlists.mjs <code>) to avoid re-downloading every corpus.');
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
