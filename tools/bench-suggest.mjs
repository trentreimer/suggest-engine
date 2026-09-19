import { SuggestEngine } from '../src/engine.js';
import { NgramModel, fnv1a } from '../src/ngrams.js';
import { encodeNgramModel } from './ngram-format.mjs';

const vocabularySize = 10000;
const contextCount = 5000;
const successorsPerContext = 8;
const warmup = 2000;
const iterations = 50000;

const words = [];

for (let i = 0; i < vocabularySize; i ++) words.push(`w${i.toString(36)}xx`);

const contexts = [];

for (let id = 0; id < contextCount; id ++) {
    const successors = [];

    for (let j = 0; j < successorsPerContext; j ++) {
        successors.push({ id: (id + j + 1) % vocabularySize, count: successorsPerContext - j });
    }

    contexts.push({ id, successors });
}

const buffer = encodeNgramModel({ language: 'en', vocabHash: fnv1a(words.join('\n')), contexts });

console.log(`vocabulary: ${vocabularySize} words, model: ${contextCount} contexts, ${(buffer.byteLength / 1024).toFixed(0)} KB`);

const engine = new SuggestEngine({ language: 'en', maxSuggestions: 5 });

await engine.addWordList('bundled', words);
await engine.addNgramModel(new NgramModel(buffer));

const contextWord = words[0];
const contextText = `${contextWord} `;

function bench(label, fn) {
    for (let i = 0; i < warmup; i ++) fn(i);

    const start = process.hrtime.bigint();

    for (let i = 0; i < iterations; i ++) fn(i);

    const elapsed = Number(process.hrtime.bigint() - start);

    console.log(`${label.padEnd(34)} ${(elapsed / iterations).toFixed(0).padStart(6)} ns/call  (${(iterations / (elapsed / 1e9) / 1000).toFixed(0)}k calls/s)`);
}

bench('suggest("w") no context', () => engine.suggest('w'));
bench('suggest("w8") no context', () => engine.suggest('w8'));
bench(`suggest("w", "${contextWord} ")`, () => engine.suggest('w', contextText));
bench('suggestAt end of text', () => engine.suggestAt(`foo ${contextText}w`, 4 + contextText.length + 1));
bench('nextWords', () => engine.nextWords(contextText));
