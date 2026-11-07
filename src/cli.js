/**
 * Command line interface.
 *
 * Everything that talks to the network or the terminal starts here; the
 * interesting logic lives in collection.js / auth.js / sort-ui.js so it can be
 * tested without either.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

import { getCollection, setCollection } from './api.js';
import { maskKey, resolveAuthKey } from './auth.js';
import {
  addonHost,
  addonId,
  addonName,
  applyOrder,
  isCollection,
  moveAddon,
  resolveRef,
  sameOrder,
} from './collection.js';
import { runSortUi } from './sort-ui.js';
import { formatTable } from './table.js';

export const PROGRAM = 'stremio-addon-order';
export const VERSION = '1.0.0';

const USAGE = `${PROGRAM} ${VERSION}
Manually sort the add-ons in your Stremio collection.

USAGE
  ${PROGRAM} <command> [options]

COMMANDS
  list                                 Show add-ons in their current order (default)
  sort                                 Rearrange them interactively in the terminal
  move <addon> <before|after> <addon>  Move one add-on relative to another
  export [file]                        Save a JSON backup of the collection
  restore <file>                       Put a backup back (needs --yes when piped)
  help                                 Show this help

ADD-ON REFERENCES
  A 1-based position (3), an exact name (Torrentio TB), an id
  (com.linvo.cinemeta), or an unambiguous part of a name.

OPTIONS
  --key <key>     Stremio auth key (otherwise found automatically)
  --dry-run       Show the new order without saving
  --json          Machine-readable output
  --yes, -y       Skip the restore confirmation
  --verbose       Say where the auth key came from
  -h, --help      Show this help
  -v, --version   Show the version

EXAMPLES
  ${PROGRAM} sort
  ${PROGRAM} move "Sports Streams" before "Streaming Catalogs"
  ${PROGRAM} move 9 before 5 --dry-run
  ${PROGRAM} export addons-backup.json

The order of the collection is the order Stremio shows: add-on rows on the
Board and the priority of stream providers. Reload Stremio after a change.
`;

class UsageError extends Error {}

const BOOLEAN_FLAGS = new Map([
  ['--dry-run', 'dryRun'],
  ['--json', 'json'],
  ['--yes', 'yes'],
  ['-y', 'yes'],
  ['--verbose', 'verbose'],
  ['--help', 'help'],
  ['-h', 'help'],
  ['--version', 'version'],
  ['-v', 'version'],
]);

const VALUE_FLAGS = new Map([['--key', 'key']]);

export function parseArgs(argv) {
  const flags = {
    dryRun: false,
    json: false,
    yes: false,
    verbose: false,
    help: false,
    version: false,
    key: null,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      positional.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith('--') && arg.includes('=')) {
      const [name, ...rest] = arg.split('=');
      if (VALUE_FLAGS.has(name)) {
        flags[VALUE_FLAGS.get(name)] = rest.join('=');
        continue;
      }
      if (BOOLEAN_FLAGS.has(name)) throw new UsageError(`${name} does not take a value.`);
      throw new UsageError(`Unknown option ${name}.`);
    }

    if (BOOLEAN_FLAGS.has(arg)) {
      flags[BOOLEAN_FLAGS.get(arg)] = true;
      continue;
    }

    if (VALUE_FLAGS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) throw new UsageError(`${arg} needs a value.`);
      flags[VALUE_FLAGS.get(arg)] = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('-') && arg !== '-') throw new UsageError(`Unknown option ${arg}.`);
    positional.push(arg);
  }

  const [command = 'list', ...args] = positional;
  return { command, args, flags };
}

/* --------------------------------------------------------------- plumbing */

const out = (text = '') => process.stdout.write(`${text}\n`);
const err = (text = '') => process.stderr.write(`${text}\n`);

function resolveKeyOrThrow(flags) {
  const resolved = resolveAuthKey({ explicit: flags.key });
  if (flags.verbose) err(`Using auth key ${maskKey(resolved.key)} from ${resolved.source}`);
  if (resolved.alternatives.length > 0) {
    err(`! ${resolved.alternatives.length + 1} Stremio sessions found; using the most recent one.`);
    for (const alternative of resolved.alternatives) {
      err(`    also: ${alternative.source} (${maskKey(alternative.key)})`);
    }
    err('  Pass --key to choose a different session.');
    err('');
  }
  return resolved.key;
}

async function loadCollection(authKey) {
  const result = await getCollection(authKey);
  const addons = Array.isArray(result?.addons) ? result.addons : [];
  return { addons, lastModified: result?.lastModified };
}

/** Write the collection and read it back to prove it stuck. */
async function saveCollection(authKey, next) {
  await setCollection(authKey, next);
  const { addons } = await loadCollection(authKey);
  if (!sameOrder(addons, next)) {
    throw new Error(
      'Stremio accepted the request but the collection read back differently. ' +
        'Restart Stremio, then try again.',
    );
  }
  return addons;
}

function printCollection(addons, { json = false, dryRun = false } = {}) {
  if (json) {
    out(
      JSON.stringify(
        { saved: !dryRun, addons: addons.map((addon, index) => ({ position: index + 1, name: addonName(addon) })) },
        null,
        2,
      ),
    );
    return;
  }
  out('');
  out(formatTable(addons, { columns: process.stdout.columns }));
  out('');
  out(dryRun ? 'Dry run — nothing was saved.' : 'Saved.');
  if (!dryRun) out('Reload Stremio (or restart the app) to see the new order.');
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/* --------------------------------------------------------------- commands */

async function list(_args, flags) {
  const authKey = resolveKeyOrThrow(flags);
  const { addons, lastModified } = await loadCollection(authKey);

  if (flags.json) {
    out(
      JSON.stringify(
        {
          lastModified: lastModified ?? null,
          addons: addons.map((addon, index) => ({
            position: index + 1,
            name: addonName(addon),
            id: addonId(addon),
            host: addonHost(addon),
            transportUrl: addon.transportUrl,
            official: Boolean(addon.flags?.official),
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  out(`Stremio add-ons (${addons.length}) — last changed ${lastModified ?? 'unknown'}`);
  out('');
  out(formatTable(addons, { columns: process.stdout.columns }));
  out('');
  out(`Tip: "${PROGRAM} sort" rearranges these interactively.`);
  return 0;
}

async function sort(_args, flags) {
  const authKey = resolveKeyOrThrow(flags);
  const { addons } = await loadCollection(authKey);

  if (addons.length < 2) {
    out('There is only one add-on, so there is nothing to sort.');
    return 0;
  }

  const result = await runSortUi({ addons });

  if (result.action !== 'save') {
    out(result.unchanged ? 'Nothing changed.' : 'Cancelled — nothing was saved.');
    return 0;
  }

  const next = applyOrder(addons, result.order);
  if (sameOrder(addons, next)) {
    out('Nothing changed.');
    return 0;
  }

  const saved = await saveCollection(authKey, next);
  if (!flags.json) out('New order:');
  printCollection(saved, { json: flags.json });
  return 0;
}

async function move(args, flags) {
  const [fromRef, position, toRef] = args;
  if (!fromRef || !position || !toRef || (position !== 'before' && position !== 'after')) {
    err(`usage: ${PROGRAM} move <addon> <before|after> <addon>`);
    return 2;
  }

  const authKey = resolveKeyOrThrow(flags);
  const { addons } = await loadCollection(authKey);

  const from = resolveRef(addons, fromRef);
  const to = resolveRef(addons, toRef);

  if (from === to) {
    out(`"${addonName(addons[from])}" is the reference add-on. Nothing to do.`);
    return 0;
  }

  const next = moveAddon(addons, from, to, position);
  if (sameOrder(addons, next)) {
    out('That would not change the order. Nothing to do.');
    return 0;
  }

  if (flags.dryRun) {
    out(`Would move "${addonName(addons[from])}" ${position} "${addonName(addons[to])}".`);
    printCollection(next, { json: flags.json, dryRun: true });
    return 0;
  }

  const saved = await saveCollection(authKey, next);
  out(`Moved "${addonName(addons[from])}" ${position} "${addonName(addons[to])}".`);
  printCollection(saved, { json: flags.json });
  return 0;
}

async function exportCollection(args, flags) {
  const authKey = resolveKeyOrThrow(flags);
  const { addons, lastModified } = await loadCollection(authKey);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = args[0] || `stremio-addons-${stamp}.json`;
  const payload = {
    tool: PROGRAM,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    lastModified: lastModified ?? null,
    addons,
  };

  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  out(`Saved ${addons.length} add-ons to ${file}`);
  out('Keep this file private — add-on URLs can contain debrid keys.');
  return 0;
}

async function restore(args, flags) {
  const file = args[0];
  if (!file) {
    err(`usage: ${PROGRAM} restore <file>`);
    return 2;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    err(`Could not read ${file}: ${error.message}`);
    return 1;
  }

  const addons = Array.isArray(parsed) ? parsed : parsed?.addons;
  if (!isCollection(addons)) {
    err(`${file} does not look like a Stremio add-on backup.`);
    return 1;
  }

  const authKey = resolveKeyOrThrow(flags);
  const current = await loadCollection(authKey);

  if (!flags.yes) {
    if (!process.stdin.isTTY) {
      err('Refusing to overwrite the collection in a non-interactive shell. Re-run with --yes.');
      return 2;
    }
    const ok = await confirm(
      `Replace your ${current.addons.length} add-ons with the ${addons.length} from ${path.basename(file)}? [y/N] `,
    );
    if (!ok) {
      out('Cancelled — nothing was saved.');
      return 0;
    }
  }

  const saved = await saveCollection(authKey, addons);
  out(`Restored ${saved.length} add-ons from ${file}.`);
  printCollection(saved, { json: flags.json });
  return 0;
}

/* ------------------------------------------------------------------- main */

const COMMANDS = new Map([
  ['list', list],
  ['ls', list],
  ['sort', sort],
  ['move', move],
  ['export', exportCollection],
  ['restore', restore],
  ['import', restore],
]);

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    err(error.message);
    err('');
    err(USAGE);
    return 2;
  }

  const { command, args, flags } = parsed;

  if (flags.help || command === 'help') {
    out(USAGE);
    return 0;
  }
  if (flags.version || command === 'version') {
    out(`${PROGRAM} ${VERSION}`);
    return 0;
  }

  const handler = COMMANDS.get(command);
  if (!handler) {
    err(`Unknown command "${command}".`);
    err('');
    err(USAGE);
    return 2;
  }

  try {
    return (await handler(args, flags)) ?? 0;
  } catch (error) {
    if (error?.code === 'NO_AUTH_KEY') {
      err(error.message);
      return 3;
    }
    err(`Error: ${error.message}`);
    return 1;
  }
}
