#!/usr/bin/env node
/**
 * Renders docs/demo.gif.
 *
 * The screens come from the real formatters (`formatTable`, `renderSort`), so the
 * demo cannot drift from the tool. ffmpeg does the rasterising and encoding.
 *
 *   node docs/render-demo.mjs [output.gif]
 *
 * Requirements: ffmpeg on PATH (or FFMPEG=/path/to/ffmpeg) and a monospace font.
 * No npm dependencies.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSortState, applyKey, renderSort } from '../src/sort-ui.js';
import { formatTable } from '../src/table.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(process.argv[2] || path.join(here, 'demo.gif'));
const ffmpeg = process.env.FFMPEG || 'ffmpeg';

const FONTS = [
  'C:/Windows/Fonts/consola.ttf',
  'C:/Windows/Fonts/CascadiaMono.ttf',
  '/System/Library/Fonts/Supplemental/Andale Mono.ttf',
  '/Library/Fonts/Andale Mono.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
];

const BACKGROUND = '0x0d1117';
const FOREGROUND = '0xE6EDF3';
const FONT_SIZE = 15;
const LINE_HEIGHT = 24;
const PADDING = 32;

// A generic collection: no real account data ends up in the published GIF.
const addons = [
  ['Cinemeta', 'com.linvo.cinemeta', 'v3-cinemeta.strem.io'],
  ['Local Files', 'org.stremio.local', '127.0.0.1:11470'],
  ['OpenSubtitles v3', 'org.stremio.opensubtitlesv3', 'opensubtitles-v3.strem.io'],
  ['Streaming Catalogs', 'pw.ers.netflix-catalog', 'stremio-catalogs.example'],
  ['Sports Streams', 'community.sports.fly', 'sports.highfly.dev'],
  ['Comet | ElfHosted', 'comet.elfhosted.com', 'comet.elfhosted.com'],
  ['Torrentio', 'com.stremio.torrentio.addon', 'torrentio.strem.fun'],
].map(([name, id, host]) => ({
  transportUrl: `https://${host}/manifest.json`,
  transportName: '',
  manifest: { id, name },
  flags: {},
}));

const COLUMNS = 78;
const table = (list) => formatTable(list, { columns: COLUMNS });

function listScreen() {
  return [
    '$ stremio-addon-order list',
    '',
    `Stremio add-ons (${addons.length}) — last changed 2026-01-01T00:00:00.000Z`,
    '',
    table(addons),
    '',
    `Tip: "stremio-addon-order sort" rearranges these interactively.`,
  ].join('\n');
}

const state = createSortState(addons);
const sortFrames = [];

function capture(keys) {
  for (const key of keys) applyKey(state, key);
  sortFrames.push(renderSort({ addons, state, columns: COLUMNS }));
}

capture([]); // initial
capture(['down', 'down', 'down']); // cursor -> Streaming Catalogs
capture(['down']); // cursor -> Sports Streams
capture(['space']); // pick up Sports Streams
capture(['up']); // cursor -> Streaming Catalogs
capture(['space']); // drop before Streaming Catalogs

const savedScreen = [
  'New order:',
  '',
  table(addons.map((_, index) => addons[state.order[index]])),
  '',
  'Saved.',
  'Reload Stremio (or restart the app) to see the new order.',
].join('\n');

const frames = [
  { text: listScreen(), duration: 2.2 },
  { text: `$ stremio-addon-order sort\n\n${sortFrames[0]}`, duration: 1.2 },
  { text: sortFrames[1], duration: 0.4 },
  { text: sortFrames[2], duration: 0.4 },
  { text: sortFrames[3], duration: 0.8 },
  { text: sortFrames[4], duration: 0.5 },
  { text: sortFrames[5], duration: 1.0 },
  { text: savedScreen, duration: 2.6 },
];

const width = PADDING * 2 + Math.max(...frames.flatMap((frame) => frame.text.split('\n').map((line) => [...line].length))) * 9;
const height =
  PADDING * 2 +
  Math.max(...frames.map((frame) => frame.text.split('\n').length)) * LINE_HEIGHT +
  8;

const font = process.env.FONT || FONTS.find((candidate) => fs.existsSync(candidate));

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-demo-'));
process.on('exit', () => fs.rmSync(workdir, { recursive: true, force: true }));

if (font) fs.copyFileSync(font, path.join(workdir, 'font.ttf'));

const run = (args) => execFileSync(ffmpeg, args, { cwd: workdir, stdio: 'pipe' });

frames.forEach((frame, index) => {
  const name = `frame-${String(index).padStart(2, '0')}`;
  fs.writeFileSync(path.join(workdir, `${name}.txt`), frame.text, 'utf8');

  const options = [
    font ? `fontfile=font.ttf` : null,
    `textfile=${name}.txt`,
    `fontsize=${FONT_SIZE}`,
    `fontcolor=${FOREGROUND}`,
    `line_spacing=${LINE_HEIGHT - FONT_SIZE - 2}`,
    `x=${PADDING}`,
    `y=${PADDING}`,
  ].filter(Boolean);
  const drawtext = `drawtext=${options.join(':')}`;

  run([
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${BACKGROUND}:s=${width}x${height}`,
    '-vf',
    drawtext,
    '-frames:v',
    '1',
    `${name}.png`,
  ]);
});

const concat = frames
  .map((frame, index) => `file 'frame-${String(index).padStart(2, '0')}.png'\nduration ${frame.duration}`)
  .join('\n');
fs.writeFileSync(path.join(workdir, 'frames.txt'), `${concat}\nfile 'frame-${String(frames.length - 1).padStart(2, '0')}.png'\n`, 'utf8');

const target = output.replace(/\\/g, '/');
run([
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  'frames.txt',
  '-vf',
  'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
  '-loop',
  '0',
  target,
]);

const { size } = fs.statSync(output);
console.log(`Wrote ${path.relative(process.cwd(), output)} (${Math.round(size / 1024)} KB, ${width}x${height}, ${frames.length} frames)`);
