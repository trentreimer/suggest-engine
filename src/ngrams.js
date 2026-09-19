export const NGRAM_MAGIC = 0x474e4553;
export const NGRAM_VERSION = 1;
export const NGRAM_BIGRAM_SECTION = 1;

const SECTION_ENTRY_BYTES = 10;

export function fnv1a(text) {
    let hash = 0x811c9dc5;

    for (let i = 0; i < text.length; i ++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return hash >>> 0;
}

export class NgramModel {
    constructor(buffer) {
        if (ArrayBuffer.isView(buffer)) {
            buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        }

        if (!(buffer instanceof ArrayBuffer)) throw new TypeError('NgramModel expects an ArrayBuffer');

        this.buffer = buffer;
        this.language = '';
        this.vocabHash = 0;
        this.contextCount = 0;
        this.entryCount = 0;
        this.contexts = null;
        this.offsets = null;
        this.successorIds = null;
        this.counts = null;

        this.parseHeader();
        this.parseSections();
    }

    parseHeader() {
        if (this.buffer.byteLength < 19) throw new Error('Invalid ngram model: truncated header');

        const view = new DataView(this.buffer);

        if (view.getUint32(0, true) !== NGRAM_MAGIC) throw new Error('Invalid ngram model: bad magic');

        const version = view.getUint16(4, true);

        if (version !== NGRAM_VERSION) throw new Error(`Unsupported ngram model version: ${version}`);

        const languageLength = view.getUint8(6);
        let cursor = 7;

        if (cursor + languageLength + 6 > this.buffer.byteLength) throw new Error('Invalid ngram model: truncated header');

        let language = '';

        for (let i = 0; i < languageLength; i ++) language += String.fromCharCode(view.getUint8(cursor + i));

        cursor += languageLength;
        this.language = language;
        this.vocabHash = view.getUint32(cursor, true);
        this.sectionTableOffset = cursor + 6;
        this.sectionCount = view.getUint16(cursor + 4, true);
    }

    parseSections() {
        const view = new DataView(this.buffer);
        const tableEnd = this.sectionTableOffset + this.sectionCount * SECTION_ENTRY_BYTES;

        if (tableEnd > this.buffer.byteLength) throw new Error('Invalid ngram model: truncated section table');

        for (let i = 0; i < this.sectionCount; i ++) {
            const entry = this.sectionTableOffset + i * SECTION_ENTRY_BYTES;
            const id = view.getUint8(entry);
            const offset = view.getUint32(entry + 2, true);
            const length = view.getUint32(entry + 6, true);

            if (offset % 4 !== 0 || offset + length > this.buffer.byteLength) {
                throw new Error('Invalid ngram model: section out of bounds');
            }

            if (id === NGRAM_BIGRAM_SECTION) this.parseBigramSection(offset, length);
        }
    }

    parseBigramSection(offset, length) {
        if (length < 8) throw new Error('Invalid ngram model: truncated bigram section');

        const view = new DataView(this.buffer);
        const contextCount = view.getUint32(offset, true);
        const entryCount = view.getUint32(offset + 4, true);
        const contextsStart = offset + 8;
        const offsetsStart = contextsStart + contextCount * 2 + (contextCount % 2) * 2;
        const successorsStart = offsetsStart + (contextCount + 1) * 4;
        const countsStart = successorsStart + entryCount * 2;

        if (countsStart + entryCount * 2 > offset + length) throw new Error('Invalid ngram model: truncated bigram section');

        this.contextCount = contextCount;
        this.entryCount = entryCount;
        this.contexts = new Uint16Array(this.buffer, contextsStart, contextCount);
        this.offsets = new Uint32Array(this.buffer, offsetsStart, contextCount + 1);
        this.successorIds = new Uint16Array(this.buffer, successorsStart, entryCount);
        this.counts = new Uint16Array(this.buffer, countsStart, entryCount);
    }

    bigram(id) {
        const contexts = this.contexts;

        if (!contexts || !Number.isInteger(id)) return null;

        let low = 0;
        let high = contexts.length - 1;

        while (low <= high) {
            const mid = (low + high) >> 1;
            const value = contexts[mid];

            if (value === id) {
                const start = this.offsets[mid];
                const end = this.offsets[mid + 1];

                return { ids: this.successorIds.subarray(start, end), counts: this.counts.subarray(start, end) };
            }

            if (value < id) low = mid + 1;
            else high = mid - 1;
        }

        return null;
    }
}
