import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    cleanHpltText,
    forEachText,
    languageSources,
    orderHpltShards,
    readHpltDocuments,
    recordSources,
    resolveCommonVoiceDump,
    resolveHpltDump,
    sourceCells,
} from '../tools/build-wordlists.mjs';

const hasTar = spawnSync('tar', ['--version']).status === 0;

function makeCommonVoiceArchive() {
    const workdir = mkdtempSync(join(tmpdir(), 'suggest-engine-cv-'));
    const corpusDir = join(workdir, 'cv-corpus-27.0-test', 'pcm');

    mkdirSync(corpusDir, { recursive: true });
    writeFileSync(join(corpusDir, 'validated.tsv'), [
        'client_id\tpath\tsentence\tup_votes\tdown_votes\tage\tgender\taccent',
        'a\t1.mp3\tAbeg make we go.\t2\t0',
        'b\t2.mp3\tAbeg make we go.\t2\t0',
        'c\t3.mp3\tWetin dey happen?\t2\t0',
        'd\t4.mp3\t\t2\t0',
        '',
    ].join('\n'));

    const archive = join(workdir, 'pcm.tar.gz');
    const result = spawnSync('tar', ['-czf', archive, '-C', workdir, 'cv-corpus-27.0-test']);

    assert.equal(result.status, 0);

    return { workdir, archive, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') };
}

test('languageSources normalizes tatoebaCode and sources arrays', () => {
    assert.deepEqual(languageSources({ tatoebaCode: 'eng' }), [{ type: 'tatoeba', code: 'eng' }]);
    assert.deepEqual(languageSources({ sources: [{ type: 'tatoeba', code: 'swh' }] }), [{ type: 'tatoeba', code: 'swh' }]);
    assert.deepEqual(languageSources({}), []);
});

test('attribution helpers handle legacy and multi-source records', () => {
    const legacy = { sourceFile: 'eng_sentences_CC0.tsv.bz2', sourceUrl: 'https://example.test/eng', license: 'CC0 1.0', sentences: 5 };

    assert.deepEqual(recordSources(legacy), [
        { name: 'Tatoeba', file: 'eng_sentences_CC0.tsv.bz2', url: 'https://example.test/eng', license: 'CC0 1.0', sentences: 5 },
    ]);
    assert.deepEqual(sourceCells({
        sources: [
            { file: 'swh_sentences.tsv.bz2', license: 'CC-BY 2.0 FR', sentences: 3 },
            { file: 'swc_sentences.tsv.bz2', license: 'CC-BY 2.0 FR', sentences: 4 },
        ],
    }), { files: '`swh_sentences.tsv.bz2`<br>`swc_sentences.tsv.bz2`', licenses: 'CC-BY 2.0 FR', sentences: 7 });
});

test('hplt shards are ordered by quality bin then shard number', () => {
    const urls = [
        'https://example.test/5_1.jsonl.zst',
        'https://example.test/9_10.jsonl.zst',
        'https://example.test/10_1.jsonl.zst',
        'https://example.test/9_2.jsonl.zst',
    ];

    assert.deepEqual(orderHpltShards(urls), [
        'https://example.test/10_1.jsonl.zst',
        'https://example.test/9_2.jsonl.zst',
        'https://example.test/9_10.jsonl.zst',
        'https://example.test/5_1.jsonl.zst',
    ]);
});

test('hplt documents honor language, filter, and document budget', async () => {
    const lines = [
        JSON.stringify({ text: 'hello world', lang: ['yor_Latn'], prob: [0.9], filter: 'keep' }),
        JSON.stringify({ text: '   ', lang: ['yor_Latn'], prob: [0.9], filter: 'keep' }),
        JSON.stringify({ text: 'wrong language', lang: ['eng_Latn'], prob: [0.9], filter: 'keep' }),
        JSON.stringify({ text: 'filtered out', lang: ['yor_Latn'], prob: [0.9], filter: 'drop' }),
        JSON.stringify({ text: 'low probability', lang: ['yor_Latn'], prob: [0.4], filter: 'keep' }),
        JSON.stringify({ text: 'third doc', lang: ['yor_Latn'], prob: [0.9], filter: 'keep' }),
    ];
    const seen = [];
    const count = await readHpltDocuments(lines, {
        hpltCode: 'yor_Latn',
        minProb: 0.5,
        filter: 'keep',
        maxDocuments: 2,
    }, document => seen.push(document.text));

    assert.equal(count, 2);
    assert.deepEqual(seen, ['hello world', 'third doc']);
});

test('hplt document reader honors an external stop condition', async () => {
    const lines = [
        JSON.stringify({ text: 'one', lang: ['yor_Latn'], prob: [0.9], filter: 'keep' }),
        JSON.stringify({ text: 'two', lang: ['yor_Latn'], prob: [0.9], filter: 'keep' }),
        JSON.stringify({ text: 'three', lang: ['yor_Latn'], prob: [0.9], filter: 'keep' }),
    ];
    let seen = 0;
    const count = await readHpltDocuments(lines, {
        maxDocuments: 10,
        stop: () => seen >= 2,
    }, () => seen++);

    assert.equal(count, 2);
});

test('cleanHpltText strips residual markup and entities', () => {
    assert.equal(cleanHpltText('a <p>b</p> &amp; c &lt;d&gt;'), 'a  b  & c <d>');
});

test('hplt adapter reuses a cached normalized corpus', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'suggest-engine-hplt-'));

    try {
        writeFileSync(join(workdir, 'hplt_test_Latn.txt'), 'first segment\nsecond segment\n');

        const dump = await resolveHpltDump('xx', { pack: 'test_Latn', maxDocuments: 10 }, workdir);

        assert.equal(dump.path, join(workdir, 'hplt_test_Latn.txt'));
        assert.equal(dump.sentences, 2);
        assert.equal(dump.license, 'CC0 1.0');
        assert.equal(dump.file, 'test_Latn');
    } finally {
        rmSync(workdir, { recursive: true, force: true });
    }
});

test('common voice archives stream validated sentences, deduped', { skip: !hasTar }, async () => {
    const { workdir, sha256 } = makeCommonVoiceArchive();

    try {
        const dump = await resolveCommonVoiceDump('pcm', {
            cacheFile: 'pcm.tar.gz',
            archiveFile: 'pcm/validated.tsv',
            sha256,
            name: 'Common Voice',
            url: 'https://example.test/pcm',
            license: 'CC0 1.0',
        }, workdir);

        assert.equal(dump.archiveEntry, 'cv-corpus-27.0-test/pcm/validated.tsv');
        assert.equal(dump.sentences, 2);

        const texts = [];

        await forEachText([dump], text => texts.push(text));

        assert.deepEqual(texts, ['Abeg make we go.', 'Wetin dey happen?']);
    } finally {
        rmSync(workdir, { recursive: true, force: true });
    }
});

test('common voice checksum mismatch is rejected', { skip: !hasTar }, async () => {
    const { workdir } = makeCommonVoiceArchive();

    try {
        await assert.rejects(resolveCommonVoiceDump('pcm', {
            cacheFile: 'pcm.tar.gz',
            archiveFile: 'pcm/validated.tsv',
            sha256: 'deadbeef',
            name: 'Common Voice',
            url: 'https://example.test/pcm',
            license: 'CC0 1.0',
        }, workdir), /sha256 mismatch/);
    } finally {
        rmSync(workdir, { recursive: true, force: true });
    }
});
