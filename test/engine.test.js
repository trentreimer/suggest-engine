import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SuggestEngine } from '../src/engine.js';

function mockStorage(throwing = false) {
    const store = new Map();
    return {
        calls: 0,
        getItem(key) {
            this.calls ++;
            if (throwing) throw new Error('denied');
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            this.calls ++;
            if (throwing) throw new Error('denied');
            store.set(key, String(value));
        },
        removeItem(key) {
            this.calls ++;
            if (!throwing) store.delete(key);
        },
        clear() {
            store.clear();
        },
    };
}

test('userWords omitted keeps the component inert with zero storage access', () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en' });

    assert.equal(engine.recordWord('Sarah'), false);
    assert.equal(engine.addWord('Sarah'), false);
    assert.deepEqual(engine.userWords(), []);
    assert.equal(engine.removeUserWord('sarah'), false);
    engine.clearUserWords();
    assert.equal(storage.calls, 0);
});

test('userWords: true enables learning with generic defaults', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en', userWords: true });
    await engine.addWordList('main', ['said', 'sarah']);

    assert.equal(engine.recordWord('Sarah'), true);
    assert.equal(engine.recordWord('Sarah'), true);

    const suggestions = engine.suggest('sa');

    assert.deepEqual(suggestions.map(s => s.text), ['Sarah', 'said']);
    assert.equal(suggestions[0].insertSuffix, 'rah');
    assert.equal(suggestions[0].source, 'user-words');
    assert.equal(suggestions[1].source, 'main');
    assert.match(storage.getItem('suggest-engine:user-words'), /"version":1/);
});

test('userWords object enables with overrides while the rest default', () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en', userWords: { storagePrefix: 'ctt' } });
    engine.recordWord('Sam');
    engine.recordWord('Sam');

    assert.ok(storage.getItem('ctt:user-words'));
    assert.deepEqual(engine.suggest('sa').map(s => s.text), ['Sam']);
});

test('empty userWords object enables with all defaults', () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en', userWords: {} });
    engine.recordWord('Solo');
    engine.recordWord('Solo');

    assert.ok(storage.getItem('suggest-engine:user-words'));
});

test('user words rank by frequency ahead of alphabetical sources', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en', userWords: true });
    await engine.addWordList('main', ['sable', 'sachet']);

    engine.recordWord('Sable');
    engine.recordWord('Sable');
    engine.recordWord('Sable');

    assert.deepEqual(engine.suggest('sa').map(s => s.text), ['Sable', 'sachet']);
});

test('suggest dedupes case-insensitively and shows dictionary casing', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en', userWords: true });
    await engine.addWordList('main', ['sarah']);

    engine.recordWord('Sarah');
    engine.recordWord('Sarah');

    const suggestions = engine.suggest('SA');

    assert.deepEqual(suggestions.map(s => s.text), ['Sarah']);
    assert.equal(suggestions[0].insertSuffix, 'rah');
});

test('suggest caps results at maxSuggestions', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en', maxSuggestions: 3, userWords: true });
    await engine.addWordList('main', ['saa', 'sab', 'sac', 'sad', 'sae']);

    assert.equal(engine.suggest('s').length, 3);
});

test('wordBefore respects apostrophes, hyphens and marks', () => {
    const engine = new SuggestEngine();

    assert.equal(engine.wordBefore("aujourd'hui", 11), "aujourd'hui");
    assert.equal(engine.wordBefore('peut-être', 9), 'peut-être');
    assert.equal(engine.wordBefore('hello world', 5), 'hello');
    assert.equal(engine.wordBefore('hello world', 6), '');
    assert.equal(engine.wordBefore('hello', 5), 'hello');
    assert.equal(engine.wordBefore('', 0), '');
    assert.equal(engine.wordBefore('कौन-सा', 6), 'कौन-सा');
});

test('wordBefore clamps the index and supports custom boundary chars', () => {
    const engine = new SuggestEngine({ wordBoundaryChars: "'-_" });

    assert.equal(engine.wordBefore('a_b', 3), 'a_b');
    assert.equal(engine.wordBefore('hello', 99), 'hello');
    assert.equal(engine.wordBefore('a-b', 3), 'a-b');
});

test('setLanguage switches source sets and user buckets', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en', userWords: true });
    await engine.addWordList('main', ['sable']);

    engine.setLanguage('ar');
    assert.deepEqual(engine.suggest('sa'), []);

    engine.recordWord('أحمد');
    engine.recordWord('أحمد');
    assert.deepEqual(engine.suggest('أح').map(s => s.text), ['أحمد']);

    engine.setLanguage('en');
    assert.deepEqual(engine.suggest('sa').map(s => s.text), ['sable']);
    assert.deepEqual(engine.suggest('أح'), []);
});

test('a disabled component still suggests from sources', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en' });
    await engine.addWordList('main', ['sable', 'sachet']);

    assert.deepEqual(engine.suggest('sa').map(s => s.text), ['sable', 'sachet']);
    assert.equal(storage.calls, 0);
});

test('word list order is suggestion priority, not alphabetical', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en' });
    await engine.addWordList('main', ['my', 'macedonia']);

    assert.deepEqual(engine.suggest('m').map(s => s.text), ['my', 'macedonia']);
});

test('bundled word lists load, rank by frequency, and skip missing languages', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en', maxSuggestions: 10 });
    assert.equal(await engine.loadBundledWordList(), true);

    const mSuggestions = engine.suggest('m').map(s => s.text);
    assert.ok(mSuggestions.includes('my'), "'my' should be suggested for 'm'");

    const macedonia = mSuggestions.findIndex(t => t.toLowerCase() === 'macedonia');
    if (macedonia !== -1) assert.ok(mSuggestions.indexOf('my') < macedonia, "'my' should outrank 'macedonia'");

    assert.equal(engine.suggest('th')[0].text, 'the');

    engine.setLanguage('ar');
    assert.equal(await engine.loadBundledWordList(), true);
    assert.equal(engine.suggest('ف')[0].text, 'في');

    engine.setLanguage('sw');
    assert.equal(await engine.loadBundledWordList(), true);
    assert.equal(engine.suggest('kw')[0].text, 'kwa');

    engine.setLanguage('pcm');
    assert.equal(await engine.loadBundledWordList(), true);
    assert.equal(engine.suggest('we')[0].text, 'wey');

    engine.setLanguage('it');
    assert.equal(await engine.loadBundledWordList(), true);
    assert.equal(engine.suggest('ch')[0].text, 'che');

    engine.setLanguage('ko');
    assert.equal(await engine.loadBundledWordList(), true);
    assert.equal(engine.suggest('그')[0].text, '그는');

    engine.setLanguage('am');
    assert.equal(await engine.loadBundledWordList(), true);
    assert.equal(engine.suggest('እ')[0].text, 'እና');

    engine.setLanguage('gu');
    assert.equal(await engine.loadBundledWordList(), true);
    assert.equal(engine.suggest('અ')[0].text, 'અને');

    assert.equal(await engine.loadBundledWordList('zh'), false);
    assert.equal(await engine.loadBundledWordList('../escape'), false);
});

test('earlier-registered sources rank ahead of bundled data', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en' });
    await engine.addWordList('custom', ['mica']);
    await engine.loadBundledWordList();

    const first = engine.suggest('mi')[0];
    assert.equal(first.text, 'mica');
    assert.equal(first.source, 'custom');
});

test('disableUserWords wipes storage across languages and stops learning', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en', userWords: { storagePrefix: 'ctt' } });

    engine.recordWord('sable');
    engine.recordWord('sable');
    engine.setLanguage('ar');
    engine.recordWord('أحمد');
    engine.recordWord('أحمد');
    assert.ok(storage.getItem('ctt:user-words'));

    engine.disableUserWords();
    assert.equal(storage.getItem('ctt:user-words'), null);
    assert.deepEqual(engine.userWords(), []);

    engine.setLanguage('en');
    await engine.addWordList('main', ['sable', 'sachet']);

    assert.equal(engine.recordWord('sable'), false);
    assert.equal(engine.addWord('sable'), false);
    assert.deepEqual(engine.suggest('sa').map(s => s.text), ['sable', 'sachet']);
    assert.equal(engine.removeUserWord('sable'), false);
    assert.equal(storage.getItem('ctt:user-words'), null);
});

test('disableUserWords removes the key even if words were never read this session', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;
    storage.setItem('suggest-engine:user-words', JSON.stringify({ version: 1, languages: { en: { sa: { word: 'sa', count: 5, last: 0 } } } }));

    const engine = new SuggestEngine({ language: 'en', userWords: true });

    engine.disableUserWords();
    assert.equal(storage.getItem('suggest-engine:user-words'), null);
    assert.deepEqual(engine.suggest('sa'), []);
});

test('enableUserWords after disable starts clean and learns again', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en', userWords: { storagePrefix: 'ctt' } });
    engine.recordWord('sam');
    engine.recordWord('sam');
    engine.disableUserWords();

    engine.enableUserWords();
    assert.deepEqual(engine.suggest('sa').map(s => s.text), []);
    assert.equal(engine.suggest('sa')[0]?.source, undefined);

    engine.recordWord('solo');
    engine.recordWord('solo');
    assert.deepEqual(engine.suggest('so').map(s => s.text), ['solo']);
    assert.match(storage.getItem('ctt:user-words'), /"version":1/);
});

test('enableUserWords keeps the current language and preserves word-list sources', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en', userWords: true });
    await engine.addWordList('main', ['sable']);

    engine.setLanguage('ar');
    engine.disableUserWords();
    engine.enableUserWords();

    engine.recordWord('أحمد');
    engine.recordWord('أحمد');
    assert.deepEqual(engine.suggest('أح').map(s => s.text), ['أحمد']);

    engine.setLanguage('en');
    assert.deepEqual(engine.suggest('sa').map(s => s.text), ['sable']);
});

test('enable/disable are no-ops when already in that state', async () => {
    const storage = mockStorage();
    globalThis.localStorage = storage;

    const engine = new SuggestEngine({ language: 'en', userWords: true });
    engine.recordWord('sam');
    engine.recordWord('sam');
    engine.enableUserWords();
    assert.deepEqual(engine.suggest('sa').map(s => s.text), ['sam']);

    const disabled = new SuggestEngine({ language: 'en' });
    storage.calls = 0;
    disabled.disableUserWords();
    assert.equal(storage.calls, 0);
});
