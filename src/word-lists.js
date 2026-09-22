export function parseWordList(text, extraChars = '') {
    const words = [];

    if (typeof text !== 'string') return words;

    const truncation = new RegExp(`[^\\p{L}\\p{M}\\p{N}'\\-${escapeForCharacterClass(extraChars)}].*$`, 'u');

    for (const line of text.split('\n')) {
        const word = line.trim().replaceAll('ʼ', '\'').replaceAll('’', '\'').replace(truncation, '');

        if (word.length > 1) words.push(word);
    }

    return words;
}

export async function resolveWordList(source, extraChars = '') {
    if (Array.isArray(source)) return dedupe(parseWordList(source.join('\n'), extraChars));

    if (source && typeof source === 'object' && typeof source.text === 'string') {
        return dedupe(parseWordList(source.text, extraChars));
    }

    if (typeof source === 'string') {
        const response = await fetch(source);

        if (!response.ok) throw new Error(`Unable to fetch ${source}`);

        return dedupe(parseWordList(await response.text(), extraChars));
    }

    throw new TypeError('Unsupported word list source');
}

export function escapeForCharacterClass(chars) {
    return chars.replace(/[\\\]\^-]/g, '\\$&');
}

function dedupe(words) {
    return [...new Set(words)];
}
