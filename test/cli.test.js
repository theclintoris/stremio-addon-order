import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { parseArgs, VERSION } from '../src/cli.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the CLI version matches package.json', () => {
  assert.equal(VERSION, pkg.version);
});

test('no arguments defaults to list', () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.command, 'list');
  assert.deepEqual(parsed.args, []);
});

test('parses a move command with quoted names', () => {
  const parsed = parseArgs(['move', 'Sports Streams', 'before', 'Streaming Catalogs']);
  assert.equal(parsed.command, 'move');
  assert.deepEqual(parsed.args, ['Sports Streams', 'before', 'Streaming Catalogs']);
  assert.equal(parsed.flags.dryRun, false);
});

test('parses boolean flags anywhere on the line', () => {
  const parsed = parseArgs(['move', '1', 'after', '2', '--dry-run', '--json']);
  assert.equal(parsed.flags.dryRun, true);
  assert.equal(parsed.flags.json, true);
});

test('parses --key with a space and with an equals sign', () => {
  assert.equal(parseArgs(['list', '--key', 'abc123']).flags.key, 'abc123');
  assert.equal(parseArgs(['list', '--key=abc123']).flags.key, 'abc123');
});

test('supports short aliases', () => {
  assert.equal(parseArgs(['-h']).flags.help, true);
  assert.equal(parseArgs(['-v']).flags.version, true);
  assert.equal(parseArgs(['restore', 'x.json', '-y']).flags.yes, true);
});

test('rejects unknown options and missing values', () => {
  assert.throws(() => parseArgs(['list', '--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['list', '--key']), /needs a value/);
  assert.throws(() => parseArgs(['list', '--dry-run=yes']), /does not take a value/);
});

test('treats a positional that starts with a dash after -- as an argument', () => {
  assert.deepEqual(parseArgs(['restore', '--', '-weird-file.json']).args, ['-weird-file.json']);
});
