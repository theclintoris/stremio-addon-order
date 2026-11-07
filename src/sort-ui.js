/**
 * Interactive terminal sorter.
 *
 * Keeps all terminal handling in one place; the state machine (`applyKey`,
 * `renderSort`) is pure so it can be unit tested without a TTY.
 */

import readline from 'node:readline';

import { addonName } from './collection.js';
import { truncate } from './table.js';

export function createSortState(addons) {
  return {
    order: addons.map((_, index) => index),
    cursor: 0,
    grabbed: null,
  };
}

function moveWithin(order, from, to) {
  const next = order.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Apply one key to the state.
 * @returns {'noop'|'grab'|'drop'|'save'|'quit'|'reset'}
 */
export function applyKey(state, key) {
  const total = state.order.length;

  switch (key) {
    case 'up':
    case 'k':
      state.cursor = Math.max(0, state.cursor - 1);
      return 'noop';

    case 'down':
    case 'j':
      state.cursor = Math.min(total - 1, state.cursor + 1);
      return 'noop';

    case 'space': {
      if (state.grabbed === null) {
        state.grabbed = state.cursor;
        return 'grab';
      }
      const from = state.grabbed;
      const to = state.cursor;
      state.order = moveWithin(state.order, from, to);
      state.grabbed = null;
      state.cursor = to;
      return 'drop';
    }

    case 'r':
      state.order = Array.from({ length: total }, (_, index) => index);
      state.cursor = 0;
      state.grabbed = null;
      return 'reset';

    case 's':
      return 'save';

    case 'q':
    case 'escape':
    case 'ctrl-c':
      return 'quit';

    default:
      return 'noop';
  }
}

const HEADER = 'SORT ADD-ONS';
const HINTS = '↑/↓ move · space pick up / drop · s save · r reset · q quit';

export function renderSort({ addons, state, columns = 80 }) {
  const names = addons.map((addon) => addonName(addon));
  const width = Math.max(12, Math.min(columns || 80, 100) - 8);

  const lines = [HEADER, HINTS, ''];

  state.order.forEach((addonIndex, position) => {
    const cursorMark = position === state.cursor ? '>' : ' ';
    const heldMark = state.grabbed === position ? '*' : ' ';
    const number = String(position + 1).padStart(2);
    lines.push(`${cursorMark}${heldMark} ${number}  ${truncate(names[addonIndex], width)}`);
  });

  lines.push('');
  if (state.grabbed !== null) {
    lines.push(`Holding "${names[state.order[state.grabbed]]}" — move and press space to drop`);
  } else {
    lines.push('Press space to pick up the highlighted add-on.');
  }
  return lines.join('\n');
}

/**
 * Run the sorter until the user saves or quits.
 *
 * @returns {Promise<{ action: 'save'|'quit', order?: number[] }>}
 */
export async function runSortUi({ addons, stdin = process.stdin, stdout = process.stdout }) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(
      'Interactive sorting needs a terminal. Try "stremio-addon-order sort" in a normal terminal window,\n' +
        'or use "stremio-addon-order move <add-on> before|after <add-on>" instead.',
    );
  }
  if (process.env.TERM === 'dumb') {
    throw new Error('This terminal (TERM=dumb) cannot run the interactive sorter. Use "move" instead.');
  }

  const state = createSortState(addons);
  const columns = stdout.columns || 80;

  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();

  let finished = false;
  const write = (text) => stdout.write(text);
  const cleanup = () => {
    try {
      stdin.setRawMode(false);
    } catch {
      // Terminal already gone; nothing to restore.
    }
    stdin.pause();
    write('\x1b[?1049l');
  };

  const draw = () => write(`\x1b[H\x1b[2J${renderSort({ addons, state, columns })}\n`);

  write('\x1b[?1049h');

  try {
    return await new Promise((resolve) => {
      const finish = (value) => {
        if (finished) return;
        finished = true;
        stdin.removeListener('keypress', onKeypress);
        cleanup();
        resolve(value);
      };

      const onKeypress = (sequence, key) => {
        let pressed = key?.name ?? sequence;
        if (key?.ctrl && key.name === 'c') pressed = 'ctrl-c';
        if (pressed === 'space' || sequence === ' ') pressed = 'space';

        const action = applyKey(state, pressed);

        if (action === 'quit') return finish({ action: 'quit' });
        if (action === 'save') {
          const unchanged = state.order.every((value, index) => value === index);
          return finish(unchanged ? { action: 'quit', unchanged: true } : { action: 'save', order: state.order });
        }
        return draw();
      };

      stdin.on('keypress', onKeypress);
      draw();
    });
  } finally {
    if (!finished) cleanup();
  }
}
