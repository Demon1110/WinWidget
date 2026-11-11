# WinWidget Widget Guide

A widget is a folder: a `widget.json` file plus ordinary HTML, CSS and JavaScript. If you can build a web page, you can build a widget.

- [Your first widget in ten minutes](#your-first-widget-in-ten-minutes)
- [What's in the folder](#whats-in-the-folder)
- [widget.json](#widgetjson)
- [JavaScript API](#javascript-api)
- [Looks: follow the theme](#looks-follow-the-theme)
- [Dragging, menus and clicks](#dragging-menus-and-clicks)
- [Permissions](#permissions)
- [Debugging](#debugging)
- [Packaging and sharing](#packaging-and-sharing)
- [How a widget talks to the host (advanced)](#how-a-widget-talks-to-the-host-advanced)
- [Every API on one page](#every-api-on-one-page)
- [Three complete examples](#three-complete-examples)
- [Checklist before you hand a widget out](#checklist-before-you-hand-a-widget-out)
- [Questions](#questions)

---

## Your first widget in ten minutes

We'll make a "Daily quote" widget: one quote a day, a button for the next one, and quotes you can edit in the Control Center.

### 1. Create the widget (1 minute)

1. Click the tray icon to open the Control Center.
2. On the Control Center's **Add widgets** page, press **New widget…** at the top right (just a "+" when the window is narrow). Or right-click the tray icon → **Add widget** → **New widget…**.
3. Type the name `Daily Quote` and press **Create**.

WinWidget then:

- creates a folder in your widgets folder (for example `%AppData%\WinWidget\widgets\daily-quote`) with a working template in it;
- adds the widget to the desktop;
- turns on **developer mode**: from now on, saving a file in that folder reloads the widget on the desktop;
- opens the folder in File Explorer.

Open the folder in your editor. [VS Code](https://code.visualstudio.com/) is a good choice: thanks to the `widget.d.ts` file in the folder, it lists everything `widget.` offers as you type.

### 2. Add a setting (1 minute)

Open `widget.json` and replace the whole `settings` part with:

```json
"settings": [
  { "key": "quotes", "type": "textarea", "label": "Quotes (one per line)",
    "default": "Slow is smooth, smooth is fast.\nEat a proper lunch today.\nDone beats perfect." }
]
```

Save. In the Control Center, open **My widgets**, pick "Daily Quote" and its **Content** tab: there's a text box with the three quotes. WinWidget builds that form from `settings` on its own.

### 3. Build the page (3 minutes)

Replace `index.html` with:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="w-label" id="day"></div>
  <p class="quote" id="quote"></p>
  <button class="w-btn" id="next">Next</button>
  <script src="main.js"></script>
</body>
</html>
```

Replace `style.css` with:

```css
body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quote {
  flex: 1;
  margin: 0;
  font-size: 1.3rem;
  line-height: 1.5;
}

#next {
  align-self: flex-end;
}
```

`<body>` is the card itself. `w-label` and `w-btn` come with WinWidget; the theme supplies the background, corners, fonts and colors, so you don't write any of that.

### 4. Add the logic (3 minutes)

Replace `main.js` with:

```js
const $ = (id) => document.getElementById(id);
let quotes = [];
let index = 0;

function show() {
  const quote = quotes.length ? quotes[index % quotes.length] : "Add quotes in the Control Center";
  $("quote").textContent = quote;
  $("day").textContent = new Date().toLocaleDateString(widget.locale, {
    month: "long", day: "numeric", weekday: "long",
  });
}

// Read the setting: one quote per line
function load(settings) {
  quotes = settings.quotes.split("\n").map((s) => s.trim()).filter(Boolean);
  show();
}

// A new quote every day; if "Next" was pressed today, remember where it got to
const today = new Date().toDateString();
widget.storage.get("pick").then((pick) => {
  const dayNumber = Math.floor(Date.now() / 86400000);
  index = pick && pick.day === today ? pick.index : dayNumber;
  load(widget.settings.get());
});

// The quotes changed in the Control Center: show them right away
widget.settings.onChange(load);

$("next").addEventListener("click", () => {
  index++;
  widget.storage.set("pick", { day: today, index });
  show();
});
```

Save, and the widget on the desktop changes at once. Try:

- pressing **Next**;
- editing the quotes in the Control Center: the desktop updates as you type;
- switching to another theme under **Themes**: fonts and colors follow;
- restarting WinWidget: today's quote is still the one you picked (`widget.storage` keeps it).

### 5. When something breaks (1 minute)

In developer mode, a script error shows as a red bar at the bottom of the card with the message and where it happened (for example `main.js:12`). Click the bar to open the developer tools, or press **F12** on the widget. Fix it, save, and the bar goes away.

### 6. Share it (1 minute)

Control Center → **Add widgets** → your widget's card → **Export .fwz**. Anyone can install it by double-clicking the `.fwz` file (or dropping it on the Control Center window).

To let everyone find it under **Online** in the Control Center, submit it to the [widget market](https://hmgvibe.github.io/fullwidget-market/): put the widget folder in `widgets/<your-github-name>.<widget>/` of the [fullwidget-market](https://github.com/hmgvibe/fullwidget-market) repository on GitHub and open a pull request. Once the automatic check passes and a maintainer has looked at it, it goes live; CONTRIBUTING.md there has the details.

---

## What's in the folder

| File | What it's for |
|---|---|
| `widget.json` | Name, size, permissions and settings. **Required.** |
| `index.html` | The widget's page (the `entry` in `widget.json` can name another file). |
| `style.css`, `main.js` | Styles and logic. Any names work; link them from the HTML with relative paths. |
| `icon.svg` | Shown in the gallery, tray menu and Control Center (a 24×24 SVG works best). |
| `widget.d.ts`, `jsconfig.json` | Only for your editor, so it can suggest `widget.` calls. |

Widgets folder: `%AppData%\WinWidget\widgets\`. Open it from Control Center → **Settings** → **Widgets folder**. Put a widget folder in there and it shows up under **Add widgets** (by itself in developer mode; otherwise press **Rescan**).

Save files as **UTF-8**.

---

## widget.json

`//` comments are allowed, and so is a comma after the last item.

```json
{
  "id": "me.daily-quote",
  "name": { "en": "Daily Quote", "zh-TW": "每日一句", "zh-CN": "每日一句" },
  "description": "One quote a day",
  "version": "1.0.0",
  "author": "Your name",
  "entry": "index.html",
  "icon": "icon.svg",
  "category": "info",
  "size": {
    "width": 280, "height": 160,
    "minWidth": 200, "minHeight": 120, "maxWidth": 600, "maxHeight": 400,
    "resizable": true
  },
  "layer": "desktop",
  "permissions": [],
  "settings": []
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique id: lowercase letters, digits and `. _ -`, 2–64 characters, e.g. `me.daily-quote`. Don't change it later: saved data and updates depend on it. Ids starting with `winwidget.` are for built-in widgets. |
| `name` | recommended | Display name: plain text, or per language: `{ "en": "…", "zh-TW": "…" }`. |
| `description` | | One line for the gallery. Also per language if you like. |
| `version` | recommended | e.g. `1.2.0`. Installing a `.fwz` uses it to tell an update from a reinstall or an older version. |
| `author` | | Who made it. |
| `entry` | | The page file; `index.html` by default. |
| `icon` | | Icon file. Without one, the first letter of the name is shown. |
| `category` | | Where the widget library lists it: `time`, `weather`, `system`, `productivity`, `info` or `media` (media & decor). Anything else, or nothing, goes under "Other". |
| `preview` | | A picture for the widget library card, e.g. `"preview.png"`. You can give one per theme and language: `"preview/{theme}.{lang}.webp"`, where `{theme}` becomes the theme id (`instrument`, `type`, `paper`) and `{lang}` becomes `zh-TW`, `zh-CN` or `en`; a missing one is replaced by the same theme in another language, or by another theme. Use a PNG or WebP with a transparent background, about 300 pixels wide. Without a preview the card shows the icon. |
| `size` | | Card size in pixels (without the shadow). `width`/`height` is the size when first added; `min*`/`max*` limit resizing; `resizable: false` turns resizing off; `grow` (0–1) says whether the content grows when the card is made bigger than its default size, see [Content that grows with the card](#content-that-grows-with-the-card). |
| `layer` | | Layer when first added: `desktop` (default: under all windows, still visible after Win+D), `normal`, or `top` (always on top). Users can change it. |
| `permissions` | | What it needs to do; see [Permissions](#permissions). |
| `settings` | | Its settings. The Control Center builds a form from them. |

### settings

Each setting:

```json
{
  "key": "city",
  "type": "text",
  "label": "City",
  "description": "Leave empty to detect it",
  "default": ""
}
```

| Field | Meaning |
|---|---|
| `key` | The name in code: `widget.settings.get("city")`. |
| `type` | See the table below. |
| `label` | Shown on the form. Can be given per language. |
| `description` | A short line under the label. |
| `default` | Starting value. Any type can be given per language, e.g. `{ "zh-TW": "google", "zh-CN": "baidu", "en": "google" }`. |
| `placeholder` | Hint text inside an empty box. |
| `min` `max` `step` | For `number` and `slider`. |
| `options` | For `select`: `[{ "value": "c", "label": "Celsius" }, { "value": "f", "label": "Fahrenheit" }]`. |

| type | Form control | Value |
|---|---|---|
| `toggle` | Switch | `true` / `false` |
| `text` | One line of text | string |
| `textarea` | Several lines | string (lines joined with `\n`) |
| `number` | Number box | number |
| `slider` | Slider | number |
| `select` | Drop-down (up to three short options show as buttons) | the option's `value` |
| `color` | Color picker | `"#rrggbb"` |
| `font` | Font (from the installed fonts) | font name; `null` when cleared (usually means the theme's font) |
| `date` | Date | `"2026-12-31"` |
| `folder` | Folder (its path and a "Choose…" button) | a full path; the default may use environment variables, e.g. `"%USERPROFILE%\\Pictures"`. See [`widget.files`](#a-folder-the-user-chose-widgetfiles) |

---

## JavaScript API

WinWidget sets up the global `widget` before your script runs: nothing to import. Full types and notes are in `widget.d.ts`.

Anything that waits (saved data, network…) returns a Promise, so you can `await` it.

### Basics

```js
widget.id          // "me.daily-quote"
widget.instanceId  // this copy on the desktop (a widget can be added several times)
widget.locale      // the user's language, e.g. "en-US"; use it for dates and numbers
widget.theme       // current theme: "instrument", "type" or "paper"
widget.developer   // true in developer mode
widget.permissions // permissions usable right now

// Pick the text for the user's language
widget.t({ en: "Good morning", "zh-TW": "早安", "zh-CN": "早安" })
```

### Settings: `widget.settings`

```js
// Reading is synchronous: no await
const all = widget.settings.get();         // { quotes: "…", … }
const one = widget.settings.get("quotes");

// The user changed a setting in the Control Center
widget.settings.onChange((all) => { /* … */ });

// Code can change one too; the Control Center shows the new value
await widget.settings.set("quotes", "…");
```

### Saved data: `widget.storage`

Kept across restarts and removed together with the widget. Each copy on the desktop has its own. Up to 2 MB per copy.

```js
// Any JSON data
await widget.storage.set("todo", [{ text: "Buy milk", done: false }]);

// null if it was never saved
const todo = (await widget.storage.get("todo")) || [];

await widget.storage.remove("todo");
const keys = await widget.storage.keys();
```

### System figures: `widget.system` (needs `system`)

```js
const stop = widget.system.subscribe(["cpu", "memory"], (d) => {
  cpu.textContent = Math.round(d.cpu.usage) + "%";
  mem.textContent = Math.round(d.memory.usage) + "%";
}, { interval: 2000 });  // every 2 s (default 1 s); the first update comes at once

stop(); // when you no longer need it
```

| Topic | Contents |
|---|---|
| `cpu` | `usage` (%), `cores` |
| `memory` | `usage` (%), `total`, `used`, `available` (bytes) |
| `network` | `down`, `up` (bytes per second), `totalDown`, `totalUp` |
| `disk` | one entry per drive (USB drives too): `name` ("C:"), `label`, `type` (`fixed` / `removable`), `total`, `free`, `usage` (%) |
| `battery` | `present`, `percent`, `charging`, `pluggedIn`, `secondsLeft`, `saver` (battery saver) |

However many widgets subscribe, WinWidget samples once and shares the result. Hidden or paused widgets get nothing and cost nothing.

For things that rarely change, ask once:

```js
const pc = await widget.system.info();
// pc.os.name "Windows 11 Pro", pc.os.version "25H2", pc.cpu.name, pc.memory.installed (bytes),
// pc.gpus (graphics adapters), pc.computer (PC name), pc.uptime (milliseconds since start)

const net = await widget.system.adapters();
// net.online; net.adapters[0] is the one on the internet: name "Wi-Fi", type "wifi", ipv4, gateways, dns

const r = await widget.system.ping("1.1.1.1");   // { ok, ms, status }; at most once a second per widget
```

### Volume: `widget.audio` (needs `audio`)

```js
const stop = widget.audio.onChange((a) => {
  // a.volume 0–100, a.muted, a.device ("Speakers (Realtek Audio)")
  // called at once on volume keys, the taskbar slider, or switching to headphones
});
await widget.audio.set({ volume: 40 });
await widget.audio.set({ muted: true });
```

### Now playing: `widget.media` (needs `media`)

Reads what's playing in Windows' media controls (Spotify, browsers, the Media Player app… the same as the volume flyout shows) and controls it:

```js
widget.media.onChange((m) => {
  if (!m.available) return;          // nothing is playing
  // m.title, m.artist, m.album, m.app.name ("Spotify"), m.app.icon
  // m.playing, m.position, m.duration (ms), m.cover (the album art's address, ready for an <img>)
  // m.can.next, m.can.previous, m.can.seek: which buttons the app accepts right now
});
const now = widget.media.position(m);   // where playback is now (it moves on while playing)
await widget.media.toggle();            // play / pause; also play(), pause(), next(), previous()
await widget.media.seek(60000);         // jump to 1:00
// timed lyrics of the current song, looked up on NetEase Cloud Music, QQ Music and Kugou
const { title, lyrics } = await widget.media.lyrics();
if (lyrics.found) lyrics.lines;         // [{ t: ms, text, tr?: translation }], in order
```

Windows reports every change at once (a new track, pause, another app starting to play), so there is nothing to poll.

### A folder the user chose: `widget.files`

Add a setting of type `folder`. Once the user picks a folder, the widget can read the pictures in it. **Choosing the folder is the permission**: nothing goes in `permissions`.

```json
{ "key": "folder", "type": "folder", "label": "Photo folder", "default": "%USERPROFILE%\\Pictures" }
```

```js
const { files } = await widget.files.list("folder", { recursive: true });
// files: [{ path: "2025/beach.jpg", name: "beach", size, modified, url }]
img.src = widget.files.url(files[0], { width: 800 });   // a smaller copy made by Windows: fast, and light on memory
const { taken } = await widget.files.info("folder", files[0]);  // when the camera took it, or null
await widget.files.pick("folder");      // opens the folder dialog from the widget and saves the choice
```

- Only pictures in that folder (and its subfolders): jpg, png, gif, webp, bmp, avif, heic, tif; up to 5000.
- For someone else's widget, the folder in `default` doesn't count: it can read only after the user has picked one. Built-in widgets and your own can use the default.
- Folder values may contain environment variables such as `%USERPROFILE%`.

### Network: `widget.fetch` (needs `network:` permissions)

Like the browser's `fetch`, but sent by WinWidget, so CORS doesn't apply:

```js
const r = await widget.fetch(
  "https://api.open-meteo.com/v1/forecast?latitude=25&longitude=121&current=temperature_2m"
);
if (r.ok) {
  const data = await r.json();
}

await widget.fetch("https://example.com/api", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: { hello: "world" },   // objects are sent as JSON
});
```

The response has `ok`, `status`, `statusText`, `url`, `headers`, `body` (text), `text()` and `json()`. For binary content such as images pass `{ as: "base64" }` and `body` holds base64 text. Up to 8 MB per response; redirects are followed, and every hop must be allowed.

### Opening links: `widget.shell.open` (needs `shell.open`)

```js
// Opens in the default browser; mailto: works too
widget.shell.open("https://example.com");
```

A widget page can't navigate away or open windows itself; use this to open web pages.

### Opening programs and files: `widget.shell.launch` (needs `shell.launch`)

```js
await widget.shell.launch("C:\\Windows\\notepad.exe");    // programs, shortcuts, folders, documents; no arguments

const path = await widget.shell.pick({ type: "file", filter: "programs" }); // the user chooses; null if cancelled
const info = await widget.shell.info(path);  // { name: "Notepad", kind: "app", icon: "data:image/png;…" }

// full paths of files dropped on the widget
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  const paths = await widget.shell.paths(e.dataTransfer.files);
});
```

`pick` takes `type` `file` or `folder`, and `filter` `programs`, `images` or `all`.

### Simplified ↔ Traditional Chinese: `widget.convertChinese`

```js
await widget.convertChinese("北极熊和幼崽", "traditional");  // "北極熊和幼崽"
```

Character by character with Windows' own tables: good for short text such as a headline fetched in Simplified Chinese; regional word choices are not changed. No permission needed.

### Notifications: `widget.notify` (needs `notify`)

```js
// A Windows notification right now (the title defaults to the widget's name)
widget.notify("Download finished");

// Booked for later; a new booking with the same tag replaces the old one
widget.notify({ title: "Pomodoro", body: "Take a break", at: Date.now() + 25 * 60 * 1000, tag: "end" });

widget.notify.cancel("end"); // cancels that booking; without a tag, all of this widget's bookings
```

WinWidget keeps the time for bookings, so they arrive on time even while the widget is paused by a full-screen app or "Hide all widgets". Bookings can be up to 7 days ahead, 20 per widget; after the PC wakes from sleep, bookings more than 15 minutes late are dropped.

### The window: `widget.window`

```js
const { width, height } = await widget.window.getSize();
await widget.window.setSize(320, 200);   // kept within the min/max in size
```

### Looks and events

```js
// Current theme and appearance values
widget.appearance.get();

// The theme or appearance changed (CSS variables are already updated)
widget.appearance.onChange((a) => {});

// Locked, layer or click-through changed: { locked, layer, clickThrough }
widget.on("state", (s) => {});

// Called up with a shortcut (the notes and to-do shortcuts, for winwidget.notes and winwidget.todo): focus your main input
widget.on("summon", () => {});

// Write to the WinWidget log
widget.log("message", { any: "data" });
```

---

## Lifecycle: ready → show → hide → unload

From being loaded to being removed, a card gets its events in a fixed order. Subscribe to all of them with `widget.on(name, callback)`; the return value unsubscribes.

| Event | When it comes | Payload |
|---|---|---|
| `ready` | The page is up — one task after DOMContentLoaded, so a subscription made in a DOMContentLoaded handler still hears it | `{ visible }` |
| `show` | The card came on screen. **The startup show counts too**, with `initial: true` | `{ from, visible: true, initial }` |
| `hide` | The card left the screen: hide all, the tray, a full-screen app, `window.hide()` | `{ from, visible: false, initial: false }` |
| `resize` | The card's size changed (resize grip, the Control Center). Bursts are **debounced 80 ms** and only the size it settles on is reported | `{ width, height }` in CSS pixels |
| `unload` | The card is being removed, or the app is quitting | `{ kill: true }` |

`from` says who caused the show or hide:

| `from` | Who |
|---|---|
| `startup` | Came up with the app at launch |
| `tray` | The tray menu (hide/show all, hide/show one card) |
| `control` | The Control Center (Locate, the hide-all switch) |
| `hotkey` | Brought up by a global shortcut |
| `fullscreen` | A full-screen app made this card step aside, or it came back |
| `api` | The card called `widget.window.show()` / `hide()` itself |

### Ordering guarantees

1. `ready` always comes before the first `show`. Put one-time startup work in `ready` and `show` cannot cut in front of it.
2. A card that is already on screen (the default at launch) gets `show{ initial: true }` right after `ready`; one that starts hidden (hide-all is on) gets nothing until it is really shown.
3. `show` and `hide` come in pairs, and the same state is never repeated: `hide` after `hide` is not sent twice, nor is `show` after `show`. `widget.visible` always tells you where you are.
4. `hide` arrives while the card is still alive; `unload` means this time it is really leaving. Do-once work (save, clear timers) belongs in `unload`; pausing animation belongs in `hide`.

```js
// Cheap while running: stop when invisible, recompute when back
let timer = 0;
function start() {
  if (timer || !widget.visible) return;
  timer = setInterval(tick, 1000);
  tick();
}
function stop() {
  clearInterval(timer);
  timer = 0;
}

widget.on("ready", () => start());
widget.on("show", ({ from, initial }) => {
  widget.log("shown", from, initial);   // from, see the table above
  start();
});
widget.on("hide", () => stop());
widget.on("unload", ({ kill }) => {
  stop();
  if (kill) widget.storage.set("lastSeen", Date.now());
});

// Re-layout when the size changes (no need for window resize: that is the window, with DPI math)
widget.on("resize", ({ width }) => {
  document.body.dataset.compact = width < 260 ? "1" : "";
});
```

`widget.visible` is the current state, kept in step by `show` / `hide`. A card deliberately never takes the keyboard focus, so there is no focus / blur event: a widget that needs typing puts an input in its own page, and the user clicks it.

### Against the seven uTools events

uTools' events are a "plugin vs main window" model; a WinWidget card is its own top-level window, so only the same-shaped ones line up:

| uTools | WinWidget | Difference |
|---|---|---|
| `onPluginReady(cb)` | `widget.on("ready", cb)` | Once, after load, same. uTools waits for the returned Promise; here it does not — use `utools.onPluginReady` when you need "wait before entering" |
| `onPluginEnter(cb)` | `widget.on("show", cb)` | Same payload shape below; fires on every show, not only the first |
| `onPluginOut(cb)` | `widget.on("hide", cb)` and `widget.on("unload", cb)` | `hide` is `isKill: false`, `unload` is `isKill: true` |
| `onPluginDetach(cb)` | none | A card is already a separate window: there is no detach step. `utools.onPluginDetach` registers but never calls back |
| `onScheduleTrigger(cb)` | none | No scheduler. Use `setInterval` in the page, and stop it on `hide` |
| `onMainPush(cb, onSelect?)` | none | No uTools-style search box to push results into |
| `onDbPull(cb)` | none | No cross-device sync; data stays in local `widget.storage` |

`utools.onPluginEnter` gets its payload in uTools' `PluginEnterAction` shape: `{ code, type: "text", payload: "", from }`, with `from` in uTools' vocabulary (`main` / `panel` / `hotkey` / `redirect`), mapped from the table above: `startup`, `fullscreen` → `main`; `tray` → `panel`; `hotkey` → `hotkey`; `control`, `api` → `redirect`. `option` only exists when the enter came from a pushed result, which never happens here.

---

## Looks: follow the theme

WinWidget comes with several themes, and users can adjust background, text color, accent color, font, text size, corners, padding and opacity in the Control Center. Use the variables and classes below and all of that just works for your widget.

### Layout

- `<body>` is the card: background, corners, border and padding are already set. Put your content straight into `<body>`.
- `<html>` is the transparent window with room for the shadow around the card; don't give it a background.
- Size text in `rem`: when users change the text size, `1rem` follows (14px by default).
- Cards can be resized. Lay out with flex or grid; to adapt to size, set `container-type: size` on `body` and use `@container (max-height: 100px) { … }`. `@container` rules style what is inside `body`, not `body` itself.

### Content that grows with the card

Add `"grow": 1` to `size` in `widget.json`, and when the user makes the card bigger than its default size, the whole content is magnified with it (text, icons and spacing alike) instead of leaving empty space:

```json
"size": { "width": 260, "height": 150, "minWidth": 180, "minHeight": 110, "grow": 1 }
```

- The factor is the smaller of "how many times wider" and "how many times taller", at most 3. At twice the width and 1.3 times the height the content grows 1.3 times, and your layout gets the extra width.
- Below the default size nothing shrinks: small sizes are up to your layout (`@container`, above).
- `grow` may be anything from 0 to 1: for lists, `0.5` makes the text a little bigger while showing more items.
- Leave it out (or `0`) to keep the old behaviour: more room, same size.
- The card's corners, outline and shadow don't grow. The current factor is in the CSS variable `--w-size-scale`.

### CSS variables

| Variable | Use |
|---|---|
| `--w-fg` | Main text color |
| `--w-fg-muted` | Secondary text (labels, notes) |
| `--w-fg-faint` | Very faint text and dividers |
| `--w-accent` | Accent: progress, selection, key figures |
| `--w-on-accent` | Text on top of the accent color |
| `--w-warn` `--w-danger` | Warnings, danger |
| `--w-bg` | Card background (already on body) |
| `--w-bg-solid` | The card colour without transparency: for things that must hide what's behind them, such as a pop-up list |
| `--w-border` `--w-rule` | Borders, dividers |
| `--w-track` | Background of progress bars |
| `--w-control-bg` `--w-hover` | Input background, hover background |
| `--w-font` | Body font |
| `--w-font-num` | Font for figures |
| `--w-font-display` | Font for the widget's one big figure (time, temperature) |
| `--w-font-title` | Font for headings |
| `--w-radius` `--w-padding` | Card corners, padding |

### Ready-made classes

| class | Use |
|---|---|
| `w-label` | Small, muted label text |
| `w-title` | Heading |
| `w-num` | Figures (tabular, the theme's figure font) |
| `w-display` | The one big figure |
| `w-rule` | Divider (on an `<hr>` or `<div>`) |
| `w-bar` | Progress bar: `<div class="w-bar"><i style="width:40%"></i></div>`; add `is-warn` for the warning color |
| `w-input` | Text input |
| `w-btn` | Button; add `is-primary` for an accent button |
| `w-check` | Round check box: `<button class="w-check" aria-pressed="true">` |

### Per-theme touches

`<html>` carries these attributes for styles of your own:

```css
/* one particular theme */
html[data-theme="paper"] .quote { font-style: italic; }

/* the user picked frosted cards */
html[data-style="frosted"] .quote { letter-spacing: 0.02em; }

/* the widget is locked */
html[data-locked="true"] #next { display: none; }
```

Users can also add CSS to a single widget under Look → Custom CSS in the Control Center; it comes after yours.

### Saving power: don't animate what updates every second

Widgets stay open all day, and every frame drawn costs something. A figure or bar that updates every second with a 0.5-second `transition` is animating nearly all the time: one widget can use 20% of a CPU core that way, against 1% without.

- No `transition` or `animation` on anything that updates every second or faster. `w-bar` animates its width for 0.5 s by default; for bars updated every second add `.w-bar > i { transition: none; }`.
- No `animation: … infinite`; to blink for attention, give a count (such as `8`).
- Hands, dials and anything else that turns: put it on its own element and turn it with a CSS `transform`, rather than redrawing a whole SVG every second.
- What changes once a minute, update once a minute (`setTimeout` to the next minute).

---

## Dragging, menus and clicks

WinWidget handles these for you:

- **Dragging**: press anywhere on the card and drag to move the widget. Buttons, links and inputs don't start a drag; add `data-no-drag` to anything else that shouldn't.
- **Right-click** shows the WinWidget widget menu. Add `data-no-menu` where you want to handle right-clicks yourself.
- **Resizing**: unless `size.resizable` is `false`, there's a grip in the bottom-right corner.
- **Locking**: a locked widget can't be moved or resized; check `widget.locked` or `html[data-locked]`.

---

## Permissions

By default a widget can only show its own content: it can't go online, can't read system figures and can't touch files on the PC. To do more, list what it needs under `permissions` in `widget.json`:

| Permission | Allows |
|---|---|
| `system` | `widget.system`: processor, memory, network, disk, battery |
| `network:api.example.com` | Connecting to that site |
| `network:*.example.com` | Connecting to example.com and all its subdomains |
| `network:*` | Connecting to any site (users see a clear warning when installing; avoid it if you can) |
| `shell.open` | `widget.shell.open`: opening links in the browser |
| `notify` | `widget.notify`: showing Windows notifications |
| `audio` | `widget.audio`: reading and changing the system volume and mute |
| `media` | `widget.media`: what's playing (title, cover) and play, pause, skip |
| `clipboard` | `widget.clipboard`: reading and writing the clipboard's text (users see a clear warning when allowing it) |
| `screen` | `widget.screen.capture`: taking the whole screen as a picture (users see a clear warning when allowing it) |
| `shell.launch` | `widget.shell.launch`, `pick`, `save`, `reveal`, `trash`, `info`, `paths`, `fileIcon`: opening programs and files, choosing files, choosing where to save, showing a file in Explorer, moving it to the recycle bin, reading names and icons (users see a clear warning when allowing it) |

Reading a folder needs no permission: the widget can read only the pictures in the folder the user chose in its settings. See [`widget.files`](#a-folder-the-user-chose-widgetfiles).

**Who allows them:**

- Widgets made with **New widget** are yours, so what they declare works right away.
- Other people's widgets list their permissions when installed; pressing **Install** allows them. If an update asks for more, the user is asked again, and the new ones don't work until then.
- A widget folder copied straight into the widgets folder asks the user the first time it's added to the desktop.

**Network rules:** this covers more than `widget.fetch`: images, fonts, scripts, `fetch()` and WebSockets in the page can also only reach allowed sites. The difference is that a plain `fetch()` needs the site to allow CORS, and `widget.fetch` doesn't.

---

## Debugging

Turn on **developer mode** under Control Center → **Settings** (**New widget** turns it on for you). Then:

- **Reload on save**: saving any file in a widget's folder reloads the widgets that use it; changes to `widget.json` (size, settings) apply at once too.
- **Error bar**: script errors show at the bottom of the card with where they happened; click to open the developer tools.
- **Developer tools**: press F12 on the widget, or use My widgets → Behavior → Developer tools. F5 reloads.
- **Log**: `widget.log()` output and widget errors go to `%LocalAppData%\WinWidget\logs\app.log`.
- **Folders that don't load**: if `widget.json` has a problem (a missing comma, a bad id, no entry file), the top of **Add widgets** names the folder, the line and the reason.

**Command line** (run in a terminal; acts on the running WinWidget):

```bat
WinWidget.exe --cmd="reload me.daily-quote"
WinWidget.exe --cmd="devtools me.daily-quote"
WinWidget.exe --cmd="add me.daily-quote"
WinWidget.exe --cmd="rescan"
WinWidget.exe --cmd="export me.daily-quote D:\out\daily-quote.fwz"
WinWidget.exe D:\downloads\daily-quote.fwz
```

`reload` and `devtools` also take the id of one copy on the desktop (shown as **ID** under Behavior).

---

## Packaging and sharing

A `.fwz` file is a widget folder zipped up with another extension.

- **Export**: Control Center → **Add widgets** → your widget's card → **Export .fwz**. Hidden files and folders (such as `.git`) and `node_modules` are left out.
- **Install**: double-click a `.fwz` file, drop it on the Control Center window, or press **Install .fwz file…** under **Add widgets**. The name, author, version and permissions are shown before anything is installed.
- **Update**: raise `version` and export again. A widget with the same `id` is replaced; copies on the desktop keep their settings and saved data, and the old version goes to the Recycle Bin.
- **Frameworks**: React, Vue, Svelte and others all work, as long as the output is static files. Put the build output (e.g. `dist/`) next to `widget.json`, point `entry` at its `index.html`, and use relative asset paths (with Vite, `base: "./"`).
- **Limits**: a `.fwz` can be up to 64 MB, and at most 256 MB and 5000 files unpacked.

---

## Where uTools plugins stand (how far compatibility goes)

A uTools plugin is an Electron app: `plugin.json`, a `preload.js` that runs with Node (`require("fs")`, Sharp and FFmpeg installed there), and a page. WinWidget is Rust + WebView2 — **no Electron, no Node** — so a uTools plugin cannot be dropped in unchanged. What can be carried over is the page plus the `utools.*` calls it makes: every widget page gets a `utools` compatibility layer (`/__fw/utools.js`) wired to WinWidget's own capabilities.

### Bringing an existing uTools plugin's screen in

1. Put the plugin's `index.html`, CSS and JS into a widget folder;
2. declare the permissions it actually uses in `widget.json` (`showNotification` → `notify`, `copyText` → `clipboard`, `captureScreen` → `screen`, `shellOpenPath` → `shell.launch`, `shellOpenExternal` → `shell.open`);
3. the `utools.*` calls are answered by the compatibility layer, no code changes needed.

**Don't expect** `preload.js`, `require(...)`, `process`, `ipcRenderer`, `fs` or `child_process`: they do not exist here, and a copied preload just leaves the page blank.

### Ask first whether an API exists

```js
if (utools.__compat.supports("captureScreen")) {
  const png = await utools.captureScreen();        // PNG data URL
} else {
  document.body.textContent = "this host cannot capture the screen";
}
console.log(utools.__compat.degraded);    // there, but the semantics changed
console.log(utools.__compat.unsupported); // not there at all
```

### Category by category, as the uTools docs list them

| uTools category | What WinWidget gives you |
|---|---|
| Events | `onPluginReady`, `onPluginEnter`, `onPluginOut(isKill)` all exist, in uTools' order (ready finishes, then enter; hidden is `false`, removed/quit is `true`); `onPluginDetach` registers but never fires, and `onScheduleTrigger` / `onMainPush` / `onDbPull` throw `utools.unsupported` on registration. The host's own lifecycle events are in the Lifecycle chapter |
| Window | `hideMainWindow`, `showMainWindow`, `outPlugin`, `getWindowType`, `setExpendHeight` (height only, and asynchronous) |
| System | `showNotification`, `shellOpenPath`, `shellOpenExternal`, `shellShowItemInFolder`, `shellTrashItem`, `shellBeep`, `getPath`, `getFileIconAsync`, `showOpenDialog`, `showSaveDialog`, `isDev`, `isWindows` and friends; `getPluginLocalDataPath` returns an empty string (there is no filesystem) |
| Screen | `captureScreen()` grabs the whole virtual desktop as a PNG data URL (needs the `screen` permission); uTools' interactive snipping is not reproduced |
| Input | Absent: uTools' `simulate` family (keyboard and mouse injection) is not in the layer |
| Copy | `copyText` works (`clipboard` permission); `copyImage` and `getCopyedFiles` do not — the clipboard is text only |
| Database | `dbStorage.getItem` / `setItem` / `removeItem` / `clear`, synchronous, kept in this widget's local storage; **no cloud sync**, and uTools' document store `db` (with `_id`) is absent |
| AI | Absent: no uTools account, no cloud models, no Node to reach a local one |
| Scheduled tasks | No uTools scheduler; use `widget.notify({ at })` or the page's own timers |
| Automation / simulation | Absent |
| Dynamic features | Absent |
| Quick entries | Absent: WinWidget is a desktop widget host; its entries are the tray and the control center |
| uBrowser | No embedded browser window; open links with `utools.shellOpenExternal` or `widget.shell.open` |
| Sharp image processing | Absent: native modules cannot be loaded; use Canvas, or let the host do it |
| FFmpeg audio/video | Absent |
| Payments | Absent |

Nothing missing fails quietly: calling it throws an error whose `code` is `"utools.unsupported"` and whose message names the API and the reason — far easier to chase than `TypeError: utools.xxx is not a function`.

### New widgets should not go through uTools

The layer exists for pages already written against uTools. A new widget should use `widget.*`: complete types (`widget.d.ts`), the permission model, theme awareness and clear errors. Where both exist, `widget.*` is the real path and `utools.*` is the compatibility path.

## How a widget talks to the host (advanced)

Everything above is enough to build a complete widget. This chapter is for people who want to know how it actually runs: where the page comes from, what the host hands it, which messages exist, and where the data lives.

### How the page is opened

WinWidget does not open your `index.html` from `file://`. It runs a small HTTP server bound to `127.0.0.1` and serves the page:

```
http://127.0.0.1:<port>/__fw/<widget id>/index.html
```

- **The port changes on every start**, so always use relative paths (`style.css`, `main.js`, `img/a.png`) — never a hard-coded `127.0.0.1:8800`.
- Each widget type has its own origin, `<widget id>.widgets.localhost`, so `localStorage`, `IndexedDB` and `Cache` are separated per widget type, shared by all its instances.
- The page cannot navigate elsewhere or open a new window; use `widget.shell.open` for web pages.
- Images, fonts and scripts the page loads are bound by the same `network:` permissions.

### What the host hands you at startup

Before any of your scripts run, the host puts this in `window.__FW_BOOT__`:

| Field | Meaning |
|---|---|
| `settings` | every setting of this instance (language objects already folded) |
| `appearance` | `theme`, `style`, `shadow`, `themeCss`, `themeHref`, `userCss`, … |
| `locked` | whether the user locked it |
| `layer` | `desktop` / `normal` / `top` |
| `clickThrough` | click-through on or off |
| `state` | `{ edit, label }`: arrange mode, the name label on the card |
| `developer` | developer mode on or off |
| `locale` | the user's language, e.g. `zh-TW` |
| `permissions` | what is actually allowed right now |
| `hostVersion` | WinWidget version, e.g. `1.0.0` |
| `widgetId` / `instanceId` | the widget id, and this card's own id |
| `size` | `{ width, height, grow }` — the default size |
| `resizable` | whether the card can be resized |

`widget-sdk.js` builds `window.widget` from that, which is why `widget` is already there in the first line of `main.js`.

### The message protocol

Every `widget.*` call is a message. When something behaves oddly, watching the messages is the fastest way to understand it:

```js
// call: { id, m, p }; the host answers { id, r } or { id, e: "error text" }
chrome.webview.postMessage(JSON.stringify({ id: 7, m: "storage.get", p: { key: "todo" } }));

// no answer needed (dragging, the context menu): { m, p }
chrome.webview.postMessage(JSON.stringify({ m: "window.menu" }));

// the host pushes: { ev: "settings" | "appearance" | "state" | "system" | "audio" | "media" | "identify", d: … }
chrome.webview.addEventListener("message", (e) => console.log(e.data));
```

Day to day you use the SDK; this layer exists for debugging. SDK error messages carry their target, e.g. `HTTP 404 (https://api.example.com/x)`.

### Every method the host offers

The SDK wraps all of these. The table shows the underlying names so you can match them in DevTools:

| Message `m` | Same as |
|---|---|
| `settings.set` | `widget.settings.set(key, value)` |
| `storage.get` / `set` / `remove` / `keys` | `widget.storage.*` |
| `system.subscribe` / `unsubscribe` / `history` / `info` / `adapters` / `ping` | `widget.system.*` |
| `audio.get` / `set` / `subscribe` / `unsubscribe` | `widget.audio.*` |
| `media.get` / `control` / `lyrics` / `subscribe` / `unsubscribe` | `widget.media.*` |
| `files.list` / `info` / `pick` | `widget.files.*` |
| `recycle.query` / `empty` / `open` | `widget.recycleBin.*` (built-in widgets only) |
| `power.do` | `widget.power(action)` (built-in widgets only) |
| `net.fetch` | `widget.fetch(url, options)` |
| `notify.show` / `cancel` | `widget.notify(...)` |
| `shell.open` / `launch` / `info` / `pick` / `save` / `reveal` / `trash` / `paths` | `widget.shell.*` |
| `file.icon` | `widget.fileIcon(spec, { size })`: `spec` is a path, an extension such as `.pdf`, or `"folder"` |
| `clipboard.readText` / `writeText` | `widget.clipboard.*` (needs the `clipboard` permission) |
| `paths.named` | `widget.paths.named(name)`: `home` / `desktop` / `documents` / `downloads` / `music` / `pictures` / `videos` / `temp` / `appData` |
| `screen.capture` | `widget.screen.capture()`: the whole virtual desktop as a PNG data URL (needs the `screen` permission) |
| `text.chinese` | `widget.convertChinese(text, to)` |
| `window.getSize` / `setSize` / `drag` / `resize` / `press` / `menu` / `devtools` / `hide` / `show` | `widget.window.*`; `drag`, `resize`, `press`, `menu` and `devtools` are sent by the SDK itself |
| `log` | `widget.log(...)` |

`log` and `ready` get no answer; everything else does.

### Built-in resources

| Address | Contents |
|---|---|
| `/__fw/widget-sdk.js` | the SDK (injected into every page) |
| `/__fw/utools.js` | the uTools compatibility layer (injected into every page), see [Where uTools plugins stand](#where-utools-plugins-stand-how-far-compatibility-goes) |
| `/__fw/base.css` | theme variables and the `w-*` classes (loaded on every page) |
| `/__fw/places.js` | city lookup for the weather widgets; see [Cities and location](#cities-and-location-placesjs) |
| `/__fw/themes/…` | theme CSS and fonts |
| `/__files/<instance>/<setting key>/<relative path>` | pictures in the folder the user chose (what `widget.files.url()` builds) |
| `/__docs/` | this documentation |

### Where the data lives

| What | Where |
|---|---|
| Saved data (`widget.storage`) | `%AppData%\WinWidget\data\<instance id>.json`, 2 MB per instance |
| Your widget folder | `%AppData%\WinWidget\widgets\` (Settings → "widgets folder") |
| Settings and card positions | `%AppData%\Roaming\WinWidget\config.json` |
| Log | `%LocalAppData%\WinWidget\logs\app.log` |

Removing an instance deletes its saved data too; removing the widget folder leaves the cards on the desktop marked "widget is gone".

### Cities and location: `places.js`

The weather, forecast, air-quality and sunrise widgets all use it; you can too:

```html
<script src="/__fw/places.js"></script>
<script src="main.js"></script>
```

```js
// needs "network:geocoding-api.open-meteo.com"; locating by network also needs "network:get.geojs.io"
const place = await places.locate(widget.settings.get("city"));   // "" → locate by IP
// place: { name: "Nanchang", lat, lon, tz, at }
// an unknown city throws places.NotFound, whose message is ready to show

// Write the located city back into the settings so the control center shows it
// (a city the user typed is left alone, so this cannot loop).
places.echo(widget, settings, place);
```

Results are cached in `widget.storage` (`geo2:<city>`, or `geo2:ip` for the network location, re-checked every six hours), so one city is looked up once.

---

## Every API on one page

Anything returning a Promise can be awaited; "sync" means it returns immediately.

| API | Permission | Returns | Notes |
|---|---|---|---|
| `widget.apiVersion` | — | `1` | SDK version |
| `widget.hostVersion` | — | string | WinWidget version |
| `widget.id` | — | string | widget id |
| `widget.instanceId` | — | string | this card's id |
| `widget.locale` | — | string | the user's language |
| `widget.developer` | — | bool | developer mode |
| `widget.permissions` | — | array | permissions allowed now |
| `widget.locked` | — | bool | live |
| `widget.layer` | — | string | current layer |
| `widget.theme` | — | string | current theme id |
| `widget.t(dict)` | — | sync | pick the string for the user's language |
| `widget.on(event, fn)` | — | unsubscribe | listen to host events |
| `widget.settings.get(key?)` | — | sync | read settings |
| `widget.settings.set(key, value)` | — | Promise | write a setting; the control center follows |
| `widget.settings.onChange(fn)` | — | unsubscribe | settings changed |
| `widget.storage.get/set/remove/keys` | — | Promise | saved data, 2 MB per instance |
| `widget.system.subscribe(topics, cb, {interval})` | `system` | unsubscribe | periodic samples, first one right away |
| `widget.system.history()` | `system` | Promise | the last 15 minutes (`{ now, points }`) |
| `widget.system.info()` | `system` | Promise | OS, CPU, memory, GPUs, uptime |
| `widget.system.adapters()` | `system` | Promise | adapters, IPs, gateways |
| `widget.system.ping(host, {timeout})` | `system` | Promise | one ping, at most once a second |
| `widget.audio.get()` | `audio` | Promise | volume, mute, device name |
| `widget.audio.set({volume?, muted?})` | `audio` | Promise | change volume or mute |
| `widget.audio.onChange(fn)` | `audio` | unsubscribe | volume keys, tray, new headphones |
| `widget.media.get()` | `media` | Promise | what is playing |
| `widget.media.onChange(fn)` | `media` | unsubscribe | new track, pause, another app |
| `widget.media.play/pause/toggle/next/previous()` | `media` | Promise | transport buttons |
| `widget.media.seek(ms)` | `media` | Promise | jump |
| `widget.media.position(state)` | `media` | sync | where playback is now, in ms |
| `widget.media.lyrics()` | `media` + `network:*` | Promise | timed lyrics |
| `widget.files.list(key, {recursive})` | folder chosen | Promise | pictures in that folder |
| `widget.files.url(file, {width})` | — | sync | picture URL, optionally a thumbnail |
| `widget.files.info(key, path)` | — | Promise | size, taken-at |
| `widget.files.pick(key)` | — | Promise | folder dialog, saved into the setting |
| `widget.recycleBin.query/empty/open` | built-in | Promise | Recycle Bin |
| `widget.power(action)` | built-in | Promise | `lock` / `sleep` / `restart` / `shutdown` / `signout` |
| `widget.fetch(url, {method, headers, body, as})` | `network:` | Promise | no CORS, 8 MB per call |
| `widget.shell.open(url)` | `shell.open` | Promise | open in the default browser |
| `widget.shell.launch(path)` | `shell.launch` | Promise | program, shortcut, folder, document |
| `widget.shell.info(path, {size})` | `shell.launch` | Promise | name, kind, icon |
| `widget.shell.pick({type, filter, title})` | `shell.launch` | Promise | file or folder dialog |
| `widget.shell.paths(files)` | `shell.launch` | Promise | paths of dropped files |
| `widget.convertChinese(text, to)` | — | Promise | simplified ↔ traditional |
| `widget.notify(o)` / `widget.notify.cancel(tag?)` | `notify` | Promise | Windows notifications, bookable |
| `widget.window.getSize()` | — | Promise | current card size |
| `widget.window.setSize(w, h)` | — | Promise | resize within min/max |
| `widget.window.startDrag()` | — | sync | start dragging from your code |
| `widget.appearance.get()` | — | sync | current appearance |
| `widget.appearance.onChange(fn)` | — | unsubscribe | theme or appearance changed |
| `widget.log(...args)` | — | sync | write to app.log |

### Events

| Event | When | Payload |
|---|---|---|
| `ready` | the page is up | `{ visible }` |
| `show` / `hide` | the card came on screen / left the screen | `{ from, visible, initial }` |
| `resize` | the card's size changed (80 ms debounce) | `{ width, height }` |
| `unload` | the card is removed or the app is quitting | `{ kill }` |
| `settings` | the user changed settings | all settings |
| `appearance` | theme or appearance changed | the new appearance |
| `state` | locked, layer or click-through changed | `{ locked, layer, clickThrough }` |
| `summon` | the hotkey brought the widget up | none |
| `identify` | "Locate" was pressed in the control center | none (the SDK draws the ring) |
| anything else | a `ev` the SDK does not know | passed through as-is |

### Folding of language objects

A setting can carry one value per language; the host folds it to the user's language before you see it:

```json
{ "key": "city", "type": "text", "default": { "zh-TW": "台北", "zh-CN": "厦门", "en": "Taipei" } }
```

```js
widget.settings.get("city");   // "厦门" for a Simplified Chinese user
```

---

## Three complete examples

### 1. A number from a web API on the desktop

Show a GitHub project's star count, refresh every 30 minutes, and keep the last value when the network fails.

`widget.json`: `"permissions": ["network:api.github.com"]`.

```js
const $ = (id) => document.getElementById(id);
const KEY = "last";

async function fetchOnce() {
  const r = await widget.fetch("https://api.github.com/repos/Demon1110/WinWidget", {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const repo = await r.json();
  return { stars: repo.stargazers_count, at: Date.now() };
}

async function refresh() {
  try {
    const data = await fetchOnce();
    show(data, false);
    await widget.storage.set(KEY, data);
  } catch (e) {
    // Fall back to the last good value and mark it as stale.
    const old = await widget.storage.get(KEY);
    if (old) show(old, true);
    else $("stars").textContent = "—";
    widget.log(`stars: ${e.message}`);
  }
}

function show(data, stale) {
  $("stars").textContent = data.stars.toLocaleString(widget.locale);
  $("at").textContent = new Date(data.at).toLocaleTimeString(widget.locale, { hour: "2-digit", minute: "2-digit" });
  $("stale").hidden = !stale;
}

refresh();
setInterval(refresh, 30 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
```

- `permissions` needs `network:api.github.com`, not `*.github.com`: ask for as little as possible.
- Something to show even before (or without) data, so the card is never blank.
- `setInterval` is fine; never poll per second what has an event (`widget.media`, `widget.audio`).

### 2. System figures once a second, cheaply

```js
const $ = (id) => document.getElementById(id);
const bars = [];

widget.system.subscribe(["cpu", "memory"], (d) => {
  if (d.cpu) {
    $("cpu").textContent = `${Math.round(d.cpu.usage)}%`;
    push(bars[0], d.cpu.usage);
  }
  if (d.memory) {
    $("mem").textContent = `${Math.round(d.memory.usage)}%`;
    push(bars[1], d.memory.usage);
  }
}, { interval: 1000 });

/** A 20-cell sparkline that updates every second, so no transition. */
function push(bar, value) {
  const cell = document.createElement("i");
  cell.style.height = `${Math.max(4, Math.min(100, value))}%`;
  bar.appendChild(cell);
  if (bar.children.length > 20) bar.firstElementChild.remove();
}
```

```css
#cpu, #mem { font-variant-numeric: tabular-nums; }   /* digits stop jittering */
.mini { display: flex; align-items: flex-end; gap: 1px; height: 1.6rem; }
.mini i { width: 2px; background: var(--w-accent); } /* no transition, no animation */
```

- No `transition` or `animation` on anything that changes every second: a 0.5 s animation means the card repaints constantly.
- `tabular-nums` keeps numbers from shifting sideways.
- Unsubscribe when you no longer need it (`const stop = widget.system.subscribe(...); stop();`).

### 3. Two copies of the same widget, separate data

```js
// The card is dragged and resized, but the instance id never changes: use it to separate data.
const key = `state:${widget.instanceId}`;

const saved = await widget.storage.get(key);
index = saved ? saved.index : 0;

function save() {
  widget.storage.set(key, { index });   // no await needed, writes are quick
}
```

`widget.storage` is per **widget type** (both copies share one file), so put `instanceId` in the key when they must not share; settings are per instance already.

---

## Checklist before you hand a widget out

1. `id` uses only lowercase letters, digits and `. _ -`, 2–64 characters, and never changes afterwards.
2. `entry` exists, and every resource is a relative path.
3. Files are UTF-8 (a BOM will break `widget.json` parsing).
4. Everything you use is declared in `permissions`; prefer `network:some.site` over `network:*`.
5. Something is visible on first paint; when data fails, say so in plain words instead of leaving the card blank.
6. Nothing that updates every second has an animation; nothing that has an event is polled.
7. Numbers and dates go through `widget.locale`; words go through `widget.t()`.
8. Only `--w-*` variables and `w-*` classes, checked on all three themes.
9. It survives being resized: flex/grid, `@container` where needed, `grow` if the content should scale.
10. No `window.open`, no navigation, no `document.write`; use `widget.shell.open`.
11. No CDN scripts or fonts (they break offline) — bundle them in the widget folder.
12. Look at the Console with F12 in developer mode before exporting the `.fwz`.

---

## Questions

**I changed a file and nothing happened on the desktop.**
Check that developer mode is on under Settings. If it's off, right-click the widget → **Reload**. If you changed `widget.json` and the widget disappeared, look at the top of **Add widgets** for an error.

**`widget.fetch` fails with "permission denied".**
Add the site to `permissions`, e.g. `"network:api.example.com"`; the error message names the exact line to add. If it says "not allowed yet", the permission is declared but the user hasn't allowed it: pick the widget under **My widgets** and press **Review**.

**A plain `fetch()` or `<img>` from the web doesn't load.**
The site has to be in `permissions`. A plain `fetch()` also needs the site to allow CORS; if it doesn't, use `widget.fetch`.

**Text shows up garbled.**
Save the files as UTF-8.

**I want the widget bigger or smaller when it's first added.**
Change `size.width` and `size.height`. Copies already on the desktop keep the size the user gave them; add a new one from **Add widgets** to see the change.

**How do I make it look right on the light Paper theme?**
Use the `--w-*` variables for text and lines instead of hard-coded white or black, and check all three themes under **Themes**.


**I changed the language and the widget still speaks the old one.**
The language is read from `config.json` at startup, so restart WinWidget; the control center itself follows immediately, cards already open reload on the next launch. Always use `widget.locale` / `widget.t()` in a widget instead of detecting the system language.

**"Widgets folder" and "data" in the settings do not open.**
Those buttons hand a local folder to Windows (the same as double-clicking it in Explorer). Older builds passed it to the URL opener, which only accepts http/https/mailto, so it always failed; the current build opens it properly. If a click still does nothing, check that line in `%LocalAppData%\WinWidget\logs\app.log`.

**Check for updates says there is no channel.**
With an empty `update_url`, updates are read from this project's GitHub Releases (`api.github.com`). To use your own feed, point `update_url` at a JSON document `{"version": "1.2.0", "url": "download", "size": bytes, "notes": "notes", "page": "page"}`. Checks and downloads run in the background, and developer mode never updates itself.
