import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('README CDN example URLs match the package version', () => {
    const urls = [...readme.matchAll(/cdn\.jsdelivr\.net\/gh\/trentreimer\/suggest-engine@(v\d+\.\d+\.\d+)/g)];

    assert.ok(urls.length > 0, 'README has no versioned jsDelivr example URLs to check');
    for (const [, tag] of urls) {
        assert.equal(tag, `v${version}`, `README CDN example URL uses ${tag}; update it to v${version} when bumping the version`);
    }
});
