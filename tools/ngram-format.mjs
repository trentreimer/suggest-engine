import { NGRAM_MAGIC, NGRAM_VERSION, NGRAM_BIGRAM_SECTION, fnv1a } from '../src/ngrams.js';

export { fnv1a };

const MAX_WORD_ID = 0xffff;
const MAX_COUNT = 0xffff;
const SECTION_ENTRY_BYTES = 10;

function compareIds(a, b) {
    return a.id - b.id;
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

function normalizeContexts(contexts) {
    const seen = new Set();

    return contexts.map(context => {
        if (!Number.isInteger(context.id) || context.id < 0 || context.id > MAX_WORD_ID) {
            throw new Error(`Invalid bigram context id: ${context.id}`);
        }

        if (seen.has(context.id)) throw new Error(`Duplicate bigram context id: ${context.id}`);

        seen.add(context.id);

        const successors = context.successors
            .filter(successor => successor.count > 0)
            .sort((a, b) => b.count - a.count || a.id - b.id)
            .map(successor => {
                if (!Number.isInteger(successor.id) || successor.id < 0 || successor.id > MAX_WORD_ID) {
                    throw new Error(`Invalid bigram successor id: ${successor.id}`);
                }

                return { id: successor.id, count: Math.min(MAX_COUNT, successor.count) };
            });

        return { id: context.id, successors };
    }).sort(compareIds);
}

export function encodeNgramModel({ language, vocabHash, contexts = [] }) {
    const languageBytes = encodeLanguage(language);
    const normalized = normalizeContexts(contexts);
    const entryCount = normalized.reduce((total, context) => total + context.successors.length, 0);
    const contextBytes = normalized.length * 2;
    const padding = (normalized.length % 2) * 2;
    const offsetsBytes = (normalized.length + 1) * 4;
    const entriesBytes = entryCount * 4;
    const sectionLength = 8 + contextBytes + padding + offsetsBytes + entriesBytes;
    const headerLength = 13 + languageBytes.length + SECTION_ENTRY_BYTES;
    const sectionOffset = headerLength + ((4 - (headerLength % 4)) % 4);
    const buffer = new ArrayBuffer(sectionOffset + sectionLength);
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
    view.setUint16(cursor, 1, true);
    cursor += 2;

    view.setUint8(cursor, NGRAM_BIGRAM_SECTION);
    cursor += 2;
    view.setUint32(cursor, sectionOffset, true);
    cursor += 4;
    view.setUint32(cursor, sectionLength, true);

    let offset = sectionOffset;

    view.setUint32(offset, normalized.length, true);
    view.setUint32(offset + 4, entryCount, true);
    offset += 8;

    for (const context of normalized) {
        view.setUint16(offset, context.id, true);
        offset += 2;
    }

    offset += padding;

    let entry = 0;

    view.setUint32(offset, 0, true);
    offset += 4;

    for (const context of normalized) {
        entry += context.successors.length;
        view.setUint32(offset, entry, true);
        offset += 4;
    }

    for (const context of normalized) {
        for (const successor of context.successors) {
            view.setUint16(offset, successor.id, true);
            offset += 2;
        }
    }

    for (const context of normalized) {
        for (const successor of context.successors) {
            view.setUint16(offset, successor.count, true);
            offset += 2;
        }
    }

    return buffer;
}
