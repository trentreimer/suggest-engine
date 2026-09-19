import { NGRAM_MAGIC, NGRAM_VERSION, NGRAM_BIGRAM_SECTION, NGRAM_TRIGRAM_SECTION, fnv1a } from '../src/ngrams.js';

export { fnv1a };

const MAX_WORD_ID = 0xffff;
const MAX_COUNT = 0xffff;
const SECTION_ENTRY_BYTES = 10;

function compareIds(a, b) {
    return a.id - b.id;
}

function align4(value) {
    return value + ((4 - (value % 4)) % 4);
}

function encodeLanguage(language) {
    const text = String(language ?? '').toLowerCase();
    const bytes = [];

    for (const char of text) {
        const code = char.charCodeAt(0);

        if (code > 0x7f) throw new Error(`Language code must be ASCII: ${text}`);

        bytes.push(code);
    }

    if (!bytes.length || bytes.length > 255) throw new Error(`Invalid language code: ${text}`);

    return bytes;
}

function validateId(id, label) {
    if (!Number.isInteger(id) || id < 0 || id > MAX_WORD_ID) throw new Error(`Invalid ${label} id: ${id}`);

    return id;
}

function normalizeSuccessors(successors) {
    return successors
        .filter(successor => successor.count > 0)
        .sort((a, b) => b.count - a.count || a.id - b.id)
        .map(successor => ({ id: validateId(successor.id, 'successor'), count: Math.min(MAX_COUNT, successor.count) }));
}

function normalizeContexts(contexts) {
    const seen = new Set();

    return contexts.map(context => {
        const id = validateId(context.id, 'bigram context');

        if (seen.has(id)) throw new Error(`Duplicate bigram context id: ${id}`);

        seen.add(id);

        return { id, successors: normalizeSuccessors(context.successors) };
    }).sort(compareIds);
}

function normalizeTrigramContexts(contexts) {
    const seen = new Set();

    return contexts.map(context => {
        const first = validateId(context.a, 'trigram context');
        const second = validateId(context.b, 'trigram context');
        const key = first * (MAX_WORD_ID + 1) + second;

        if (seen.has(key)) throw new Error(`Duplicate trigram context: ${first}, ${second}`);

        seen.add(key);

        return { a: first, b: second, successors: normalizeSuccessors(context.successors) };
    }).sort((x, y) => x.a - y.a || x.b - y.b);
}

function bigramSectionLength(contexts, entryCount) {
    return 8 + contexts.length * 2 + (contexts.length % 2) * 2 + (contexts.length + 1) * 4 + entryCount * 4;
}

function trigramSectionLength(contexts, entryCount) {
    return 8 + contexts.length * 4 + (contexts.length + 1) * 4 + entryCount * 4;
}

export function encodeNgramModel({ language, vocabHash, contexts = [], trigramContexts = [] }) {
    const languageBytes = encodeLanguage(language);
    const bigrams = normalizeContexts(contexts);
    const trigrams = normalizeTrigramContexts(trigramContexts);
    const bigramEntries = bigrams.reduce((total, context) => total + context.successors.length, 0);
    const trigramEntries = trigrams.reduce((total, context) => total + context.successors.length, 0);
    const bigramLength = bigramSectionLength(bigrams, bigramEntries);
    const trigramLength = trigrams.length ? trigramSectionLength(trigrams, trigramEntries) : 0;
    const sectionCount = trigrams.length ? 2 : 1;
    const headerLength = 13 + languageBytes.length + sectionCount * SECTION_ENTRY_BYTES;
    const bigramOffset = align4(headerLength);
    const trigramOffset = trigrams.length ? align4(bigramOffset + bigramLength) : 0;
    const total = trigrams.length ? trigramOffset + trigramLength : bigramOffset + bigramLength;
    const buffer = new ArrayBuffer(total);
    const view = new DataView(buffer);
    let cursor = 0;

    view.setUint32(cursor, NGRAM_MAGIC, true);
    cursor += 4;
    view.setUint16(cursor, NGRAM_VERSION, true);
    cursor += 2;
    view.setUint8(cursor, languageBytes.length);
    cursor += 1;

    for (const byte of languageBytes) view.setUint8(cursor ++, byte);

    view.setUint32(cursor, vocabHash >>> 0, true);
    cursor += 4;
    view.setUint16(cursor, sectionCount, true);
    cursor += 2;

    view.setUint8(cursor, NGRAM_BIGRAM_SECTION);
    cursor += 2;
    view.setUint32(cursor, bigramOffset, true);
    cursor += 4;
    view.setUint32(cursor, bigramLength, true);
    cursor += 4;

    if (trigrams.length) {
        view.setUint8(cursor, NGRAM_TRIGRAM_SECTION);
        cursor += 2;
        view.setUint32(cursor, trigramOffset, true);
        cursor += 4;
        view.setUint32(cursor, trigramLength, true);
    }

    let offset = bigramOffset;

    view.setUint32(offset, bigrams.length, true);
    view.setUint32(offset + 4, bigramEntries, true);
    offset += 8;

    for (const context of bigrams) {
        view.setUint16(offset, context.id, true);
        offset += 2;
    }

    offset += (bigrams.length % 2) * 2;

    let entry = 0;

    view.setUint32(offset, 0, true);
    offset += 4;

    for (const context of bigrams) {
        entry += context.successors.length;
        view.setUint32(offset, entry, true);
        offset += 4;
    }

    for (const context of bigrams) {
        for (const successor of context.successors) {
            view.setUint16(offset, successor.id, true);
            offset += 2;
        }
    }

    for (const context of bigrams) {
        for (const successor of context.successors) {
            view.setUint16(offset, successor.count, true);
            offset += 2;
        }
    }

    if (!trigrams.length) return buffer;

    offset = trigramOffset;

    view.setUint32(offset, trigrams.length, true);
    view.setUint32(offset + 4, trigramEntries, true);
    offset += 8;

    for (const context of trigrams) {
        view.setUint16(offset, context.a, true);
        view.setUint16(offset + 2, context.b, true);
        offset += 4;
    }

    entry = 0;

    view.setUint32(offset, 0, true);
    offset += 4;

    for (const context of trigrams) {
        entry += context.successors.length;
        view.setUint32(offset, entry, true);
        offset += 4;
    }

    for (const context of trigrams) {
        for (const successor of context.successors) {
            view.setUint16(offset, successor.id, true);
            offset += 2;
        }
    }

    for (const context of trigrams) {
        for (const successor of context.successors) {
            view.setUint16(offset, successor.count, true);
            offset += 2;
        }
    }

    return buffer;
}
