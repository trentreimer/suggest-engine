import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SuggestEngine } from '../src/engine.js';
import { parseComposition, compositionCandidates, normalizeReading, readingToDigits, isReadingLike, voiceKanaChar } from '../src/composition.js';

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

const fixture = 'de 的 得 德\nni 你 尼 妮\nni 你好\nhao 好\n';

test('parseComposition indexes readings, dedupes the vocabulary, records first readings', () => {
    const composition = parseComposition(fixture, 'pinyin');

    assert.deepEqual(composition.vocab, ['的', '得', '德', '你', '尼', '妮', '你好', '好']);
    assert.deepEqual(composition.exact.get('ni'), ['你', '尼', '妮', '你好']);
    assert.equal(composition.readingByCandidate.get('你'), 'ni');
    assert.equal(composition.readingByCandidate.get('你好'), 'ni');
    assert.equal(composition.entries.length, 4);
});

test('normalizeReading lowercases, strips spaces and folds katakana to hiragana', () => {
    assert.equal(normalizeReading(' ニ '), 'に');
    assert.equal(normalizeReading('カタカナ'), 'かたかな');
    assert.equal(normalizeReading('NI'), 'ni');
});

test('compositionCandidates prefers exact readings, then prefixes, and supports digits', () => {
    const composition = parseComposition(fixture, 'pinyin');

    assert.deepEqual(compositionCandidates(composition, 'ni'), ['你', '尼', '妮', '你好']);
    assert.deepEqual(compositionCandidates(composition, 'n'), ['你', '尼', '妮', '你好']);
    assert.deepEqual(compositionCandidates(composition, ''), []);

    const digits = parseComposition('ni 你 尼\nmi 蜜\n', 'pinyin');

    assert.deepEqual(compositionCandidates(digits, '64'), ['你', '尼', '蜜']);
    assert.deepEqual(compositionCandidates(digits, '6'), ['你', '尼', '蜜']);
    assert.deepEqual(compositionCandidates(digits, '2'), []);
});

test('readingToDigits and voiceKanaChar map like the reference IME', () => {
    assert.equal(readingToDigits('ni'), '64');
    assert.equal(readingToDigits('に'), null);
    assert.equal(voiceKanaChar('は', '゛'), 'ば');
    assert.equal(voiceKanaChar('は', '゜'), 'ぱ');
    assert.equal(voiceKanaChar('ば', '゛'), 'は');
    assert.equal(voiceKanaChar('か', '゜'), null);
});

test('isReadingLike distinguishes readings from committed text', () => {
    assert.equal(isReadingLike('ni', 'pinyin'), true);
    assert.equal(isReadingLike('的', 'pinyin'), false);
    assert.equal(isReadingLike('はな', 'kana'), true);
    assert.equal(isReadingLike('ニャ', 'kana'), true);
    assert.equal(isReadingLike('花', 'kana'), false);
    assert.equal(isReadingLike('', 'pinyin'), false);
});

test('loadComposition bundles zh and ja but not word-list languages', async () => {
    globalThis.localStorage = mockStorage();

    const engine = new SuggestEngine({ language: 'zh' });

    assert.equal(engine.compositionActive, true);
    assert.equal(await engine.loadComposition('en'), false);
    assert.equal(await engine.loadComposition('zh'), true);
    assert.equal(await engine.loadWordList('zh'), false);

    const jaEngine = new SuggestEngine({ language: 'ja' });

    assert.equal(await jaEngine.loadComposition(), true);
});

test('zh candidates follow frequency order and exact readings first', async () => {
    globalThis.localStorage = mockStorage();

    const engine = new SuggestEngine({ language: 'zh' });
    await engine.loadComposition('zh');

    const suggestions = engine.compositionAppend('ni');

    assert.deepEqual(suggestions.slice(0, 4).map(s => s.text), ['你', '尼', '妮', '泥']);
    assert.equal(suggestions[0].insertSuffix, '你');
    assert.equal(suggestions[0].source, 'bundled');
});

test('ja folds katakana input and voices the buffer through the engine', async () => {
    globalThis.localStorage = mockStorage();

    const engine = new SuggestEngine({ language: 'ja' });
    await engine.loadComposition('ja');

    assert.deepEqual(engine.compositionAppend('わたし').map(s => s.text), ['私', '渡し']);

    assert.equal(engine.compositionBackspace(), true);
    assert.equal(engine.compositionBuffer(), 'わた');
    assert.deepEqual(engine.compositionSuggestions().slice(0, 3).map(s => s.text), ['渡', '綿', '亙']);

    engine.compositionReset();
    assert.equal(engine.compositionBuffer(), '');
    assert.deepEqual(engine.compositionSuggestions(), []);

    engine.compositionAppend('は');
    assert.equal(engine.compositionVoiceLast('゛'), true);
    assert.equal(engine.compositionBuffer(), 'ば');
    assert.deepEqual(engine.compositionSuggestions().slice(0, 2).map(s => s.text), ['場', '馬']);
    assert.equal(engine.compositionVoiceLast('゜'), false);
    assert.equal(engine.compositionBuffer(), 'ば');

    engine.compositionReset();
    engine.compositionAppend('は');
    assert.equal(engine.compositionVoiceLast('゜'), true);
    assert.equal(engine.compositionBuffer(), 'ぱ');
});

test('context reranks candidates through the ngram model', async () => {
    globalThis.localStorage = mockStorage();

    const engine = new SuggestEngine({ language: 'zh' });
    await engine.loadComposition('zh');
    await engine.addContextModel(readFileSync(new URL('../languages/zh.ngram.bin', import.meta.url)));

    engine.compositionAppend('ni');

    const plain = engine.compositionSuggestions().map(s => s.text);
    const reranked = engine.compositionSuggestions('由').map(s => s.text);

    assert.equal(plain[0], '你');
    assert.notEqual(reranked[0], '你');
    assert.equal(reranked[0], '你來');
    assert.ok(reranked.includes('你'));

    const suggestAt = engine.suggestAt('由', 1).map(s => s.text);

    assert.equal(suggestAt[0], '你來');
});

test('suggest() doubles as a stateless reading lookup', async () => {
    globalThis.localStorage = mockStorage();

    const engine = new SuggestEngine({ language: 'ja' });
    await engine.loadComposition('ja');

    assert.deepEqual(engine.suggest('はな').slice(0, 3).map(s => s.text), ['話', '花', '鼻']);

    const zhEngine = new SuggestEngine({ language: 'zh' });
    await zhEngine.loadComposition('zh');

    assert.deepEqual(zhEngine.suggest('de').slice(0, 3).map(s => s.text), ['的', '得', '德']);
});

test('repeatedly chosen characters surface as user words by reading', async () => {
    globalThis.localStorage = mockStorage();

    const engine = new SuggestEngine({ language: 'zh', userWords: true });
    await engine.loadComposition('zh');

    assert.equal(engine.recordWord('你'), true);
    assert.equal(engine.recordWord('你'), true);

    const suggestions = engine.compositionAppend('ni');

    assert.equal(suggestions[0].text, '你');
    assert.equal(suggestions[0].source, 'user-words');
    assert.equal(suggestions[1].text, '尼');
});

test('composition languages learn single characters, latin languages do not', () => {
    globalThis.localStorage = mockStorage();

    const zhEngine = new SuggestEngine({ language: 'zh', userWords: true });

    assert.equal(zhEngine.recordWord('你'), true);

    const enEngine = new SuggestEngine({ language: 'en', userWords: true });

    assert.equal(enEngine.recordWord('a'), false);
    assert.equal(enEngine.recordWord('ab'), true);
});

test('context extraction walks CJK text character by character', async () => {
    globalThis.localStorage = mockStorage();

    const engine = new SuggestEngine({ language: 'zh' });
    await engine.loadComposition('zh');

    assert.deepEqual(engine.previousWords('你好世界', 4, 3), ['界', '世', '好']);
    assert.deepEqual(engine.previousWords('你好 abc世', 7, 3), ['世', 'abc', '好']);
    assert.equal(engine.wordAt('你好世', 3), '');
    assert.equal(engine.wordAt('abc 你', 5), '');

    const engine2 = new SuggestEngine({ language: 'en' });

    assert.deepEqual(engine2.previousWords('hello world', 11, 2), ['world', 'hello']);
    assert.equal(engine2.wordAt('hello world', 11), 'world');
});

test('nextWords predicts continuations over the candidate vocabulary', async () => {
    globalThis.localStorage = mockStorage();

    const engine = new SuggestEngine({ language: 'zh' });
    await engine.loadComposition('zh');
    await engine.addContextModel(readFileSync(new URL('../languages/zh.ngram.bin', import.meta.url)));

    const next = engine.nextWords('你好').map(s => s.text);

    assert.equal(next[0], '吗');
});

test('composition buffers are per language and inert before load', async () => {
    globalThis.localStorage = mockStorage();

    const engine = new SuggestEngine({ language: 'zh' });

    assert.deepEqual(engine.compositionAppend('ni'), []);

    await engine.loadComposition('zh');
    engine.compositionAppend('ni');
    assert.equal(engine.compositionBuffer(), 'ni');

    engine.setLanguage('ja');
    assert.equal(engine.compositionBuffer(), '');
    assert.equal(engine.compositionActive, true);

    engine.setLanguage('en');
    assert.equal(engine.compositionActive, false);
    assert.deepEqual(engine.compositionSuggestions(), []);
});
