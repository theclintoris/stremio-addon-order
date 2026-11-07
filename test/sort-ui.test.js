import assert from 'node:assert/strict';
import test from 'node:test';

import { applyKey, createSortState, renderSort } from '../src/sort-ui.js';

const addons = ['A', 'B', 'C', 'D'].map((name) => ({ manifest: { name, id: name }, transportUrl: `https://${name}.example/manifest.json` }));

const stateNames = (state) => state.order.map((index) => addons[index].manifest.name).join('');

test('the sorter starts at the top with the original order', () => {
  const state = createSortState(addons);
  assert.deepEqual(state.order, [0, 1, 2, 3]);
  assert.equal(state.cursor, 0);
  assert.equal(state.grabbed, null);
});

test('cursor movement is clamped to the list', () => {
  const state = createSortState(addons);
  assert.equal(applyKey(state, 'up'), 'noop');
  assert.equal(state.cursor, 0);
  applyKey(state, 'down');
  applyKey(state, 'down');
  assert.equal(state.cursor, 2);
  applyKey(state, 'down');
  applyKey(state, 'down');
  assert.equal(state.cursor, 3);
});

test('picking up and dropping moves the item to the cursor', () => {
  const state = createSortState(addons);
  assert.equal(applyKey(state, 'space'), 'grab'); // pick A
  assert.equal(state.grabbed, 0);
  applyKey(state, 'down');
  applyKey(state, 'down'); // cursor on C
  assert.equal(applyKey(state, 'space'), 'drop');
  assert.equal(stateNames(state), 'BCAD');
  assert.equal(state.cursor, 2);
  assert.equal(state.grabbed, null);
});

test('dropping an item further up moves it backwards', () => {
  const state = createSortState(addons);
  applyKey(state, 'down');
  applyKey(state, 'down'); // cursor on C
  applyKey(state, 'space'); // pick C
  applyKey(state, 'up');
  applyKey(state, 'up'); // cursor on A
  applyKey(state, 'space'); // drop C at position 0
  assert.equal(stateNames(state), 'CABD');
});

test('dropping in place changes nothing', () => {
  const state = createSortState(addons);
  applyKey(state, 'space');
  applyKey(state, 'space');
  assert.equal(stateNames(state), 'ABCD');
});

test('r restores the original order', () => {
  const state = createSortState(addons);
  applyKey(state, 'space');
  applyKey(state, 'down');
  applyKey(state, 'space');
  assert.notEqual(stateNames(state), 'ABCD');
  applyKey(state, 'r');
  assert.equal(stateNames(state), 'ABCD');
  assert.equal(state.cursor, 0);
});

test('save, quit and ctrl-c report their intent', () => {
  const state = createSortState(addons);
  assert.equal(applyKey(state, 's'), 'save');
  assert.equal(applyKey(state, 'q'), 'quit');
  assert.equal(applyKey(state, 'escape'), 'quit');
  assert.equal(applyKey(state, 'ctrl-c'), 'quit');
  assert.equal(applyKey(state, 'z'), 'noop');
});

test('renderSort marks the cursor, the held item and the numbering', () => {
  const state = createSortState(addons);
  applyKey(state, 'space');
  applyKey(state, 'down');

  const rendered = renderSort({ addons, state, columns: 80 });
  assert.match(rendered, /SORT ADD-ONS/);
  assert.match(rendered, /\*\s+1\s+A/);
  assert.match(rendered, />\s+2\s+B/);
  assert.match(rendered, /Holding "A"/);
  assert.match(rendered, /3\s+C/);
});

test('renderSort shows the idle hint when nothing is held', () => {
  const state = createSortState(addons);
  const rendered = renderSort({ addons, state, columns: 80 });
  assert.match(rendered, /Press space to pick up/);
});
