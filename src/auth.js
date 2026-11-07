/**
 * Finding the user's Stremio auth key.
 *
 * Stremio stores a small `profile` blob in browser storage containing
 * `{"auth":{"key":"<base64>"},"user":{...}}`. That blob is written as UTF-16LE
 * inside a LevelDB used by WebView2 (desktop app) and by Chromium browsers
 * (web.stremio.com), so we scan those stores and decode both alignments.
 *
 * Anything we cannot read automatically can still be supplied with --key.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Matches both the desktop/web profile blob and older flat shapes. */
export const KEY_PATTERNS = [
  /"auth"\s*:\s*\{\s*"key"\s*:\s*"([A-Za-z0-9+/=_-]{20,})"/,
  /"authKey"\s*:\s*"([A-Za-z0-9+/=_-]{20,})"/,
];

export function maskKey(key) {
  if (!key) return '';
  return key.length <= 12 ? '********' : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * LevelDB values are usually UTF-8 but the Stremio profile blob is UTF-16LE,
 * and it can start on an odd byte offset, so try every plausible decoding.
 */
export function decodeCandidates(buffer) {
  return [
    buffer.toString('utf8'),
    buffer.toString('utf16le'),
    buffer.subarray(1).toString('utf16le'),
    buffer.subarray(1).toString('utf8'),
  ];
}

export function extractAuthKeyFromText(text) {
  for (const pattern of KEY_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function extractAuthKeyFromBuffer(buffer) {
  for (const text of decodeCandidates(buffer)) {
    const key = extractAuthKeyFromText(text);
    if (key) return key;
  }
  return null;
}

/**
 * Collect every `.../Local Storage/leveldb` directory below `root`.
 * Covers WebView2 (`<app>.exe.WebView2/EBWebView/Default/...`), Chromium
 * profiles (`<profile>/Local Storage/leveldb`) and Opera-style layouts.
 */
export function leveldbDirsUnder(root, { maxDirs = 4000 } = {}) {
  const found = [];
  if (!root || !fs.existsSync(root)) return found;

  const queue = [root];
  let visited = 0;

  while (queue.length && visited < maxDirs) {
    const dir = queue.shift();
    visited += 1;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const names = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
    if (names.has('Local Storage')) {
      const leveldb = path.join(dir, 'Local Storage', 'leveldb');
      if (fs.existsSync(leveldb)) found.push(leveldb);
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'Local Storage') continue;
      // Keep the walk shallow: profile trees are wide, LevelDB dirs are deep.
      if (dir.split(path.sep).length - root.split(path.sep).length >= 5) continue;
      queue.push(path.join(dir, entry.name));
    }
  }

  return found;
}

/** Platform-specific places where a Stremio session can be stored. */
export function candidateRoots({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const roots = [];

  if (platform === 'win32') {
    const local = env.LOCALAPPDATA;
    const roaming = env.APPDATA;
    if (local) {
      roots.push(path.join(local, 'Programs', 'Stremio')); // desktop app (WebView2)
      roots.push(path.join(local, 'Google', 'Chrome', 'User Data'));
      roots.push(path.join(local, 'Microsoft', 'Edge', 'User Data'));
      roots.push(path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'));
      roots.push(path.join(local, 'Chromium', 'User Data'));
      roots.push(path.join(local, 'Vivaldi', 'User Data'));
    }
    if (roaming) {
      roots.push(path.join(roaming, 'Stremio'));
      roots.push(path.join(roaming, 'Opera Software', 'Opera Stable'));
      roots.push(path.join(roaming, 'Mozilla', 'Firefox', 'Profiles'));
    }
  } else if (platform === 'darwin') {
    const support = path.join(home, 'Library', 'Application Support');
    roots.push(path.join(support, 'Stremio'));
    roots.push(path.join(support, 'Google', 'Chrome'));
    roots.push(path.join(support, 'Microsoft Edge'));
    roots.push(path.join(support, 'BraveSoftware', 'Brave-Browser'));
    roots.push(path.join(support, 'Chromium'));
    roots.push(path.join(support, 'Vivaldi'));
    roots.push(path.join(home, 'Library', 'WebKit')); // WebKit-based builds
  } else {
    const config = env.XDG_CONFIG_HOME || path.join(home, '.config');
    const share = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    roots.push(path.join(config, 'Stremio'));
    roots.push(path.join(share, 'Stremio'));
    roots.push(path.join(config, 'google-chrome'));
    roots.push(path.join(config, 'microsoft-edge'));
    roots.push(path.join(config, 'BraveSoftware', 'Brave-Browser'));
    roots.push(path.join(config, 'chromium'));
    roots.push(path.join(config, 'vivaldi'));
  }

  return roots.filter((root) => {
    try {
      return fs.statSync(root).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Scan the machine for Stremio sessions.
 *
 * @returns {{ key: string, source: string, mtimeMs: number }[]} newest first
 */
export function discoverAuthKeys({ roots = candidateRoots(), extraDirs = [] } = {}) {
  const dirs = [...extraDirs];
  for (const root of roots) dirs.push(...leveldbDirsUnder(root));

  const byKey = new Map();

  for (const dir of dirs) {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of files) {
      const file = path.join(dir, name);
      let stat;
      let buffer;
      try {
        stat = fs.statSync(file);
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES) continue;
        buffer = fs.readFileSync(file);
      } catch {
        continue;
      }
      const key = extractAuthKeyFromBuffer(buffer);
      if (!key) continue;

      const previous = byKey.get(key);
      if (!previous || stat.mtimeMs > previous.mtimeMs) {
        byKey.set(key, { key, source: file, mtimeMs: stat.mtimeMs });
      }
    }
  }

  return [...byKey.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export const MISSING_KEY_HELP = [
  'Could not find a Stremio login on this machine.',
  '',
  'Fix it any one of these ways:',
  '  1. Log in to https://web.stremio.com in Chrome, Edge or Brave on this computer,',
  '     then run the command again — the key is found automatically.',
  '  2. Copy the key by hand: web.stremio.com → F12 → Application → Local Storage →',
  '     https://web.stremio.com → "profile" → auth.key, then pass --key <key>.',
  '  3. Set the STREMIO_AUTH_KEY environment variable.',
  '',
  'Note: the desktop app hides its storage from other users, which is why the',
  'browser route is the easiest one.',
].join('\n');

/**
 * Decide which key to use.
 *
 * @param {{ explicit?: string, env?: object, discover?: Function }} [options]
 * @returns {{ key: string, source: string, alternatives: {key: string, source: string}[] }}
 */
export function resolveAuthKey({ explicit, env = process.env, discover = discoverAuthKeys } = {}) {
  const fromEnv = env.STREMIO_AUTH_KEY;
  if (explicit) return { key: explicit.trim(), source: '--key', alternatives: [] };
  if (fromEnv) return { key: fromEnv.trim(), source: 'STREMIO_AUTH_KEY', alternatives: [] };

  const found = discover();
  if (found.length === 0) {
    const error = new Error(MISSING_KEY_HELP);
    error.code = 'NO_AUTH_KEY';
    throw error;
  }
  if (found.length === 1) {
    return { key: found[0].key, source: found[0].source, alternatives: [] };
  }

  // More than one account on this machine: newest wins, but say so loudly.
  return {
    key: found[0].key,
    source: found[0].source,
    alternatives: found.slice(1).map(({ key, source }) => ({ key, source })),
  };
}
