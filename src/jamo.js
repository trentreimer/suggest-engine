// Hangul jamo composition for keyboard layouts that type decomposed letters
// (2-beolsik). The engine ships these as pure helpers, like voiceKanaChar:
// hosts apply them to editor text, and the bundled word lists stay composed.

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const CHO_INDEX = new Map(CHO.map((jamo, index) => [jamo, index]));
const JUNG_INDEX = new Map(JUNG.map((jamo, index) => [jamo, index]));
const JONG_INDEX = new Map(JONG.map((jamo, index) => [jamo, index]));

// Medials that combine when a vowel follows a vowel, and the reverse.
const MEDIAL_COMPOUND = {
    'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ',
    'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ',
    'ㅡㅣ': 'ㅢ',
};
const MEDIAL_SPLIT = { 'ㅘ': 'ㅗ', 'ㅙ': 'ㅗ', 'ㅚ': 'ㅗ', 'ㅝ': 'ㅜ', 'ㅞ': 'ㅜ', 'ㅟ': 'ㅜ', 'ㅢ': 'ㅡ' };

// Finals that combine when a consonant follows a consonant.
const FINAL_COMPOUND = {
    'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ',
    'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ',
    'ㅂㅅ': 'ㅄ',
};
// A following vowel moves the last consonant of a compound final into a new syllable.
const FINAL_SPLIT = {
    'ㄳ': ['ㄱ', 'ㅅ'], 'ㄵ': ['ㄴ', 'ㅈ'], 'ㄶ': ['ㄴ', 'ㅎ'],
    'ㄺ': ['ㄹ', 'ㄱ'], 'ㄻ': ['ㄹ', 'ㅁ'], 'ㄼ': ['ㄹ', 'ㅂ'], 'ㄽ': ['ㄹ', 'ㅅ'],
    'ㄾ': ['ㄹ', 'ㅌ'], 'ㄿ': ['ㄹ', 'ㅍ'], 'ㅀ': ['ㄹ', 'ㅎ'], 'ㅄ': ['ㅂ', 'ㅅ'],
};

// Conjoining jamo (U+1100 block) map onto the same tables, so NFD text works too.
const CONJOINING = new Map();

for (let i = 0; i < CHO.length; i ++) CONJOINING.set(String.fromCodePoint(0x1100 + i), CHO[i]);
for (let i = 0; i < JUNG.length; i ++) CONJOINING.set(String.fromCodePoint(0x1161 + i), JUNG[i]);
for (let i = 1; i < JONG.length; i ++) CONJOINING.set(String.fromCodePoint(0x11A7 + i), JONG[i]);

function isSyllable(char) {
    const code = char.codePointAt(0);
    return code >= 0xAC00 && code <= 0xD7A3;
}

function isConsonant(char) {
    return char !== '' && CHO_INDEX.has(char);
}

function isVowel(char) {
    return char !== '' && JUNG_INDEX.has(char);
}

function isFinal(char) {
    return char !== '' && JONG_INDEX.has(char);
}

function syllable(cho, jung, jong = '') {
    return String.fromCodePoint(0xAC00 + (CHO_INDEX.get(cho) * 21 + JUNG_INDEX.get(jung)) * 28 + JONG_INDEX.get(jong));
}

function splitSyllable(char) {
    const offset = char.codePointAt(0) - 0xAC00;

    return {
        cho: CHO[Math.floor(offset / 588)],
        jung: JUNG[Math.floor((offset % 588) / 28)],
        jong: JONG[offset % 28],
    };
}

/**
 * Composes a run of Hangul jamo (compatibility or conjoining) into syllable
 * blocks, 2-beolsik style. Already-composed syllables in the run pass through
 * unchanged unless a following jamo attaches to them (for example `한` + `ㅏ`
 * becomes `하나`, matching a Korean IME).
 */
export function composeJamo(text) {
    if (typeof text !== 'string' || !text) return '';

    let out = '';
    let cho = '';
    let jung = '';
    let jong = '';

    const flush = () => {
        if (cho && jung) out += syllable(cho, jung, jong);
        else out += cho || jung;

        cho = jung = jong = '';
    };

    const feed = raw => {
        const char = CONJOINING.get(raw) ?? raw;

        if (isConsonant(char)) {
            if (cho && jung && !jong) {
                if (isFinal(char)) {
                    jong = char;
                } else {
                    flush();
                    cho = char;
                }
            } else if (cho && jung && jong) {
                const combined = FINAL_COMPOUND[jong + char];

                if (combined) {
                    jong = combined;
                } else {
                    flush();
                    cho = char;
                }
            } else if (cho) {
                flush();
                cho = char;
            } else {
                cho = char;
            }

            return;
        }

        if (isVowel(char)) {
            if (cho && !jung) {
                jung = char;
            } else if (cho && jung && !jong) {
                const combined = MEDIAL_COMPOUND[jung + char];

                if (combined) {
                    jung = combined;
                } else {
                    flush();
                    jung = char;
                }
            } else if (cho && jung && jong) {
                const split = FINAL_SPLIT[jong];
                const kept = split ? split[0] : '';

                out += syllable(cho, jung, kept);
                cho = split ? split[1] : jong;
                jung = char;
                jong = '';
            } else {
                flush();
                jung = char;
            }

            return;
        }

        flush();
        out += char;
    };

    for (const char of text) {
        if (isSyllable(char)) {
            const parts = splitSyllable(char);

            feed(parts.cho);
            feed(parts.jung);
            if (parts.jong) feed(parts.jong);
        } else {
            feed(char);
        }
    }

    flush();

    return out;
}

/**
 * Steps a Hangul run back one composition state, for Backspace: a final
 * consonant is dropped (`한` -> `하`), then the vowel (`하` -> `ㅎ`), then the
 * standalone jamo is removed. Returns null when the run does not end in Hangul,
 * so the caller can fall back to deleting a character.
 */
export function backspaceHangul(text) {
    if (typeof text !== 'string' || !text) return null;

    const chars = [...text];
    const last = chars[chars.length - 1];

    if (isSyllable(last)) {
        const { cho, jung, jong } = splitSyllable(last);
        let replacement;

        if (jong) {
            const split = FINAL_SPLIT[jong];

            replacement = syllable(cho, jung, split ? split[0] : '');
        } else if (MEDIAL_SPLIT[jung]) {
            replacement = syllable(cho, MEDIAL_SPLIT[jung], '');
        } else {
            replacement = cho;
        }

        chars[chars.length - 1] = replacement;

        return chars.join('');
    }

    const char = CONJOINING.get(last) ?? last;

    if (isConsonant(char) || isVowel(char)) {
        chars.pop();

        return chars.join('');
    }

    return null;
}
