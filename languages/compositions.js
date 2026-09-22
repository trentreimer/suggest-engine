export default {
    ja: { reading: 'kana', load: () => import('./ja.js') },
    zh: { reading: 'pinyin', load: () => import('./zh.js') },
};
