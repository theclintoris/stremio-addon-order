/**
 * Plain-text rendering of an add-on collection.
 * No colours, no dependencies — it has to look right in every terminal.
 */

import { addonHost, addonId, addonName } from './collection.js';

/** Truncate to at most `max` characters (code points), with an ellipsis. */
export function truncate(text, max) {
  if (max <= 0) return '';
  const chars = [...text];
  if (chars.length <= max) return text;
  if (max === 1) return '…';
  return chars.slice(0, max - 1).join('') + '…';
}

function pad(text, width) {
  const value = truncate(text, width);
  const missing = width - [...value].length;
  return missing > 0 ? value + ' '.repeat(missing) : value;
}

/**
 * @param {object[]} addons
 * @param {{ columns?: number, showHost?: boolean }} [options]
 */
export function formatTable(addons, options = {}) {
  const { columns = 100 } = options;
  const showHost = options.showHost ?? columns >= 70;

  const rows = addons.map((addon, index) => ({
    position: String(index + 1),
    name: addonName(addon),
    id: addonId(addon) || '—',
    host: addonHost(addon),
  }));

  const longest = (pick) => Math.max(...rows.map((row) => [...pick(row)].length), 0);
  let nameWidth = Math.max(10, Math.min(38, longest((row) => row.name)));
  let idWidth = Math.max(6, Math.min(34, longest((row) => row.id)));
  let hostWidth = Math.max(6, Math.min(24, longest((row) => row.host)));

  const gaps = showHost ? 6 : 4;
  const total = () => 3 + nameWidth + idWidth + (showHost ? hostWidth : 0) + gaps;

  while (total() > columns && nameWidth > 12) nameWidth -= 1;
  while (total() > columns && idWidth > 8) idWidth -= 1;
  while (total() > columns && hostWidth > 6) hostWidth -= 1;

  const header = showHost
    ? `${pad('#', 3)}  ${pad('ADD-ON', nameWidth)}  ${pad('ID', idWidth)}  ${pad('HOST', hostWidth)}`
    : `${pad('#', 3)}  ${pad('ADD-ON', nameWidth)}  ${pad('ID', idWidth)}`;

  const lines = [header, '-'.repeat([...header].length)];
  for (const row of rows) {
    const cells = [
      pad(row.position, 3),
      pad(row.name, nameWidth),
      pad(row.id, idWidth),
    ];
    if (showHost) cells.push(pad(row.host, hostWidth));
    lines.push(cells.join('  '));
  }
  return lines.join('\n');
}
