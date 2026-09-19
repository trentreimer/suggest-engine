import { SuggestEngine, UserWords, NgramModel, parseWordList, resolveWordList } from './index.js';

Object.assign(SuggestEngine, { UserWords, NgramModel, parseWordList, resolveWordList });

globalThis.SuggestEngine = SuggestEngine;
