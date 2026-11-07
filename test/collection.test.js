import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addonHost,
  addonId,
  addonKey,
  addonName,
  applyOrder,
  isCollection,
  moveAddon,
  resolveRef,
  sameOrder,
} from '../src/collection.js';

const makeAddon = (name, id) => ({
  transportUrl: `https://${id}.example/manifest.json`,
  transportName: '',
  manifest: { id, name },
  flags: { official: false },
});

const sample = [
  makeAddon('Cinemeta', 'com.linvo.cinemeta'),
  makeAddon('Streaming Catalogs', 'pw.ers.netflix-catalog'),
  makeAddon('Sports Streams', 'community.sports.fly'),
  makeAddon('Torrentio TB', 'com.stremio.torrentio.addon'),
];

const names = (addons) => addons.map(addonName);

test('addonName falls back to the transport URL', () => {
  assert.equal(addonName({ transportUrl: 'https://x.example/manifest.json' }), 'https://x.example/manifest.json');
  assert.equal(addonName({ manifest: { name: '  Trimmed  ' } }), 'Trimmed');
});

test('addonHost and addonId handle malformed input', () => {
  assert.equal(addonHost({ transportUrl: 'not a url' }), '');
  assert.equal(addonHost(sample[0]), 'com.linvo.cinemeta.example');
  assert.equal(addonId({}), '');
});

test('resolveRef accepts a 1-based position', () => {
  assert.equal(resolveRef(sample, '3'), 2);
  assert.equal(resolveRef(sample, 1), 0);
});

test('resolveRef rejects out-of-range positions', () => {
  assert.throws(() => resolveRef(sample, '9'), /out of range/);
  assert.throws(() => resolveRef(sample, '0'), /out of range/);
});

test('resolveRef matches names case-insensitively and by id', () => {
  assert.equal(resolveRef(sample, 'sports streams'), 2);
  assert.equal(resolveRef(sample, 'com.stremio.torrentio.addon'), 3);
});

test('resolveRef matches a unique fragment', () => {
  assert.equal(resolveRef(sample, 'sports'), 2);
});

test('resolveRef reports ambiguity instead of guessing', () => {
  const ambiguous = [...sample, makeAddon('Sports Replays', 'com.example.replays')];
  assert.throws(() => resolveRef(ambiguous, 'sports'), /matches more than one/);
});

test('resolveRef reports unknown add-ons', () => {
  assert.throws(() => resolveRef(sample, 'nope'), /No add-on matches/);
});

test('moveAddon moves forward and backward', () => {
  assert.deepEqual(names(moveAddon(sample, 2, 1, 'before')), [
    'Cinemeta',
    'Sports Streams',
    'Streaming Catalogs',
    'Torrentio TB',
  ]);
  assert.deepEqual(names(moveAddon(sample, 0, 3, 'after')), [
    'Streaming Catalogs',
    'Sports Streams',
    'Torrentio TB',
    'Cinemeta',
  ]);
});

test('moveAddon does not mutate the input', () => {
  const copy = sample.slice();
  moveAddon(sample, 0, 2, 'after');
  assert.deepEqual(sample, copy);
});

test('moveAddon is a no-op for identical positions', () => {
  assert.deepEqual(names(moveAddon(sample, 1, 1, 'before')), names(sample));
});

test('moveAddon rejects an unknown position', () => {
  assert.throws(() => moveAddon(sample, 0, 1, 'sideways'), /before.*after/);
});

test('applyOrder validates permutations', () => {
  assert.deepEqual(names(applyOrder(sample, [3, 2, 1, 0])), names(sample).reverse());
  assert.throws(() => applyOrder(sample, [0, 1, 2]), /entries/);
  assert.throws(() => applyOrder(sample, [0, 0, 1, 2]), /permutation/);
  assert.throws(() => applyOrder(sample, [0, 1, 2, 99]), /permutation/);
});

test('sameOrder compares identity, not object references', () => {
  const clone = JSON.parse(JSON.stringify(sample));
  assert.ok(sameOrder(sample, clone));
  assert.ok(!sameOrder(sample, moveAddon(sample, 0, 1, 'after')));
});

test('addonKey is stable across serialisation', () => {
  const clone = JSON.parse(JSON.stringify(sample[0]));
  assert.equal(addonKey(sample[0]), addonKey(clone));
});

test('isCollection rejects junk', () => {
  assert.ok(isCollection(sample));
  assert.ok(!isCollection(null));
  assert.ok(!isCollection([{ manifest: {} }]));
  assert.ok(!isCollection([{ transportUrl: 'x' }]));
});
