export function kataToHira(text) {
    return text.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function normalizeReading(text) {
    return kataToHira(String(text ?? '').normalize('NFC').toLowerCase().replaceAll(' ', ''));
}

const t9DigitKeys = {
    a: '2', b: '2', c: '2', d: '3', e: '3', f: '3', g: '4', h: '4', i: '4',
    j: '5', k: '5', l: '5', m: '6', n: '6', o: '6', p: '7', q: '7', r: '7', s: '7',
    t: '8', u: '8', v: '8', w: '9', x: '9', y: '9', z: '9',
};

export function readingToDigits(reading) {
    let digits = '';

    for (const char of reading) {
        const digit = t9DigitKeys[char];

        if (!digit) return null;

        digits += digit;
    }

    return digits;
}

export function isReadingLike(text, reading) {
    if (typeof text !== 'string' || !text.length) return false;

    return reading === 'kana'
        ? /^[\p{Script=Hiragana}\p{Script=Katakana}\u30FC]+$/u.test(text)
        : /^[a-z]+$/.test(text);
}

export function parseComposition(text, reading) {
    const entries = [];
    const exact = new Map();
    const readingByCandidate = new Map();
    const seen = new Set();
    const vocab = [];

    for (const line of String(text ?? '').split('\n')) {
        const parts = line.trim().split(/\s+/);

        if (parts.length < 2) continue;

        const key = normalizeReading(parts[0]);
        const candidates = parts.slice(1);

        if (!key) continue;

        if (!exact.has(key)) exact.set(key, []);

        exact.get(key).push(...candidates);
        entries.push({ reading: key, candidates });

        for (const candidate of candidates) {
            if (!readingByCandidate.has(candidate)) readingByCandidate.set(candidate, key);

            if (!seen.has(candidate)) {
                seen.add(candidate);
                vocab.push(candidate);
            }
        }
    }

    return { reading, entries, exact, readingByCandidate, vocab };
}

export function compositionCandidates(composition, buffer) {
    const seen = new Set();
    const candidates = [];

    const push = text => {
        if (!seen.has(text)) {
            seen.add(text);
            candidates.push(text);
        }
    };

    if (!composition || typeof buffer !== 'string' || !buffer.length) return candidates;

    if (/^\d+$/.test(buffer)) {
        for (const entry of composition.entries) {
            const digits = readingToDigits(entry.reading);

            if (digits !== null && digits.startsWith(buffer)) for (const text of entry.candidates) push(text);
        }

        return candidates;
    }

    const wanted = normalizeReading(buffer);

    if (!wanted) return candidates;

    for (const text of composition.exact.get(wanted) || []) push(text);

    for (const entry of composition.entries) {
        if (entry.reading.startsWith(wanted)) for (const text of entry.candidates) push(text);
    }

    return candidates;
}

const voicedPairs = [
    ['かきくけこ', 'がぎぐげご'],
    ['さしすせそ', 'ざじずぜぞ'],
    ['たちつてと', 'だぢづでど'],
    ['はひふへほ', 'ばびぶべぼ'],
    ['カキクケコ', 'ガギグゲゴ'],
    ['サシスセソ', 'ザジズゼゾ'],
    ['タチツテト', 'ダヂヅデド'],
    ['ハヒフヘホ', 'バビブベボ'],
    ['ウ', 'ヴ'],
];

const semiVoicedPairs = [
    ['はひふへほ', 'ぱぴぷぺぽ'],
    ['ハヒフヘホ', 'パピプペポ'],
];

const dakutenForward = new Map();
const dakutenBackward = new Map();
const semiVoicedForward = new Map();
const semiVoicedBackward = new Map();

for (const [base, voiced] of voicedPairs) {
    for (let i = 0; i < base.length; i ++) {
        dakutenForward.set(base[i], voiced[i]);
        dakutenBackward.set(voiced[i], base[i]);
    }
}

for (const [base, voiced] of semiVoicedPairs) {
    for (let i = 0; i < base.length; i ++) {
        semiVoicedForward.set(base[i], voiced[i]);
        semiVoicedBackward.set(voiced[i], base[i]);
    }
}

export function voiceKanaChar(char, mark) {
    const backward = mark === '゜' ? semiVoicedBackward : dakutenBackward;
    const forward = mark === '゜' ? semiVoicedForward : dakutenForward;

    if (backward.has(char)) return backward.get(char);
    if (forward.has(char)) return forward.get(char);

    return null;
}
