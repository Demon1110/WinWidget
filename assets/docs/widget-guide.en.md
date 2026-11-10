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
| `shell.launch` | `widget.shell.launch`, `pick`, `info`, `paths`: opening programs and files, choosing files, reading names and icons (users see a clear warning when allowing it) |

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
