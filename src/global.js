import { SuggestEngine, UserWords, parseWordList, resolveWordList } from './index.js';

Object.assign(SuggestEngine, { UserWords, parseWordList, resolveWordList });

globalThis.SuggestEngine = SuggestEngine;
