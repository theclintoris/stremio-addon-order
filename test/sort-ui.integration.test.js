import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { runSortUi } from '../src/sort-ui.js';

/**
 * Drive the sorter through a fake TTY: real keypress parsing, real rendering,
 * no terminal required. This is the closest thing to pressing the keys.
 */
function fakeTerminal() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdin.isTTY = true;
  stdout.isTTY = true;
  stdout.columns = 80;
  stdin.setRawMode = () => stdin;
  stdout.text = () => stdout.read()?.toString() ?? '';
  return { stdin, stdout };
}

const addons = ['A', 'B', 'C'].map((name) => ({
  transportUrl: `https://${name}.example/manifest.json`,
  manifest: { name, id: name },
}));

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('the sorter saves a rearranged order from real key presses', async (t) => {
  const previousTerm = process.env.TERM;
  process.env.TERM = 'xterm';
  t.after(() => {
    if (previousTerm === undefined) delete process.env.TERM;
    else process.env.TERM = previousTerm;
  });

  const { stdin, stdout } = fakeTerminal();
  const run = runSortUi({ addons, stdin, stdout });

  await tick();
  stdin.write('\x1b[B'); // down  -> B
  await tick();
  stdin.write(' '); // pick up B
  await tick();
  stdin.write('\x1b[B'); // down  -> C
  await tick();
  stdin.write(' '); // drop B after C
  await tick();
  stdin.write('s'); // save

  const result = await run;
  assert.equal(result.action, 'save');
  assert.deepEqual(result.order, [0, 2, 1]);
});

test('q leaves the sorter without a payload', async (t) => {
  const previousTerm = process.env.TERM;
  process.env.TERM = 'xterm';
  t.after(() => {
    if (previousTerm === undefined) delete process.env.TERM;
    else process.env.TERM = previousTerm;
  });

  const { stdin, stdout } = fakeTerminal();
  const run = runSortUi({ addons, stdin, stdout });

  await tick();
  stdin.write('q');

  assert.deepEqual(await run, { action: 'quit' });
});

test('saving an untouched list reports that nothing changed', async (t) => {
  const previousTerm = process.env.TERM;
  process.env.TERM = 'xterm';
  t.after(() => {
    if (previousTerm === undefined) delete process.env.TERM;
    else process.env.TERM = previousTerm;
  });

  const { stdin, stdout } = fakeTerminal();
  const run = runSortUi({ addons, stdin, stdout });

  await tick();
  stdin.write('s');

  assert.deepEqual(await run, { action: 'quit', unchanged: true });
});

test('the sorter refuses to run without a terminal', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  await assert.rejects(() => runSortUi({ addons, stdin, stdout }), /needs a terminal/);
});
