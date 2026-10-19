import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserWords } from '../src/user-words.js';

function mockStorage(throwing = false) {
    const store = new Map();
    return {
        getItem(key) {
            if (throwing) throw new Error('denied');
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            if (throwing) throw new Error('denied');
            store.set(key, String(value));
        },
        removeItem(key) {
            if (!throwing) store.delete(key);
        },
        clear() {
            store.clear();
        },
    };
}

test('words promote at the threshold of two records', () => {
    globalThis.localStorage = mockStorage();
    const words = new UserWords();

    assert.equal(words.record('Sarah'), true);
    assert.deepEqual(words.suggestionsFor('sa'), []);
    words.record('Sarah');
    assert.deepEqual(words.suggestionsFor('sa'), ['Sarah']);
});

test('suggestions rank by count then alphabetically', () => {
    globalThis.localStorage = mockStorage();
    const words = new UserWords();

    words.record('Sarah');
    words.record('Sarah');
    words.record('Sam');
    words.record('Sam');
    words.record('Sam');

    assert.deepEqual(words.suggestionsFor('s'), ['Sam', 'Sarah']);
});

test('auto-capitalized recordings keep the lowercase form', () => {
    globalThis.localStorage = mockStorage();
    const words = new UserWords();

    words.record('Hi', { autoCapitalized: true });
    words.record('Hi', { autoCapitalized: true });

    assert.deepEqual(words.suggestionsFor('h'), ['hi']);
    assert.deepEqual(words.list(), [{ word: 'hi', count: 2 }]);
});

test('a manual casing sticks over auto-capitalized recordings', () => {
    globalThis.localStorage = mockStorage();
    const words = new UserWords();

    words.record('John');
    for (let i = 0; i < 5; i ++) words.record('John', { autoCapitalized: true });

    assert.deepEqual(words.suggestionsFor('j'), ['John']);
});

test('the most frequent manual casing wins', () => {
    globalThis.localStorage = mockStorage();
    const words = new UserWords();

    words.record('hi');
    words.record('hi');
    words.record('Hi');
    assert.deepEqual(words.suggestionsFor('h'), ['hi']);

    words.record('Hi');
    assert.deepEqual(words.suggestionsFor('h'), ['Hi']);
});

test('auto capitalization leaves other casing patterns alone', () => {
    globalThis.localStorage = mockStorage();

    const internal = new UserWords({ storagePrefix: 'internal' });
    internal.record('McDonald', { autoCapitalized: true });
    internal.record('McDonald', { autoCapitalized: true });
    assert.deepEqual(internal.suggestionsFor('m'), ['McDonald']);

    const upper = new UserWords({ storagePrefix: 'upper' });
    upper.record('HELLO', { autoCapitalized: true });
    upper.record('HELLO', { autoCapitalized: true });
    assert.deepEqual(upper.suggestionsFor('h'), ['HELLO']);

    const lower = new UserWords({ storagePrefix: 'lower' });
    lower.record('hi', { autoCapitalized: true });
    lower.record('hi', { autoCapitalized: true });
    assert.deepEqual(lower.suggestionsFor('h'), ['hi']);
});

test('entries from the old storage schema migrate with sentence-start capitals dropped', () => {
    const storage = mockStorage();

    storage.setItem('suggest-engine:user-words', JSON.stringify({
        version: 1,
        languages: {
            en: {
                are: { word: 'Are', count: 4, last: 123 },
                sarah: { word: 'Sarah', count: 3, last: 122 },
            },
        },
    }));

    globalThis.localStorage = storage;
    const words = new UserWords();

    assert.deepEqual(words.suggestionsFor('a'), ['are']);
    assert.deepEqual(words.suggestionsFor('sa'), ['sarah']);
});

test('old internal capitals and all-caps survive migration', () => {
    const storage = mockStorage();

    storage.setItem('suggest-engine:user-words', JSON.stringify({
        version: 1,
        languages: {
            en: {
                mcdonald: { word: 'McDonald', count: 2, last: 123 },
                hello: { word: 'HELLO', count: 2, last: 122 },
                iphone: { word: 'iPhone', count: 2, last: 121 },
            },
        },
    }));

    globalThis.localStorage = storage;
    const words = new UserWords();

    assert.deepEqual(words.suggestionsFor('m'), ['McDonald']);
    assert.deepEqual(words.suggestionsFor('h'), ['HELLO']);
    assert.deepEqual(words.suggestionsFor('i'), ['iPhone']);
});

test('a migrated lowercase word regains its capital after manual use', () => {
    const storage = mockStorage();

    storage.setItem('suggest-engine:user-words', JSON.stringify({
        version: 1,
        languages: { en: { john: { word: 'John', count: 3, last: 123 } } },
    }));

    globalThis.localStorage = storage;
    const words = new UserWords();

    assert.deepEqual(words.suggestionsFor('j'), ['john']);

    words.record('John');
    assert.deepEqual(words.suggestionsFor('j'), ['John']);
});

test('casing variants persist across reloads', () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const words = new UserWords({ storagePrefix: 'ctt' });
    words.record('Hi', { autoCapitalized: true });
    words.record('Hi', { autoCapitalized: true });
    words.record('John');
    words.record('John');

    const revived = new UserWords({ storagePrefix: 'ctt' });

    assert.deepEqual(revived.suggestionsFor('h'), ['hi']);
    assert.deepEqual(revived.suggestionsFor('j'), ['John']);
});

test('invalid words are rejected', () => {
    globalThis.localStorage = mockStorage();
    const words = new UserWords();

    assert.equal(words.record('1234'), false);
    assert.equal(words.record('a'), false);
    assert.equal(words.record('  '), false);
    assert.equal(words.record('hello world'), false);
    assert.equal(words.record(42), false);
});

test('language connector characters are accepted only when configured', () => {
    globalThis.localStorage = mockStorage();
    const words = new UserWords();

    words.setLanguage('fa', '\u200C');
    assert.equal(words.record('می\u200cروم'), true);
    assert.equal(words.record('می رو م'), false);

    words.setLanguage('fa');
    assert.equal(words.record('می\u200cروم'), false);
});

test('add makes a word immediately suggestible', () => {
    globalThis.localStorage = mockStorage();
    const words = new UserWords();

    assert.equal(words.add('Zed'), true);
    assert.deepEqual(words.suggestionsFor('z'), ['Zed']);
});

test('data persists across reloads and isolates languages', () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;
    const words = new UserWords({ storagePrefix: 'ctt' });

    words.record('Sarah');
    words.record('Sarah');

    const revived = new UserWords({ storagePrefix: 'ctt' });
    revived.setLanguage('ar');
    assert.deepEqual(revived.suggestionsFor('sa'), []);
    revived.record('أحمد');
    revived.record('أحمد');
    assert.deepEqual(revived.suggestionsFor('أح'), ['أحمد']);

    const english = new UserWords({ storagePrefix: 'ctt' });
    assert.deepEqual(english.suggestionsFor('sa'), ['Sarah']);
});

test('eviction keeps the cap by lowest count then oldest', () => {
    globalThis.localStorage = mockStorage();
    const words = new UserWords({ maxWords: 10 });

    for (let i = 0; i < 15; i ++) words.record('w'.repeat(i + 2));

    assert.equal(words.list().length, 10);
});

test('storage failure falls back to in-memory learning', () => {
    globalThis.localStorage = mockStorage(true);
    const words = new UserWords();

    assert.equal(words.record('Offline'), true);
    assert.ok(words.list().some(entry => entry.word === 'Offline'));
});

test('remove and clear work per language', () => {
    globalThis.localStorage = mockStorage();
    const words = new UserWords();

    words.add('Zed');
    assert.equal(words.remove('zed'), true);
    assert.deepEqual(words.suggestionsFor('z'), []);
    assert.equal(words.remove('zed'), false);

    words.add('Yak');
    words.clear();
    assert.deepEqual(words.list(), []);
});
