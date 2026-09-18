export function parseWordList(text) {
    const words = [];

    if (typeof text !== 'string') return words;

    for (const line of text.split('\n')) {
        const word = line.trim().replaceAll('ʼ', '\'').replaceAll('’', '\'').replace(/[^\p{L}\p{M}\p{N}'\-].*$/u, '');

        if (word.length > 1) words.push(word);
    }

    return words;
}

export async function resolveWordList(source) {
    if (Array.isArray(source)) return dedupe(parseWordList(source.join('\n')));

    if (source && typeof source === 'object' && typeof source.text === 'string') {
        return dedupe(parseWordList(source.text));
    }

    if (typeof source === 'string') {
        const response = await fetch(source);

        if (!response.ok) throw new Error(`Unable to fetch ${source}`);

        return dedupe(parseWordList(await response.text()));
    }

    throw new TypeError('Unsupported word list source');
}

function dedupe(words) {
    return [...new Set(words)];
}
