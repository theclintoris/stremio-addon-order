import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTable, truncate } from '../src/table.js';

const addon = (name, id) => ({
  transportUrl: `https://${id}.example/manifest.json`,
  manifest: { id, name },
  flags: {},
});

const sample = [
  addon('Cinemeta', 'com.linvo.cinemeta'),
  addon('Streaming Catalogs', 'pw.ers.netflix-catalog'),
  addon('Sports Streams', 'community.sports.fly'),
];

test('truncate keeps short strings and shortens long ones', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.equal(truncate('abcdefghij', 5), 'abcd…');
  assert.equal(truncate('abcdef', 0), '');
  assert.equal(truncate('abcdef', 1), '…');
});

test('truncate counts code points, not UTF-16 units', () => {
  assert.equal(truncate('🎬🎬🎬🎬🎬', 3), '🎬🎬…');
});

test('formatTable numbers rows from 1 and keeps names readable', () => {
  const table = formatTable(sample, { columns: 100 });
  const lines = table.split('\n');
  assert.match(lines[0], /ADD-ON/);
  assert.match(lines[0], /ID/);
  assert.match(lines[0], /HOST/);
  assert.match(lines[2], /^\s*1\s+Cinemeta/);
  assert.match(lines[3], /^\s*2\s+Streaming Catalogs/);
  assert.equal(lines.length, 2 + sample.length);
});

test('formatTable stays within the requested width', () => {
  const narrow = formatTable(sample, { columns: 60 });
  for (const line of narrow.split('\n')) {
    assert.ok(line.length <= 60, `line too long: ${JSON.stringify(line)}`);
  }
});

test('formatTable hides the host column when there is no room', () => {
  const narrow = formatTable(sample, { columns: 50 });
  assert.doesNotMatch(narrow.split('\n')[0], /HOST/);
});

test('formatTable handles an empty collection', () => {
  const table = formatTable([], { columns: 100 });
  assert.equal(table.split('\n').length, 2);
});
