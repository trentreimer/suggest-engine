// Sentence-ending punctuation per language, used to decide whether a caret
// position starts a sentence (auto-capitalization and next-word suppression).
// Languages not listed use the default `['.', '?', '!']`.
export const defaultSentenceTerminators = ['.', '?', '!'];

export default {
    ar: ['.', '؟', '!'],
    fa: ['.', '؟', '!'],
    ps: ['.', '؟', '!'],
    sd: ['.', '؟', '!'],
    ckb: ['.', '؟', '!'],
    ur: ['.', '؟', '!', '۔'],
    bn: ['।', '.', '?', '!'],
    hi: ['।', '.', '?', '!'],
    mr: ['।', '.', '?', '!'],
    pa: ['।', '.', '?', '!'],
    ne: ['।', '.', '?', '!'],
    as: ['।', '.', '?', '!'],
    or: ['।', '.', '?', '!'],
    zh: ['。', '！', '？', '.'],
    ja: ['。', '！', '？', '.'],
    ko: ['.', '?', '!', '。'],
    am: ['።', '፧', '.', '?', '!'],
    hye: ['։', '.', '?', '!'],
};
