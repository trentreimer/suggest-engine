import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeJamo, backspaceHangul } from '../src/jamo.js';

test('composeJamo builds syllable blocks from compatibility jamo', () => {
    assert.equal(composeJamo('ㅎㅏ'), '하');
    assert.equal(composeJamo('ㅎㅏㄴ'), '한');
    assert.equal(composeJamo('ㅎㅏㄴㄱㅜㄱ'), '한국');
    assert.equal(composeJamo('ㄱㅗㅏ'), '과');
});

test('composeJamo handles compound finals', () => {
    assert.equal(composeJamo('ㅇㅓㅂㅅ'), '없');
    assert.equal(composeJamo('ㄷㅏㄹㄱ'), '닭');
    assert.equal(composeJamo('ㅂㅏㄹㅂ'), '밟');
    assert.equal(composeJamo('ㅇㅏㄹㄱ'), '앍');
});

test('composeJamo leaves already-composed syllables unchanged', () => {
    assert.equal(composeJamo('나는'), '나는');
    assert.equal(composeJamo('안녕하세요'), '안녕하세요');
});

test('composeJamo attaches jamo to composed syllables like an IME', () => {
    assert.equal(composeJamo('한ㄱㅜㄱ'), '한국');
    assert.equal(composeJamo('한ㅏ'), '하나');
    assert.equal(composeJamo('가ㄴ'), '간');
    assert.equal(composeJamo('가ㄴㅏ'), '가나');
    assert.equal(composeJamo('ㅎㅏㄴㄴ'), '한ㄴ');
});

test('composeJamo flushes on non-Hangul and standalone jamo', () => {
    assert.equal(composeJamo('ㅎㅏㄴ hello'), '한 hello');
    assert.equal(composeJamo('ㄱㄴ'), 'ㄱㄴ');
    assert.equal(composeJamo('ㅏㅓ'), 'ㅏㅓ');
    assert.equal(composeJamo(''), '');
    assert.equal(composeJamo('abc'), 'abc');
});

test('composeJamo accepts conjoining jamo (NFD text)', () => {
    assert.equal(composeJamo('한'.normalize('NFD')), '한');
    assert.equal(composeJamo('안녕'.normalize('NFD')), '안녕');
});

test('backspaceHangul steps back through composition states', () => {
    assert.equal(backspaceHangul('한'), '하');
    assert.equal(backspaceHangul('하'), 'ㅎ');
    assert.equal(backspaceHangul('ㅎ'), '');
    assert.equal(backspaceHangul('가'), 'ㄱ');
    assert.equal(backspaceHangul('안녕'), '안녀');
});

test('backspaceHangul drops one consonant from compound finals', () => {
    assert.equal(backspaceHangul('없'), '업');
    assert.equal(backspaceHangul('밟'), '발');
});

test('backspaceHangul drops one vowel from compound medials', () => {
    assert.equal(backspaceHangul('과'), '고');
    assert.equal(backspaceHangul('의'), '으');
});

test('backspaceHangul returns null when there is no trailing Hangul', () => {
    assert.equal(backspaceHangul('abc'), null);
    assert.equal(backspaceHangul(''), null);
    assert.equal(backspaceHangul('가 '), null);
});

test('composeJamo and backspaceHangul round-trip', () => {
    assert.equal(backspaceHangul(composeJamo('ㅎㅏㄴ')), '하');
    assert.equal(backspaceHangul(backspaceHangul(composeJamo('ㅎㅏㄴ'))), 'ㅎ');
});
