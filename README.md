# Omalauncher

The OWL widgets of the Omarchy Android launcher, on the desktop. Write a
widget, see it live as you save it, use it, and publish it to the
[widget store](https://github.com/SimonSchubert/omarchy-widgets), where the
phone and this app install it from.

- **My widgets**: every `.owl` file in `~/.config/omarchy-widgets`, live, on
  the launcher's grid. A widget that does not compile says why in its tile.
  A new board starts with three from the store: the weather (`today`) and
  `fetch` side by side, the `koi-pond` under them. Remove them as any other;
  they don't come back.
- **Store**: the reviewed widgets, with their previews in your Omarchy
  theme. A widget's page lists every command it runs and every package it
  needs before you install it.
- **Publish**: one pull request to the store from your GitHub account,
  the same as the phone's publish button.
- **Share**: a widget as a QR code. Scan it with an Android phone and it
  opens in Omalauncher, no store or account needed.

It runs on Quickshell and draws in the current Omarchy theme. On another
desktop it falls back to a plain palette.

## Install

On Omarchy it is a plugin: Omalauncher's mark in the bar, which opens your
board in a panel under it, at the phone's six columns, with the store a click
away (right-click the mark: create a widget with your agent).

```sh
omarchy plugin add https://github.com/SimonSchubert/omalauncher-omarchy-plugin.git --enable
```

Drag the panel's left edge to make it wider, its bottom edge to make it
taller, or the corner between them for both; it keeps that size (the
plugin's `width` and `height`, also `omarchy bar set io.github.simonschubert.omalauncher
width 600`).

The plugin is this repo, cloned to `~/.config/omarchy/plugins/io.github.simonschubert.omalauncher`;
`omarchy plugin update` takes new versions. The board exists only while the
panel is open: closing it stops every widget's sources.

To remove it:

```sh
omarchy plugin remove io.github.simonschubert.omalauncher
```

That unloads it from the shell and deletes the clone. Your widgets stay in
`~/.config/omarchy-widgets` and the board's arrangement in
`~/.local/state/omarchy-widgets`; delete those too to leave nothing behind.

Elsewhere, as a window of its own at twelve columns, from the AUR:

```sh
yay -S omarchy-widgets
```

Open **Widgets** from the app menu, or bind it in `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + ALT + W", "Widgets", "omarchy-widgets toggle")
```

## Writing a widget

A widget is one file, `~/.config/omarchy-widgets/<name>.owl`. It shows up on
the board as you save it, and its errors show in its tile and in
`.errors/<name>.txt` beside it, which is where a coding agent should look.
The language is in the store's
[LANGUAGE.md](https://github.com/SimonSchubert/omarchy-widgets/blob/main/docs/LANGUAGE.md).

```owl
widget "uptime" {
  meta { description: "How long this machine has been up"; version: "1.0"; license: "MIT"; category: "system" }
  size: 3x1
  source up = cmd("uptime -p") every 1m
  Text { text: up ?? "…"; style: title }
}
```

## Publishing

Right-click a widget, then **Share**: under the QR code, **Publish with your
agent** opens Omarchy's default agent, as the phone's Share does. It forks the
store, adds the widget as `widgets/<you>/<name>/widget.owl`, shows you the file
before pushing and opens the pull request; the review check there lists what
the widget runs, and a maintainer merges it. To publish an update, raise
`meta`'s version and publish again. **Check for secrets** first has the agent
list anything personal in the widget (keys, tokens, places), changing nothing.

The store's rules: `meta` with a description, a version and a license; every
package in `requires`; nothing personal. Without Omarchy, `omarchy-widgets
publish` does it with `github-cli` and `git` in a terminal, asking first.

## Sharing

Right-click a widget, then **Share**: the whole widget goes into a QR code
(and a link, **Copy link**). Scanning it with the phone's camera opens
Omalauncher, which shows every command the widget runs, flags risky ones, and
adds it once you say so. Nothing is uploaded: the widget is in the link after
the `#`, which browsers never send. Without the launcher, the link opens a page
that shows the widget's source.

One code holds about 2.9 KB of compressed widget, which most widgets under
6 KB fit. A bigger one says so; publish it to the store instead.

Someone shared a link with you? `omarchy-widgets import '<link>'` shows the
whole file and adds it as `shared-<name>.owl` if you agree. That includes the
launcher's short links (`#dpaste.<id>`) for widgets too big for one code: the
file is fetched from dpaste.com, where it stays for 7 days.

## Using it

- **Escape** steps back: a widget's screen, arranging, a store page, the store.
- **Right-click or hold** a widget to arrange the board, as on the phone. **Edit** opens your agent on it. Drag
  a tile to move it, any edge to resize it, and click beside the tiles when
  you're done. Arrow keys move the selected
  tile, Shift+arrows resize it, Tab picks the next one, and Delete takes it off
  the board until you add it back with **+**.
- **Store** and **Create** sit at the bottom left. Create opens Omarchy's
  default agent in the widgets folder, as the phone's Create does: tell it
  what to make. Without Omarchy it starts `new-widget.owl` from a template in
  your editor.
- **Ctrl+1** shows the board and **Ctrl+2** the store; **/** searches it.

Sources run only while the window is open, and closing it ends the process.
The arrangement is kept in `~/.local/state/omarchy-widgets/board.json`, with
the widgets' `persist` state and the record of store installs beside it.

## The command

The store and publishing are `omarchy-widgets`, which the app calls and which
works on its own:

```
omarchy-widgets                        open the app (or raise it)
omarchy-widgets toggle                 open it, or close it when it is open
omarchy-widgets install <author/name>  install a reviewed widget
omarchy-widgets starter                a new board's widgets (once; the app runs it)
omarchy-widgets remove <author/name>   remove one installed from the store
omarchy-widgets packages <file>        install the packages a widget requires
omarchy-widgets new                    create a widget with your agent (or from a template)
omarchy-widgets edit <file>            change a widget with your agent (or in your editor)
omarchy-widgets publish <file>         your agent opens a pull request that adds it to the store
omarchy-widgets check <file>           your agent looks for anything personal in it
omarchy-widgets share <file>           the widget as a link, and a QR code to scan
omarchy-widgets import <link>          add a widget someone shared
```

A store widget is installed as `market-<author>-<name>.owl`, the name the phone
gives it. It is installed only when its SHA-256 matches the reviewed file in the
store's index. An update whose commands or packages changed is marked in the
store, so you read it again before you update.

## How it relates to the phone

The grid is the launcher's: a 69 dp cell and a 6 dp gap, so a tile has the
proportions it has on the phone, in twelve columns instead of six. A widget's
`screen { }`, full screen on the phone, opens as a card a phone's width.

`owl/` is the Quickshell runtime from omarchy-widgets' `runtimes/quickshell`,
copied by `tools/sync-runtime`; `owl/VERSION` says from which commit. That
runtime is held to the reference implementation, and its README lists where
the desktop differs from Android (shaders draw their fallback, no Android
notifications).

## Development

```sh
quickshell -p .                                   # run it from the checkout
node --test test/                                 # layout and store logic
test/cli/run.sh                                   # the command, against a local store (Linux)
test/desktop/run.sh ../omarchy ~/some-widgets     # screenshots under headless sway, in Docker
tools/sync-runtime ../omarchy-widgets             # take a newer runtime
```

Releasing: tag `vX.Y.Z`, then pin the tarball's sha256 in
`packaging/PKGBUILD`, regenerate `.SRCINFO` with `makepkg --printsrcinfo`, and
push both to the AUR.
