import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  decodeCandidates,
  discoverAuthKeys,
  extractAuthKeyFromBuffer,
  extractAuthKeyFromText,
  leveldbDirsUnder,
  maskKey,
  MISSING_KEY_HELP,
  resolveAuthKey,
} from '../src/auth.js';

const AUTH_KEY = 'tnR0cs1KR44AlxVuksEjX62kzQVvGmORTT4uwP5_61o=';
const PROFILE_JSON = JSON.stringify({ auth: { key: AUTH_KEY }, user: { email: 'user@example.com' } });

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-addon-order-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('extractAuthKeyFromText reads the profile blob shape', () => {
  assert.equal(extractAuthKeyFromText(PROFILE_JSON), AUTH_KEY);
  assert.equal(extractAuthKeyFromText('{"authKey":"abcDEF1234567890abcDEF1234567890"}'), 'abcDEF1234567890abcDEF1234567890');
  assert.equal(extractAuthKeyFromText('{"nothing":true}'), null);
});

test('extractAuthKeyFromBuffer handles the UTF-16LE storage used by Stremio', () => {
  const utf16 = Buffer.from(PROFILE_JSON, 'utf16le');
  assert.equal(extractAuthKeyFromBuffer(utf16), AUTH_KEY);
});

test('extractAuthKeyFromBuffer handles an odd byte offset', () => {
  const shifted = Buffer.concat([Buffer.from([0x00]), Buffer.from(PROFILE_JSON, 'utf16le')]);
  assert.equal(extractAuthKeyFromBuffer(shifted), AUTH_KEY);
});

test('extractAuthKeyFromBuffer reads plain UTF-8 JSON too', () => {
  assert.equal(extractAuthKeyFromBuffer(Buffer.from(PROFILE_JSON, 'utf8')), AUTH_KEY);
  assert.equal(extractAuthKeyFromBuffer(Buffer.from('garbage')), null);
});

test('decodeCandidates offers both encodings and both alignments', () => {
  assert.equal(decodeCandidates(Buffer.from('abc')).length, 4);
});

test('maskKey never reveals the whole key', () => {
  assert.equal(maskKey(AUTH_KEY), `${AUTH_KEY.slice(0, 4)}…${AUTH_KEY.slice(-4)}`);
  assert.ok(!maskKey(AUTH_KEY).includes(AUTH_KEY));
  assert.equal(maskKey(''), '');
});

test('leveldbDirsUnder finds Chromium and WebView2 layouts', (t) => {
  const root = tempDir(t);
  const chromium = path.join(root, 'Default', 'Local Storage', 'leveldb');
  const webview = path.join(root, 'App.exe.WebView2', 'EBWebView', 'Default', 'Local Storage', 'leveldb');
  fs.mkdirSync(chromium, { recursive: true });
  fs.mkdirSync(webview, { recursive: true });
  fs.mkdirSync(path.join(root, 'Unrelated'), { recursive: true });

  const found = leveldbDirsUnder(root);
  assert.equal(found.length, 2);
  assert.ok(found.includes(chromium));
  assert.ok(found.includes(webview));
});

test('leveldbDirsUnder tolerates a missing root', () => {
  assert.deepEqual(leveldbDirsUnder(path.join(os.tmpdir(), 'does-not-exist-xyz')), []);
});

test('discoverAuthKeys reads a real LevelDB-shaped store', (t) => {
  const root = tempDir(t);
  const leveldb = path.join(root, 'Default', 'Local Storage', 'leveldb');
  fs.mkdirSync(leveldb, { recursive: true });
  fs.writeFileSync(path.join(leveldb, '000003.log'), Buffer.from(PROFILE_JSON, 'utf16le'));

  const found = discoverAuthKeys({ roots: [root] });
  assert.equal(found.length, 1);
  assert.equal(found[0].key, AUTH_KEY);
  assert.match(found[0].source, /000003\.log$/);
});

test('discoverAuthKeys de-duplicates the same key in several files', (t) => {
  const root = tempDir(t);
  const leveldb = path.join(root, 'Default', 'Local Storage', 'leveldb');
  fs.mkdirSync(leveldb, { recursive: true });
  fs.writeFileSync(path.join(leveldb, 'a.log'), Buffer.from(PROFILE_JSON, 'utf16le'));
  fs.writeFileSync(path.join(leveldb, 'b.log'), Buffer.from(PROFILE_JSON, 'utf8'));

  assert.equal(discoverAuthKeys({ roots: [root] }).length, 1);
});

test('resolveAuthKey prefers an explicit key, then the environment, then discovery', () => {
  assert.deepEqual(resolveAuthKey({ explicit: 'explicit', env: { STREMIO_AUTH_KEY: 'env' }, discover: () => [] }), {
    key: 'explicit',
    source: '--key',
    alternatives: [],
  });

  assert.equal(
    resolveAuthKey({ env: { STREMIO_AUTH_KEY: 'env' }, discover: () => [] }).source,
    'STREMIO_AUTH_KEY',
  );

  const discovered = resolveAuthKey({
    env: {},
    discover: () => [{ key: 'found', source: '/tmp/x', mtimeMs: 1 }],
  });
  assert.equal(discovered.key, 'found');
  assert.equal(discovered.source, '/tmp/x');
});

test('resolveAuthKey surfaces alternatives instead of silently picking one', () => {
  const resolved = resolveAuthKey({
    env: {},
    discover: () => [
      { key: 'newest', source: '/tmp/new', mtimeMs: 20 },
      { key: 'older', source: '/tmp/old', mtimeMs: 10 },
    ],
  });
  assert.equal(resolved.key, 'newest');
  assert.deepEqual(resolved.alternatives, [{ key: 'older', source: '/tmp/old' }]);
});

test('resolveAuthKey explains how to find a key when discovery fails', () => {
  assert.throws(
    () => resolveAuthKey({ env: {}, discover: () => [] }),
    (error) => error.code === 'NO_AUTH_KEY' && error.message === MISSING_KEY_HELP,
  );
  assert.match(MISSING_KEY_HELP, /web\.stremio\.com/);
});
