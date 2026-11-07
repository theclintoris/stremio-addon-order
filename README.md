# stremio-addon-order

**Sort your Stremio add-ons, from the terminal.**

Stremio renders add-ons in the exact order they appear in your account's
add-on collection. This tool lets you change that order deliberately — move one
add-on before another, or reorder the whole list interactively — instead of
fighting with drag handles.

```console
$ npx stremio-addon-order sort

SORT ADD-ONS
↑/↓ move · space pick up / drop · s save · r reset · q quit

    1  Cinemeta
    2  Local Files (without catalog support)
    3  OpenSubtitles v3
 *  4  Streaming Catalogs
>   5  Sports Streams
    6  Comet | ElfHosted | TB

Holding "Streaming Catalogs" — move and press space to drop
```

[![npm](https://img.shields.io/npm/v/stremio-addon-order.svg)](https://www.npmjs.com/package/stremio-addon-order)
[![CI](https://github.com/clintoris/stremio-addon-order/actions/workflows/ci.yml/badge.svg)](https://github.com/clintoris/stremio-addon-order/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Why

The order of the add-on collection is not cosmetic:

- **Catalog rows** on the Board appear in add-on order.
- **Stream providers** are queried and listed in add-on order, so the first
  add-on gets first say on which streams you see.
- Anything after a slow or broken add-on waits for it.

Stremio's own add-ons page does support drag-and-drop in current desktop and web
builds, but it is easy to knock out of place, impossible to script, painful on a
TV or small screen, and there is no "put it back the way it was". This tool
talks to the account instead, so the result is the same everywhere you sign in.

## Install

Requires **Node.js 18 or newer**.

```bash
# one-off, no install
npx stremio-addon-order list

# or install globally
npm install -g stremio-addon-order
```

## Usage

### `sort` — reorder interactively

```bash
stremio-addon-order sort
```

| Key       | Action                                   |
| --------- | ---------------------------------------- |
| `↑` / `↓` | Move the highlight ( `k` / `j` also work) |
| `space`   | Pick up the highlighted add-on            |
| `space`   | Move it to the highlight and drop it      |
| `s`       | Save and exit                             |
| `r`       | Reset to the order you started with       |
| `q`       | Quit without saving                       |

Nothing is written until you press `s`.

### `move` — reorder precisely

```bash
# by name
stremio-addon-order move "Sports Streams" before "Streaming Catalogs"

# by position (1-based)
stremio-addon-order move 9 before 5

# by id, and see the result without saving
stremio-addon-order move community.sports.fly after com.linvo.cinemeta --dry-run
```

Names are matched case-insensitively, and an unambiguous fragment is enough.
If a fragment matches several add-ons the command stops and lists them rather
than guessing.

### `list` — see the current order

```bash
stremio-addon-order list
stremio-addon-order list --json
```

### `export` / `restore` — keep a known-good order

```bash
stremio-addon-order export addons.json    # snapshot
stremio-addon-order restore addons.json   # put it back
```

`export` writes a plain JSON file. Keep it private: add-on URLs can contain
debrid API keys.

### Global options

| Option          | Meaning                                       |
| --------------- | --------------------------------------------- |
| `--key <key>`   | Stremio auth key (otherwise auto-detected)    |
| `--dry-run`     | Show the new order without saving             |
| `--json`        | Machine-readable output                       |
| `--yes`, `-y`   | Skip the `restore` confirmation               |
| `--verbose`     | Say where the auth key came from              |
| `-h`, `--help`  | Usage                                         |
| `-v`, `--version` | Version                                     |

After a change, reload Stremio (`Ctrl+R`) or restart the app. The desktop app
reads the collection when it starts.

## Finding your auth key

Stremio stores a small `profile` blob in browser storage containing
`{"auth":{"key":"…"}}`. The tool looks for it in, in order:

| Platform | Locations scanned |
| -------- | ----------------- |
| Windows  | Stremio desktop (WebView2), Chrome, Edge, Brave, Chromium, Vivaldi, Opera |
| macOS    | Stremio, Chrome, Edge, Brave, Chromium, Vivaldi, WebKit stores |
| Linux    | `~/.config` and `~/.local/share` equivalents |

If nothing is found, log in at <https://web.stremio.com> in Chrome, Edge or
Brave and run the command again.

To get the key by hand:

1. Open <https://web.stremio.com> and log in.
2. Press `F12` → **Application** → **Local Storage** → `https://web.stremio.com`.
3. Open the `profile` entry and copy `auth.key`.
4. `stremio-addon-order list --key <key>` (or set `STREMIO_AUTH_KEY`).

The key never leaves your machine except to `api.strem.io`, the same endpoint the
official client uses. It is masked in all output.

## How it works

Two calls to Stremio's account API:

```
POST https://api.strem.io/api/addonCollectionGet  {"authKey": "…"}
POST https://api.strem.io/api/addonCollectionSet  {"authKey": "…", "addons": [ … ]}
```

The collection is an ordered array of add-on objects. The tool only permutes
that array — manifests, URLs, flags and settings are passed through untouched —
then reads the collection back and verifies the change stuck.

When the order cannot be verified the command exits non-zero and says so,
rather than pretending it worked.

## Safety

- Reordering only rearranges existing entries; nothing is installed or removed.
- Every write is read back and compared before the command reports success.
- `export` before you experiment, `restore` if you dislike the result.
- No credentials are written to disk; the key is read when needed.

## Troubleshooting

**"Could not find a Stremio login on this machine."**
Log in at <https://web.stremio.com> in a Chromium-based browser on the same
machine, or pass `--key` (see above). Firefox stores local storage in a
compressed database that is not read automatically.

**"N Stremio sessions found; using the most recent one."**
More than one account has logged in on this machine. Pass `--key` to pick the
right one; the sources are listed.

**"Stremio accepted the request but the collection read back differently."**
A client wrote the old collection back. Quit Stremio completely, retry, then
reopen it.

**`sort` says it needs a terminal.**
The interactive sorter needs a TTY. Use `move` from a script or a pipe.

## Development

Zero runtime dependencies; tests use `node:test`.

```bash
npm test          # unit + integration tests, no network needed
npm run test:watch
npm pack --dry-run
```

```
bin/stremio-addon-order.js   executable entry point
src/cli.js                   argument parsing and commands
src/api.js                   Stremio account API client
src/auth.js                  auth-key discovery (LevelDB / UTF-16LE)
src/collection.js            pure collection logic
src/sort-ui.js               interactive sorter state machine
src/table.js                 plain-text table rendering
test/                        unit tests, no network needed
```

Releasing: `npm version patch && git push --follow-tags && npm publish`.

## License

MIT — see [LICENSE](LICENSE).
