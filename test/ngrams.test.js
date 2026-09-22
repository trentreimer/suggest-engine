import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SuggestEngine } from '../src/engine.js';
import { NgramModel, fnv1a } from '../src/ngrams.js';
import { encodeNgramModel } from '../tools/ngram-format.mjs';

function mockStorage() {
    const store = new Map();
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        },
        clear() {
            store.clear();
        },
    };
}

const words = ['alpha', 'become', 'better', 'between', 'bewilder'];

function modelFor(contexts, vocabulary = words, language = 'en', trigramContexts = []) {
    return new NgramModel(encodeNgramModel({
        language,
        vocabHash: fnv1a(vocabulary.join('\n')),
        contexts,
        trigramContexts,
    }));
}

const alphaBetween = [{ id: 0, successors: [{ id: 3, count: 7 }, { id: 2, count: 3 }] }];

async function fixtureEngine(options = {}) {
    globalThis.localStorage = mockStorage();

    const engine = new SuggestEngine({ language: 'en', userWords: true, ...options });

    await engine.addWordList('bundled', words);

    return engine;
}

test('encoder round-trips through NgramModel', () => {
    const buffer = encodeNgramModel({
        language: 'en',
        vocabHash: 1234,
        contexts: [
            { id: 3, successors: [{ id: 1, count: 4 }] },
            { id: 1, successors: [{ id: 2, count: 1 }, { id: 0, count: 9 }] },
        ],
    });
    const model = new NgramModel(buffer);

    assert.equal(model.language, 'en');
    assert.equal(model.vocabHash, 1234);
    assert.equal(model.contextCount, 2);
    assert.equal(model.entryCount, 3);
    assert.deepEqual([...model.contexts], [1, 3]);
    assert.deepEqual([...model.bigram(1).ids], [0, 2]);
    assert.deepEqual([...model.bigram(1).counts], [9, 1]);
    assert.deepEqual([...model.bigram(3).ids], [1]);
    assert.equal(model.bigram(4), null);
});

test('encoder round-trips trigram sections through NgramModel', () => {
    const buffer = encodeNgramModel({
        language: 'en',
        vocabHash: 1234,
        contexts: [{ id: 0, successors: [{ id: 1, count: 5 }] }],
        trigramContexts: [
            { a: 1, b: 0, successors: [{ id: 2, count: 4 }] },
            { a: 0, b: 1, successors: [{ id: 3, count: 2 }, { id: 4, count: 9 }] },
        ],
    });
    const model = new NgramModel(buffer);

    assert.equal(model.contextCount, 1);
    assert.equal(model.entryCount, 1);
    assert.equal(model.trigramContextCount, 2);
    assert.equal(model.trigramEntryCount, 3);
    assert.deepEqual([...model.bigram(0).ids], [1]);
    assert.deepEqual([...model.trigram(0, 1).ids], [4, 3]);
    assert.deepEqual([...model.trigram(0, 1).counts], [9, 2]);
    assert.deepEqual([...model.trigram(1, 0).ids], [2]);
    assert.equal(model.trigram(1, 1), null);
});

test('models without a trigram section report no trigram matches', () => {
    const buffer = encodeNgramModel({ language: 'en', vocabHash: 0, contexts: [{ id: 0, successors: [{ id: 1, count: 1 }] }] });
    const model = new NgramModel(buffer);

    assert.equal(model.trigramContextCount, 0);
    assert.equal(model.trigram(0, 1), null);
});

test('a truncated trigram section is rejected', () => {
    const buffer = encodeNgramModel({
        language: 'en',
        vocabHash: 0,
        contexts: [],
        trigramContexts: [{ a: 0, b: 1, successors: [{ id: 2, count: 3 }] }],
    });
    const view = new DataView(buffer.slice(0));
    const languageLength = view.getUint8(6);
    const tableStart = 13 + languageLength;
    const sectionCount = view.getUint16(tableStart - 2, true);
    let trigramEntry = -1;

    for (let i = 0; i < sectionCount; i ++) {
        if (view.getUint8(tableStart + i * 10) === 2) trigramEntry = tableStart + i * 10;
    }

    assert.notEqual(trigramEntry, -1);
    view.setUint32(trigramEntry + 6, 4, true);

    assert.throws(() => new NgramModel(view.buffer), /truncated trigram/);
});

test('encoder rejects duplicate and invalid trigram contexts', () => {
    assert.throws(() => encodeNgramModel({ language: 'en', vocabHash: 0, trigramContexts: [{ a: 1, b: 2, successors: [] }, { a: 1, b: 2, successors: [] }] }), /Duplicate trigram/);
    assert.throws(() => encodeNgramModel({ language: 'en', vocabHash: 0, trigramContexts: [{ a: -1, b: 2, successors: [] }] }), /Invalid/);
});

test('encoder rejects duplicate contexts and invalid ids', () => {
    assert.throws(() => encodeNgramModel({ language: 'en', vocabHash: 0, contexts: [{ id: 1, successors: [] }, { id: 1, successors: [] }] }), /Duplicate/);
    assert.throws(() => encodeNgramModel({ language: 'en', vocabHash: 0, contexts: [{ id: 70000, successors: [] }] }), /Invalid/);
    assert.throws(() => encodeNgramModel({ language: 'eñ', vocabHash: 0, contexts: [] }), /ASCII/);
});

test('NgramModel rejects malformed buffers', () => {
    assert.throws(() => new NgramModel(new ArrayBuffer(4)), /truncated|Invalid/);

    const buffer = encodeNgramModel({ language: 'en', vocabHash: 0, contexts: [] });
    const tampered = new DataView(buffer.slice(0));

    tampered.setUint32(0, 0, true);
    assert.throws(() => new NgramModel(tampered.buffer), /magic/);

    const future = new DataView(buffer.slice(0));

    future.setUint16(4, 99, true);
    assert.throws(() => new NgramModel(future.buffer), /version/);
});

test('context matches are promoted, then user words, then library order', async () => {
    const engine = await fixtureEngine();

    engine.recordWord('bewilder');
    engine.recordWord('bewilder');
    await engine.addContextModel(modelFor(alphaBetween));

    const suggestions = engine.suggest('be', 'alpha ');

    assert.deepEqual(suggestions.map(s => s.text), ['between', 'better', 'bewilder', 'become']);
    assert.deepEqual(suggestions.map(s => s.source), ['bundled', 'bundled', 'user-words', 'bundled']);
    assert.equal(suggestions[0].insertSuffix, 'tween');
});

test('context matches order by count and ignore non-matching prefixes', async () => {
    const engine = await fixtureEngine();

    await engine.addContextModel(modelFor(alphaBetween));

    assert.deepEqual(engine.suggest('be', 'alpha ').map(s => s.text), ['between', 'better', 'become', 'bewilder']);
    assert.deepEqual(engine.suggest('g', 'alpha '), []);
    assert.deepEqual(engine.suggest('be', 'delta ').map(s => s.text), ['become', 'better', 'between', 'bewilder']);
});

const betweenBetter = { id: 3, successors: [{ id: 2, count: 5 }] };
const alphaTrigram = [{ a: 0, b: 3, successors: [{ id: 1, count: 9 }] }];

test('trigram matches precede bigram-only matches', async () => {
    const engine = await fixtureEngine();

    await engine.addContextModel(modelFor([...alphaBetween, betweenBetter], words, 'en', alphaTrigram));

    const suggestions = engine.suggest('be', 'alpha between ');

    assert.deepEqual(suggestions.map(s => s.text), ['become', 'better', 'between', 'bewilder']);
    assert.deepEqual(suggestions.map(s => s.source), ['bundled', 'bundled', 'bundled', 'bundled']);
});

test('without a trigram match the bigram context still orders suggestions', async () => {
    const engine = await fixtureEngine();

    await engine.addContextModel(modelFor([...alphaBetween, betweenBetter]));

    assert.deepEqual(engine.suggest('be', 'alpha between ').map(s => s.text), ['better', 'become', 'between', 'bewilder']);
    assert.deepEqual(engine.suggest('be', 'delta between ').map(s => s.text), ['better', 'become', 'between', 'bewilder']);
});

test('trigram matches, then bigram matches, then user words, then library', async () => {
    const engine = await fixtureEngine();

    engine.recordWord('bewilder');
    engine.recordWord('bewilder');
    await engine.addContextModel(modelFor([...alphaBetween, betweenBetter], words, 'en', alphaTrigram));

    assert.deepEqual(engine.suggest('be', 'alpha between ').map(s => s.text), ['become', 'better', 'bewilder', 'between']);
    assert.deepEqual(engine.suggest('be', 'alpha between ').map(s => s.source), ['bundled', 'bundled', 'user-words', 'bundled']);
});

test('nextWords backs off from trigram to bigram and then user words', async () => {
    const engine = await fixtureEngine({ maxSuggestions: 4 });

    engine.recordWord('bewilder');
    engine.recordWord('bewilder');
    await engine.addContextModel(modelFor([...alphaBetween, betweenBetter], words, 'en', alphaTrigram));

    const next = engine.nextWords('alpha between');

    assert.deepEqual(next.map(s => s.text), ['become', 'better', 'bewilder']);
    assert.deepEqual(next.map(s => s.source), ['bundled', 'bundled', 'user-words']);
});

test('suggestAt uses the two preceding words for trigram context', async () => {
    const engine = await fixtureEngine();

    await engine.addContextModel(modelFor([...alphaBetween, betweenBetter], words, 'en', alphaTrigram));

    assert.deepEqual(engine.suggestAt('alpha between be', 16).map(s => s.text), ['become', 'better', 'between', 'bewilder']);
    assert.deepEqual(engine.suggestAt('alpha between b', 15).map(s => s.text), ['become', 'better', 'between', 'bewilder']);
});

test('suggest without context is identical with and without a model', async () => {
    const withModel = await fixtureEngine();
    const withoutModel = await fixtureEngine();

    withModel.recordWord('bewilder');
    withModel.recordWord('bewilder');
    withoutModel.recordWord('bewilder');
    withoutModel.recordWord('bewilder');

    await withModel.addContextModel(modelFor(alphaBetween));

    assert.deepEqual(withModel.suggest('be'), withoutModel.suggest('be'));
    assert.deepEqual(withModel.suggest('be').map(s => s.text), ['bewilder', 'become', 'better', 'between']);
});

test('a hash mismatch disables context ranking with one warning', async () => {
    const engine = await fixtureEngine();
    const warnings = [];
    const original = console.warn;

    console.warn = message => warnings.push(message);

    try {
        await engine.addContextModel(new NgramModel(encodeNgramModel({ language: 'en', vocabHash: 42, contexts: alphaBetween })));

        assert.deepEqual(engine.suggest('be', 'alpha ').map(s => s.text), ['become', 'better', 'between', 'bewilder']);
        assert.deepEqual(engine.suggest('be', 'alpha ').map(s => s.text), ['become', 'better', 'between', 'bewilder']);
    } finally {
        console.warn = original;
    }

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /context ranking disabled/);
});

test('nextWords returns successors first, then user words fill remaining slots', async () => {
    const engine = await fixtureEngine({ maxSuggestions: 4 });

    engine.recordWord('bewilder');
    engine.recordWord('bewilder');
    await engine.addContextModel(modelFor(alphaBetween));

    const next = engine.nextWords('alpha');

    assert.deepEqual(next.map(s => s.text), ['between', 'better', 'bewilder']);
    assert.deepEqual(next.map(s => s.source), ['bundled', 'bundled', 'user-words']);
    assert.equal(next[0].insertSuffix, 'between');
    assert.deepEqual(engine.nextWords('delta').map(s => s.text), ['bewilder']);
});

test('nextWords and suggest with context degrade to current behavior without a model', async () => {
    const engine = await fixtureEngine();

    engine.recordWord('bewilder');
    engine.recordWord('bewilder');

    assert.deepEqual(engine.nextWords('alpha').map(s => s.text), ['bewilder']);
    assert.deepEqual(engine.suggest('be', 'alpha ').map(s => s.text), ['bewilder', 'become', 'better', 'between']);
});

test('suggestAt derives prefix and context from text and caret', async () => {
    const engine = await fixtureEngine();

    await engine.addContextModel(modelFor(alphaBetween));

    assert.deepEqual(engine.suggestAt('alpha bet', 9).map(s => s.text), ['between', 'better']);
    assert.deepEqual(engine.suggestAt('see alpha bet', 13).map(s => s.text), ['between', 'better']);
    assert.deepEqual(engine.suggestAt('alpha be', 8).map(s => s.text), ['between', 'better', 'become', 'bewilder']);
    assert.deepEqual(engine.suggestAt('alpha ', 6), []);
    assert.deepEqual(engine.suggestAt('', 0), []);
});

test('previousWords walks back over boundaries and clamps the index', async () => {
    const engine = await fixtureEngine();

    assert.deepEqual(engine.previousWords('one two three', 13, 2), ['three', 'two']);
    assert.deepEqual(engine.previousWords('one two three', 8, 3), ['two', 'one']);
    assert.deepEqual(engine.previousWords("aujourd'hui hier", 16, 1), ['hier']);
    assert.deepEqual(engine.previousWords('hello', 99, 1), ['hello']);
    assert.deepEqual(engine.previousWords('', 0, 1), []);
    assert.deepEqual(engine.previousWords('hello', 3, 1), ['hel']);
    assert.deepEqual(engine.previousWords('hello', 0, 1), []);
});

test('context ranking follows the active language', async () => {
    globalThis.localStorage = mockStorage();

    const engine = new SuggestEngine({ language: 'en', userWords: true });

    await engine.addWordList('bundled', words);
    await engine.addContextModel(modelFor(alphaBetween, words, 'en'));

    assert.deepEqual(engine.suggest('be', 'alpha ').map(s => s.text), ['between', 'better', 'become', 'bewilder']);

    engine.setLanguage('ar');
    await engine.addWordList('bundled', words);
    await engine.addContextModel(modelFor(
        [{ id: 0, successors: [{ id: 2, count: 5 }] }],
        words,
        'ar'
    ));

    assert.deepEqual(engine.suggest('be', 'alpha ').map(s => s.text), ['better', 'become', 'between', 'bewilder']);

    engine.setLanguage('en');
    assert.deepEqual(engine.suggest('be', 'alpha ').map(s => s.text), ['between', 'better', 'become', 'bewilder']);
});

test('addContextModel accepts buffers and rejects unsupported sources', async () => {
    const engine = await fixtureEngine();
    const buffer = encodeNgramModel({ language: 'en', vocabHash: fnv1a(words.join('\n')), contexts: alphaBetween });

    assert.equal(await engine.addContextModel(buffer), true);
    assert.equal(await engine.addContextModel(new Uint8Array(buffer)), true);
    await assert.rejects(() => engine.addContextModel(42), TypeError);
});

test('addContextModel fetches URL sources and surfaces HTTP failures', async () => {
    const engine = await fixtureEngine();
    const buffer = encodeNgramModel({ language: 'en', vocabHash: fnv1a(words.join('\n')), contexts: alphaBetween });
    const originalFetch = globalThis.fetch;

    try {
        globalThis.fetch = async url => ({ ok: true, arrayBuffer: async () => buffer });
        assert.equal(await engine.addContextModel('https://cdn.example/en.ngram.bin'), true);

        globalThis.fetch = async () => ({ ok: false, status: 404 });
        await assert.rejects(() => engine.addContextModel('https://cdn.example/en.ngram.bin'), /Unable to fetch/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('loadSuggestionContext builds the versioned URL and handles missing data', async () => {
    const engine = await fixtureEngine();
    const buffer = encodeNgramModel({ language: 'en', vocabHash: fnv1a(words.join('\n')), contexts: alphaBetween });
    const originalFetch = globalThis.fetch;
    const urls = [];

    try {
        globalThis.fetch = async url => {
            urls.push(url);

            return { ok: true, arrayBuffer: async () => buffer };
        };

        assert.equal(await engine.loadSuggestionContext('https://cdn.example/gh/lib@v0.3.0/languages'), true);
        assert.deepEqual(urls, ['https://cdn.example/gh/lib@v0.3.0/languages/en.ngram.bin']);
        assert.deepEqual(engine.suggest('be', 'alpha ').map(s => s.text), ['between', 'better', 'become', 'bewilder']);

        globalThis.fetch = async () => ({ ok: false, status: 404 });
        assert.equal(await engine.loadSuggestionContext('https://cdn.example/languages/'), false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('replacing the bundled word list invalidates a matching model', async () => {
    const engine = await fixtureEngine();

    await engine.addContextModel(modelFor(alphaBetween));
    assert.deepEqual(engine.suggest('be', 'alpha ').map(s => s.text), ['between', 'better', 'become', 'bewilder']);

    await engine.addWordList('bundled', ['other', 'words']);
    assert.deepEqual(engine.suggest('be', 'alpha ').map(s => s.text), []);
});
