# Home-screen widgets

Each `*.owl` file in this folder is a widget on the Android home screen,
written in OWL, a small declarative language in the spirit of QML. Save a file
and it appears within ~2 seconds. If it doesn't compile, the tile shows the
error, and so does `.errors/<file>.txt` (runtime problems are appended there
too), so check that file after saving.

Widgets sit on a 6-column grid of roughly square cells (a phone has about 12
rows), bordered like Omarchy windows and colored by the current Omarchy
theme. Users move and resize them on the phone. Older `*.json` widgets still
work.

```owl
widget "memory" {
  page: 1                 // home page, 1-based
  order: 2                // placement order on the page (lower = placed first)
  size: 3x4               // preferred size in grid cells: columns x rows
  minSize: 2x3            // users can't shrink it below this

  source mem = cmd("free -b | awk '/Mem:/ {print $2, $3}'") every 5s
  let used = num(words(mem)[1])
  let total = num(words(mem)[0])
  let pct = total ? used / total * 100 : null
  let hist = history(pct, 40)

  onTap: terminal("btop")

  Column {
    Text { text: "memory"; style: muted }
    Text { text: "${round(pct)}%"; style: title; color: pct > 85 ? red : foreground }
    Progress { value: pct; animate value: spring() }
    Sparkline { values: hist; min: 0; max: 100; area: true; fill: width; weight: 1 }
  }
}
```

Every property is a live expression: when a source updates, only the parts
that read it redraw. Properties are separated by newlines or `;`.

## Declarations (top of the widget)

| declaration | meaning |
|---|---|
| `source x = cmd("...") every 5s` | runs a bash command in this Arch system; `x` is its output (trimmed text). Add `json` to parse JSON output, `timeout 30s` to allow more than 10 s. Default interval: 60 s |
| `source x = stream("...")` | a long-running command; every line it prints becomes the new value. Add `json` for JSON lines. At most 4 different streams run at once |
| `source now = clock every 1s` | Unix time in seconds, with no shell involved. Use `fmtTime(now, "HH:mm")` |
| `source bat = android.battery` | `{level, charging, status}` from Android |
| `source dev = android.device` | the phone: `{model, maker, android, sdk, soc}` (the Linux side can't see these) |
| `state x = 0` | a value that handlers can change |
| `let x = expr` | a derived value, recomputed only when what it reads changes. It can use sources, state and earlier lets |
| `let h = history(x, 60)` | the last 60 values of `x`, sampled whenever a source updates (for Sparkline) |
| `let p = prev(x)` | the previous value of `x`, for rates: `let rate = (bytes - p) / 5` |
| `component Name(a, b = 1) { ... }` | a reusable node; use it as `Name { a: 1 }` |
| `asset logo = base64"iVBOR..."` | an embedded image (under 2 MB) for `Image { src: logo }`, so the widget is one self-contained file |
| `requires { pacman: ["jq", "curl"] }` | packages the widget's commands need; see Dependencies |
| `meta { description: "..."; version: "1.0"; license: "MIT"; category: "news" }` | needed to publish to the widget store (see Sharing) |
| `onTap: ...` | runs when the tile (not a button inside it) is tapped |
| `padding: 12` / `background: ...` | the tile's padding (dp) and background |

Sources only run while their page (or a neighbour) is on screen, and
identical commands in several widgets run once. Keep commands fast. A command
can depend on state (`cmd("curl wttr.in/${sh(city)}")`) and runs again as soon as the
value changes, at most once a second (launchers from before owl 8 wait for its next interval).

A value goes into a command as `${sh(value)}`, outside any quotes: `sh` puts it in single quotes,
so bash reads it as one word, whatever it holds. Unquoted, a `'` or `;` in a city name, a file or
an API's reply would run as code. Numbers from `int`, `round` or `fixed` can go in as they are. The
store takes no other values in commands, and lists them as `‹value›` for the reviewer
(`curl wttr.in/‹value›`). `sh` needs `meta { owl: 6 }`.

## Expressions

- Numbers `12`, `0.5`, `3x2`; durations `500ms`, `2s`, `5m`, `1h` (in seconds). Strings are
  `"hi ${name}"` (interpolated) or `'raw $text'` (handy for shell commands).
  Also `"""multi-line"""`, `true`/`false`/`null`, lists `[1, 2]` and maps `{a: 1}`.
- Operators: `+ - * / %`, `== != < <= > >=`, `&& || !`, `a ?? b` (b if a is null), `c ? a : b`.
- Paths: `info.list[0].name` or `info.list.0.name`. Anything missing is `null`, never an error.
- Command output is text, but numeric text acts like a number: `used > 80` works on `"81"`.
- `null` shows as `…` in text, meaning the value hasn't loaded yet. Math and formatting
  functions pass `null` through.
- Methods are functions: `x.map(f)` is `map(x, f)`. Functions take arrow functions:
  `procs.filter(p => p.cpu > 1).sortBy(p => -p.cpu).take(5)`.

| functions | |
|---|---|
| numbers | `min max clamp(x, lo, hi) lerp(a, b, t) round(x, digits) floor ceil abs sqrt pow sin cos tan atan2 rad deg sign num(x, default) int` |
| text | `str len trim upper lower lines words split(s, sep) join(list, sep) replace(s, a, b) contains startsWith endsWith sub(s, from, to) pad(x, width, char) fixed(x, digits)`, `sh(x)` (one quoted shell word) |
| format | `fmtBytes(n)` → `1.5G`, `fmtDuration(seconds)` → `2h 5m`, `fmtTime(seconds, "EEE HH:mm")` |
| parsing | `match(s, regex)` (groups of the first match), `matchAll(s, regex)`, `parseJson(s)` |
| lists | `range(n)` or `range(a, b, step)`, `map filter find any all count sum avg sort sortBy reverse take drop first last indexOf unique flatten`, `keys values entries get(obj, key, default)` |
| colors | theme names `accent foreground background muted surface border red green yellow blue magenta cyan orange` plus `bright_*`, `color0`…`color15`; `#7aa2f7`; `rgb(r, g, b, a)`, `hsl(h, s, l, a)`, `alpha(c, 0.5)`, `mix(a, b, t)` |
| gradients | `linear(x0, y0, x1, y1, [colors])`, `radial(cx, cy, r, [colors])`: fills in Canvas |

Prefer theme color names: widgets then follow theme changes.

## Nodes

`Name { prop: value; ...children }`. Structure: `if cond { } else { }`,
`for x in list { }`, `for x, i in list key x.id { }` (a key keeps rows stable
when lists reorder), and `let x = ...` inside any node.

| node | properties |
|---|---|
| `Column` | `gap` (dp, default 4), `align: start/center/end`, `justify: start/center/end/spaceBetween/spaceAround/spaceEvenly`, `scroll: true` |
| `Row` | `gap` (8), `align: top/center/bottom`, `justify`, `wrap: true` |
| `Flow` | a Row that wraps to new lines |
| `Box` | stacks children on top of each other; `align: center/top/bottom/start/end/topStart/topEnd/bottomStart/bottomEnd` |
| `Grid` | `columns` (2), `gap`; children fill cells left to right |
| `Text` | `text`, `style: huge/title/body/small/muted/label`, `color`, `fontSize`, `bold`, `italic`, `font: mono/sans/serif`, `align: start/center/end`, `maxLines` |
| `Button` | `text`, `color`, `onTap` |
| `Progress` | `value`, `max` (100), `color`, `track` |
| `Ring` | circular progress: `value`, `max` (1), `color`, `track`, `thickness` (6), `start`/`sweep` (degrees; `start: 225; sweep: 270` makes a gauge). 64 dp unless sized |
| `Sparkline` | `values` (a list, usually a `history`), `min` (0), `max`, `color`, `area: true` or a color, `thickness` |
| `Image` | `src`: an `asset` or a path in this system (`"~/pics/a.png"`), `fit: contain/cover/fill`, `tint` |
| `Canvas` | free drawing, below. Fills the space unless sized |
| `Shader` | an AGSL shader, below. Fills the space unless sized |
| `Spacer` | empty space: `size`, `width`, `height` or `weight` |

Every node also takes:

- `width height size` (dp), `fill: true/width/height`, `weight` (share of the
  space left in a Row or Column), `padding` (`8`, `[h, v]` or `[l, t, r, b]`)
- `background`, `border` (dp), `borderColor`, `radius` (dp; `8 * corners` follows the user's corner style), `clip: true`
- `opacity`, `rotation` (degrees), `scale`, `offset: [x, y]` (dp), `visible`
- handlers: `onTap` (with `x`, `y`) and `onDrag` (with `dx`, `dy`, `x`, `y`). Long-press
  belongs to the home screen, which uses it to move and resize tiles
- `animate prop: spring()` or `tween(300ms, "linear"/"in"/"out"/"ease")`, for `value`,
  `opacity`, `rotation`, `scale`, `color` or `background`. For springs:
  `spring(damping, stiffness)`

`opacity`, `rotation`, `scale`, `offset`, colors and the contents of Canvas and
Shader apply at draw time. Changing them, even every frame, costs no layout.

Handlers assign state and run actions, separated by `;` or newlines:
`onTap: { count = count + 1; run("notify-send hi") }`

| action | does |
|---|---|
| `terminal("btop")` | opens the command in a terminal window; `terminal(cmd, "title")` |
| `app("gtk3-demo")` | starts a graphical Linux app |
| `run("cmd")` | runs in the background, then refreshes widgets |
| `url("https://...")` | opens in the Android browser |
| `launcher("themes")` | opens a launcher screen: `themes` (the style screen), `agents`, `store`, `drawer` or `linux` (the sheet that installs Linux); new launchers also take `style` for `themes`, older ones ignore it |
| `refresh()` | re-runs this widget's sources now |

## Components

```owl
component Stat(label, value, tint = accent) {
  Column { gap: 0
    Text { text: label; style: label }
    Text { text: value; style: title; color: tint }
  }
}
Row { Stat { label: "cpu"; value: "${cpu}%"; weight: 1 }  Stat { label: "mem"; value: mem; weight: 1 } }
```

Parameters are live expressions from the caller. Layout properties like
`weight` or `padding` at the use site wrap the component.

## Canvas

Drawing calls in dp, with `width`, `height` and `time` available. Angles are
degrees, with 0 at 12 o'clock, running clockwise.

```owl
Canvas {
  let r = min(width, height) / 2 - 4
  circle(width / 2, height / 2, r, stroke: border, width: 2)
  arc(width / 2, height / 2, r, 0, load * 3.6, stroke: accent, width: 6, cap: round)
  for i in range(12) {
    rotate(i * 30, width / 2, height / 2) { line(width / 2, 6, width / 2, 12, stroke: muted) }
  }
  text("${load}%", width / 2, height / 2, size: 18, align: center, color: foreground)
}
```

| call | |
|---|---|
| `rect(x, y, w, h)` | `radius:` |
| `circle(cx, cy, r)` | |
| `arc(cx, cy, r, start, sweep)` | filled arcs are pie slices |
| `line(x1, y1, x2, y2)` | |
| `path(points)` | points are `[x, y]` or `{x, y}`; `closed: true` |
| `text(s, x, y)` | `size:`, `color:`, `align: start/center/end`, `bold:`; y is the text's middle |
| `image(src, x, y, w, h)` | |
| `translate(x, y) { }`, `rotate(deg, cx, cy) { }`, `scale(sx, sy, cx, cy) { }`, `clip(x, y, w, h) { }`, `layer(alpha) { }` | apply to the calls inside |

Styles: `fill:` (a color or gradient), `stroke:`, `width:` (stroke width),
`cap: round/butt/square`. Without either, a shape is filled with `color:` or
the foreground. A widget that reads `time` animates every frame while it's on
screen, and only while it reads it: a `time` under an `if` that's false, like a
backdrop drawn only while music plays, costs nothing (older launchers
animate whenever `time` appears at all).

## Shader

A GPU fragment shader in AGSL (Android 13+; older phones show `fallback`).
Write `half4 main(float2 p)`. `size` (pixels) and `time` (seconds) are
declared for you. Declare your own uniforms and pass them in `uniforms`:
numbers become `float`, lists become `float2`–`float4`, colors become `half4`.

```owl
Shader {
  fallback: surface
  uniforms: { tint: accent, speed: 0.5 }
  code: """
    uniform half4 tint;
    uniform float speed;
    half4 main(float2 p) {
      float w = sin(p.x / size.x * 6.0 + time * speed) * 0.5 + 0.5;
      return half4(tint.rgb * w, 1.0);
    }
  """
}
```

## Dependencies

Declare every package your commands need, by package manager:

```owl
widget "grok" {
  requires { pacman: ["jq", "curl"] }
  source info = cmd('jq -c . ~/.cache/usage.json') every 5m json
  Text { text: "${info.use}%" }
}
```

- When a declared package is missing, the tile says `needs jq` with an **install** button
  instead of running the widget. That runs `pacman -Syu --needed`, the same way the system was
  set up. If it fails, the tile offers **fix with agent**.
- Names are package names, not program names (`dig` comes from `bind`). Find the owner of a
  program with `pacman -F dig` or `pacman -Qo $(command -v dig)`.
- Base tools (coreutils, grep, sed, bash) are always there; declaring them is optional.
- The launcher also reads the programs your fixed commands run. If one isn't installed and
  isn't covered by `requires`, `.errors/<file>.txt` gets a warning.
- While writing a widget, install what you declare with `pacman -S --needed <packages>`.

## Sharing

The **widget store** (long-press empty space on the home screen) installs reviewed widgets from
https://github.com/SimonSchubert/omarchy-widgets. To publish one, long-press it, tap **publish**,
and the default agent opens a pull request there with the GitHub CLI. The store needs:

- `meta` with a `description` (10-200 characters), a `version` and a `license`, and ideally a `category`:
  `news`, `dev`, `productivity`, `time`, `world`, `sport`, `finance`, `media`, `games`, `pets`, `fun`, `home` or `system`
- every package in `requires`
- values in commands as `${sh(value)}` (or numbers), so what a command runs is all in the file
- nothing personal: no tokens, personal paths or hard-coded location
- a higher `version` for each update

The repo's CI checks the rules and summarizes every command for the reviewer. Store installs go on
the page you're on; `page:` and `order:` in the file only apply to widgets you add yourself.

To pass a widget on without the store, share it as a link or QR code: the whole file is in it,
after the `#` of `https://simonschubert.github.io/omarchy-widgets/w#owl1.<data>` (raw DEFLATE, then
unpadded base64url), so it never reaches a server. One code holds about 2.9 KB of that, which most
widgets under 6 KB fit. Scanning it opens the launcher, which lists every command the widget runs and
flags risky ones before it adds it as `shared-<name>.owl`: nobody reviewed it. On Omarchy, the Widgets
app's **Share…** shows the code, and `omarchy-widgets share` / `omarchy-widgets import` make and read
links.

## Limits

A widget has at most 500 nodes, 2000 drawing calls per frame, lists of 1000
items, and a step budget per update. A widget that draws slowly animates at
half rate. Errors never take the home screen down: the failing value shows `…`
and the message goes to `.errors/`.

## Tips

- One small, focused widget per file; name files `NN-name.owl` to order them.
- Test commands in a terminal first. For several values, print JSON and use `json`.
- The phone is portrait: 6 columns, ~12 rows. A full-width widget is `6xN`,
  half-width `3xN`. Set `minSize` to what the layout still fits in.
- Use `weight: 1` to fill leftover space and `fill: width` to stretch across.
- A `Text` without `width`, `weight` or `fill` takes the full width. In a `Row`, give the Texts
  next to a `weight: 1` one a `width`, or the weighted one is squeezed to nothing.
- `tileWidth`, `tileHeight` (dp) are the tile's size, to pick a layout that fits:
  `let short = (tileHeight ?? 999) < 185`. Don't decide by `cols`, `rows` (grid cells): a row is
  a different number of dp on every phone, so a 3-row tile on a tall phone has room a check like
  `rows < 4` throws away. In landscape a tile can be taller than wide.
- `corners` is the user's corner style as a multiplier, not a radius: 0 (edge, square),
  0.5 (soft) or 1 (round). Multiply the radius a shape would have on round by it:
  `radius: 8 * corners` for cards and album art, `3 * corners` for small chips, and the same in
  Canvas (`rect(x, y, w, h, radius: 8 * corners)`). The tile and bordered Boxes follow it on
  their own; a fixed `radius`, a clipped Box, an Image or a Canvas shape doesn't. Needs
  `meta { owl: 6 }`. On the desktop it's always 0, since Omarchy is square.
- Look at the example widgets in this folder for patterns: `90-analog-clock` (Canvas),
  `91-focus` (state and buttons), `92-aurora` (Shader), `93-latency` (stream).
