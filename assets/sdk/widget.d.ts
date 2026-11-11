/**
 * WinWidget widget API, version 1.
 *
 * WinWidget puts `widget` into every widget page by itself: no import, no script tag.
 * Keep this file next to your main.js and editors such as VS Code will complete `widget.`
 * calls and show these notes. Full guide: docs/組件開發指南.md in the WinWidget folder.
 */

declare namespace WinWidget {
  type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

  /** Text in several languages: { "zh-TW": "時鐘", "zh-CN": "时钟", "en": "Clock" }. */
  type Localized<T = string> = { [locale: string]: T };

  /** "desktop": under all windows, stays on Win+D. "normal": like any window. "top": always on top. */
  type Layer = "desktop" | "normal" | "top";

  /** Declared in widget.json "permissions"; third-party widgets also need the user's OK. */
  type Permission = "system" | "notify" | "audio" | "media" | "shell.open" | "shell.launch" | `network:${string}`;

  interface PathInfo {
    path: string;
    exists: boolean;
    /** "Google Chrome" for chrome.exe, the shortcut's name, the folder's name. */
    name: string;
    kind: "app" | "folder" | "file" | "missing";
    /** The icon Explorer shows, as a PNG data: URL (null if there is none). */
    icon: string | null;
  }

  /** Where the widget is listed in the widget library. */
  type Category = "time" | "weather" | "system" | "productivity" | "info" | "media";

  interface Notification {
    /** Bold first line. Default: the widget's name. */
    title?: string;
    body?: string;
    /** Show it later instead of now (Date or milliseconds since 1970). At most 7 days ahead. */
    at?: Date | number;
    /** A new notification with the same tag replaces the booked one. */
    tag?: string;
  }

  type SystemTopic = "cpu" | "memory" | "network" | "disk" | "battery";

  interface CpuInfo {
    /** Percent busy, 0–100. */
    usage: number;
    /** Logical processors. */
    cores: number;
  }

  interface MemoryInfo {
    /** Percent in use, 0–100. */
    usage: number;
    /** Bytes. */
    total: number;
    used: number;
    available: number;
  }

  interface NetworkInfo {
    /** Bytes per second, all active adapters together. */
    down: number;
    up: number;
    /** Bytes since the adapters came up. */
    totalDown: number;
    totalUp: number;
  }

  interface DiskInfo {
    /** "C:" */
    name: string;
    label: string;
    /** "fixed", or "removable" for USB drives and memory cards. */
    type: "fixed" | "removable";
    /** Bytes. */
    total: number;
    free: number;
    /** Percent in use, 0–100. */
    usage: number;
  }

  interface BatteryInfo {
    /** false on desktops without a battery (the other fields are then empty). */
    present: boolean;
    percent: number | null;
    charging: boolean;
    pluggedIn: boolean;
    /** Estimated time left on battery; null while charging or unknown. */
    secondsLeft: number | null;
    /** Windows' battery saver is on. */
    saver: boolean;
  }

  interface PcInfo {
    /** name: "Windows 11 Pro"; edition: "Professional", "Core" (Home) …; version: "25H2"; build: "26300.1234" */
    os: { name: string; edition: string; version: string; build: string; arch: string };
    cpu: { name: string; cores: number; threads: number };
    /** Bytes: installed RAM, and the part Windows can use. */
    memory: { installed: number; usable: number };
    /** Every graphics adapter, including a laptop's second GPU. */
    gpus: string[];
    computer: string;
    /** Physical pixels. */
    screens: { width: number; height: number; primary: boolean }[];
    /** Milliseconds since 1970, and since then. */
    bootTime: number;
    uptime: number;
  }

  interface NetworkAdapter {
    /** "Wi-Fi", "Ethernet" … as in Windows' settings. */
    name: string;
    description: string;
    type: "wifi" | "ethernet" | "cellular" | "other";
    /** Hyper-V, VPN, VMware and similar. */
    virtual: boolean;
    /** Link speed in bits per second (0 if unknown). */
    speed: number;
    ipv4: string[];
    ipv6: string[];
    gateways: string[];
    dns: string[];
  }

  interface PingResult {
    ok: boolean;
    /** Round trip in milliseconds; null when it failed. */
    ms: number | null;
    /** "Success", "TimedOut", "NameNotResolved", "DestinationHostUnreachable" … */
    status: string;
    address: string | null;
  }

  interface MediaState {
    /** false when nothing has a media session (no music or video app open). */
    available: boolean;
    /** The app playing: "Spotify", "Microsoft Edge", "媒體播放器"; icon is a PNG data URL or null. */
    app?: { id: string; name: string; icon: string | null };
    title?: string;
    artist?: string;
    album?: string;
    albumArtist?: string;
    subtitle?: string;
    track?: number;
    status?: "closed" | "opened" | "changing" | "stopped" | "playing" | "paused" | "unknown";
    playing?: boolean;
    /** ms from the start, as of `updated` (ms since 1970). Use widget.media.position(state) for "now". */
    position?: number;
    /** ms; 0 when the app doesn't say (live streams, some browsers). */
    duration?: number;
    updated?: number;
    /** The album art's address on the widget's own origin (use it as an <img> src), or null. */
    cover?: string | null;
    /** Which buttons the app accepts right now. */
    can?: { play: boolean; pause: boolean; toggle: boolean; next: boolean; previous: boolean; seek: boolean };
  }

  interface FolderFile {
    /** Relative to the folder, with "/": "2024/beach.jpg". */
    path: string;
    /** File name without the extension. */
    name: string;
    size: number;
    /** Last changed, ms since 1970. */
    modified: number;
    /** The original file on the widget's own origin; widget.files.url(file, { width }) gives a smaller copy. */
    url: string;
  }

  interface AudioState {
    /** false when there is no output device. */
    available: boolean;
    /** 0–100. */
    volume: number;
    muted: boolean;
    /** "Speakers (Realtek(R) Audio)" */
    device: string;
  }

  /** Only the topics you subscribed to are present. */
  interface SystemData {
    cpu?: CpuInfo;
    memory?: MemoryInfo;
    network?: NetworkInfo;
    disk?: DiskInfo[];
    battery?: BatteryInfo;
  }

  interface FetchOptions {
    /** Default "GET". */
    method?: string;
    headers?: Record<string, string>;
    /** Objects are sent as JSON text. */
    body?: string | object;
    /** "base64" for binary responses (images…); body then holds base64 text. */
    as?: "text" | "base64";
  }

  interface FetchResponse {
    ok: boolean;
    status: number;
    statusText: string;
    /** The final address, after redirects. */
    url: string;
    /** Lower-case header names. */
    headers: Record<string, string>;
    body: string;
    text(): Promise<string>;
    json<T = any>(): Promise<T>;
  }

  interface Appearance {
    /** Theme id: "instrument", "type", "paper"… */
    theme: string;
    themeHref: string;
    /** Card style chosen by the user. */
    style: "transparent" | "frosted";
    shadow: boolean;
    /** Invisible margin around the card for its shadow, in px. */
    margin: number;
    themeCss: string;
    userCss: string;
    /** Every appearance value in effect (theme, global tweaks and this widget's own). */
    values: Record<string, Json>;
  }

  interface WidgetState {
    locked: boolean;
    layer: Layer;
    clickThrough: boolean;
  }

  interface Size {
    /** In CSS pixels (device-independent). */
    width: number;
    height: number;
  }

  interface Events {
    /** All settings, after the user changed one. */
    settings: Record<string, any>;
    /** Theme or appearance changed (CSS variables are already updated). */
    appearance: Appearance;
    /** Locked, layer or click-through changed. */
    state: WidgetState;
    /** The page is up: one task after the widget's own DOMContentLoaded handlers. */
    ready: { visible: boolean };
    /** The card came on screen. `from` says why; the same event fires for the first show. */
    show: { from: ShowFrom; visible: true; initial: boolean };
    /** The card went off screen (hidden by the user, the tray, full screen, or the API). */
    hide: { from: ShowFrom; visible: false; initial: false };
    /** The card was resized; debounced until the size settles. CSS pixels. */
    resize: { width: number; height: number };
    /** The card is going away: `kill: true` means it is being removed or the app is quitting. */
    unload: { kill: boolean };
  }

  /** Why a card was shown or hidden. Mirrors the tray, the control center and the API. */
  type ShowFrom = "startup" | "tray" | "control" | "hotkey" | "fullscreen" | "api";

  /** The uTools-shaped "entered" payload. `from` is the uTools vocabulary, mapped from ShowFrom. */
  interface PluginEnterAction {
    /** widget.json id (uTools: feature.code). */
    code: string;
    /** Always "text": a card has no command matching of its own. */
    type: "text";
    /** Always "": nothing was matched on the way in. */
    payload: string;
    /** main = startup / full screen, panel = tray, hotkey = global hotkey, redirect = control center or API. */
    from: "main" | "panel" | "hotkey" | "redirect";
    /** Only present when the enter came from a pushed result — never in WinWidget today. */
    option?: { text?: string };
  }

  interface Widget {
    /** 1 for this API. */
    readonly apiVersion: number;
    readonly hostVersion: string;
    /** This widget's id from widget.json. */
    readonly id: string;
    /** This copy on the desktop (there may be several copies of one widget). */
    readonly instanceId: string;
    /** The user's language, e.g. "zh-TW", "zh-CN", "en-US". Use it for dates and numbers. */
    readonly locale: string;
    /** True in developer mode (F12, reload on save, error bar). */
    readonly developer: boolean;
    /** Permissions usable now: declared in widget.json and allowed by the user. */
    readonly permissions: readonly Permission[];
    readonly locked: boolean;
    readonly layer: Layer;
    /** Current theme id, e.g. "instrument". Also set as <html data-theme="…">. */
    readonly theme: string;
    /** Is the card on screen right now? Kept in step by the show/hide events. */
    readonly visible: boolean;
    /** "main" on a card, "custom" inside a window the widget opened. */
    readonly windowType: "main" | "custom";
    /** The custom window's id; 0 on a card. */
    readonly windowId: number;

    /** Raw bridge call, `widget.call("win.create", { … })` → Promise. Used by the uTools layer. */
    call(method: string, params?: unknown): Promise<any>;

    /** Picks the text for the user's language: t({ "zh-TW": "早安", en: "Morning" }). */
    t<T = string>(text: Localized<T>): T;

    /** Host events. Returns a function that stops listening. */
    on<K extends keyof Events>(event: K, listener: (data: Events[K]) => void): () => void;
    on(event: string, listener: (data: any) => void): () => void;

    /** The values of "settings" in widget.json, as the user set them in the control center. */
    settings: {
      /** All settings, synchronously. */
      get(): Record<string, any>;
      /** One setting, synchronously. */
      get<T = any>(key: string): T;
      /** Change a declared setting (it shows up in the control center too). */
      set(key: string, value: Json): Promise<void>;
      /** Called with all settings whenever the user changes one. */
      onChange(listener: (settings: Record<string, any>) => void): () => void;
    };

    /** Saved data for this copy of the widget. Kept across restarts; deleted when it is removed. */
    storage: {
      /** undefined/null when the key was never set. */
      get<T = any>(key: string): Promise<T | null>;
      set(key: string, value: Json): Promise<void>;
      remove(key: string): Promise<void>;
      keys(): Promise<string[]>;
    };

    /** Needs the "system" permission. */
    system: {
      /**
       * Live system figures. The first call answers right away; then every `interval` ms
       * (default 1000). Returns a function that stops the updates.
       *   widget.system.subscribe(["cpu", "memory"], d => show(d.cpu.usage), { interval: 2000 })
       */
      subscribe(topics: SystemTopic | SystemTopic[], listener: (data: SystemData) => void, options?: { interval?: number }): () => void;
      /**
       * Readings from the last 15 minutes, about one a second, oldest first: [time (ms), cpu %, memory %,
       * download B/s, upload B/s]. Recorded only while some widget was showing these figures.
       */
      history(): Promise<{ now: number; points: [number, number, number, number, number][] }>;
      /** This PC: Windows version, processor, memory, graphics, uptime. */
      info(): Promise<PcInfo>;
      /** Connected network adapters, the one carrying internet traffic first. */
      adapters(): Promise<{ online: boolean; adapters: NetworkAdapter[] }>;
      /** One ping (ICMP echo). At most once a second per widget; timeout 200–5000 ms, default 1500. */
      ping(host: string, options?: { timeout?: number }): Promise<PingResult>;
    };

    /** The speakers' volume and mute. Needs the "audio" permission. */
    audio: {
      get(): Promise<AudioState>;
      /** Either or both: { volume: 0–100, muted: true/false }. */
      set(changes: { volume?: number; muted?: boolean }): Promise<AudioState>;
      /** Called now and on every change (volume keys, the taskbar, a new output device). Returns a function that stops it. */
      onChange(listener: (state: AudioState) => void): () => void;
    };

    /**
     * What's playing in Windows' media controls (Spotify, browsers, the Media Player app…) and
     * its buttons. Needs the "media" permission. Every call resolves to true if the app accepted it.
     */
    media: {
      get(): Promise<MediaState>;
      /** Called now and on every change (new track, play/pause, another app). Returns a function that stops it. */
      onChange(listener: (state: MediaState) => void): () => void;
      play(): Promise<boolean>;
      pause(): Promise<boolean>;
      toggle(): Promise<boolean>;
      next(): Promise<boolean>;
      previous(): Promise<boolean>;
      /** Jumps to `ms` from the start, if can.seek. */
      seek(ms: number): Promise<boolean>;
      /** The position now, in ms (it moves on while playing). */
      position(state: MediaState): number;
      /** Timed lyrics of the current track, looked up on NetEase Cloud Music, QQ Music and Kugou
       *  (the playing app first). `title`/`artist`/`duration` (ms, 0 if unknown) say which track
       *  they are for. */
      lyrics(): Promise<{ title: string; artist: string; duration: number; lyrics:{ found: boolean; source?: "netease" | "qqmusic" | "kugou"; lines?: { t: number; text: string; tr?: string }[] } }>;
    };

    /**
     * Pictures in the folder the user chose in a setting of type "folder". Choosing it is the
     * permission; a third-party widget's default folder doesn't count until the user picks one.
     */
    files: {
      /** jpg, png, gif, webp, bmp, avif, heic, tif; at most 5000. */
      list(settingKey: string, options?: { recursive?: boolean }): Promise<{ folder: string; name: string; files: FolderFile[]; more: boolean }>;
      /** The picture's address; with { width } (pixels) Windows makes a smaller copy that loads fast and uses little memory. */
      url(file: FolderFile, options?: { width?: number }): string;
      /** When the photo was taken (ms, from the camera's data, or null) and its size. */
      info(settingKey: string, file: FolderFile | string): Promise<{ taken: number | null; width: number; height: number }>;
      /** Opens a folder dialog and saves the choice in the setting → the path, or null if cancelled. */
      pick(settingKey: string): Promise<string | null>;
    };

    /**
     * Like fetch(), sent by WinWidget, so CORS doesn't apply. Each host must be declared,
     * e.g. "network:api.example.com", "network:*.example.com" or "network:*". 8 MB limit.
     */
    fetch(url: string, options?: FetchOptions): Promise<FetchResponse>;

    /**
     * A Windows notification. Needs the "notify" permission.
     *   widget.notify("Time's up")
     *   widget.notify({ title: "Pomodoro", body: "Take a break", at: endsAt, tag: "end" })
     * Booked notifications are kept by WinWidget, so they arrive on time even while the page
     * is paused. widget.notify.cancel(tag) cancels one; cancel() cancels all of this widget's.
     */
    notify: {
      (notification: string | Notification): Promise<void>;
      cancel(tag?: string): Promise<void>;
    };

    shell: {
      /** Opens an http(s) or mailto link in the user's browser or mail app. Needs "shell.open". */
      open(target: string): Promise<void>;
      /** Opens a program, shortcut, folder or document by its full path, as a double-click would (no arguments). Needs "shell.launch". */
      launch(path: string): Promise<void>;
      /** Name, kind and icon of a path. Needs "shell.launch". */
      info(path: string, options?: { size?: number }): Promise<PathInfo>;
      /** Asks the user to choose a file or folder; null if they cancel. Needs "shell.launch". */
      pick(options?: { type?: "file" | "folder"; filter?: "programs" | "images" | "all"; title?: string }): Promise<string | null>;
      /** Asks the user where to save; null if they cancel. Needs "shell.launch". */
      save(options?: { title?: string; name?: string; filter?: "images" | "text" | "json" | "all" }): Promise<string | null>;
      /** Shows the file in its folder in Explorer. Needs "shell.launch". */
      reveal(path: string): Promise<void>;
      /** Moves a file or folder to the recycle bin, so a mistake stays recoverable. Needs "shell.launch". */
      trash(path: string): Promise<boolean>;
      /**
       * Full paths of files dropped on the widget. Needs "shell.launch".
       *   document.addEventListener("drop", async e => { e.preventDefault(); add(await widget.shell.paths(e.dataTransfer.files)); });
       */
      paths(files: FileList | File[]): Promise<string[]>;
    };

    /** The Windows clipboard. Needs the "clipboard" permission. */
    clipboard: {
      /** The copied text, or null when the clipboard holds no text. */
      readText(): Promise<string | null>;
      /** Puts text on the clipboard; false when Windows refused it. */
      writeText(text: string): Promise<boolean>;
      /** The copied picture as a PNG data URL, or null when there is none. */
      readImage(): Promise<string | null>;
      /** A data URL, a bare base64 string, a path or a NativeImage; false when Windows refused it. */
      writeImage(image: string | NativeImage): Promise<boolean>;
      /** The copied files. */
      readFiles(): Promise<CopiedFile[]>;
      /** Puts files on the clipboard so the next Ctrl+V drops them. */
      writeFiles(paths: string[]): Promise<boolean>;
    };

    /** Windows' own known folders (OneDrive redirection included). No permission needed. */
    paths: {
      /** named("home" | "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos" | "temp" | "appData") → path, or null. */
      named(name: "home" | "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos" | "temp" | "appData"): Promise<string | null>;
    };

    /** The screen. Needs the "screen" permission. */
    screen: {
      /** The whole virtual desktop as a PNG data URL, or null when GDI refused. */
      capture(): Promise<string | null>;
      /** Windows' snipping overlay; the selection as a PNG data URL, or null when cancelled. */
      captureInteractive(options?: { timeout?: number }): Promise<string | null>;
      /** One display by index (0-based), as a PNG data URL. */
      captureDisplay(display: number): Promise<string | null>;
      /** Every display; bounds and workArea are in DIP. */
      displays(): Promise<Display[]>;
      /** The display Windows calls primary. */
      primary(): Promise<Display>;
      /** The display a point falls on. */
      nearest(point: Point): Promise<Display>;
      /** The display a rectangle overlaps most. */
      matching(rect: RectLike): Promise<Display>;
      /** The mouse position, in physical screen pixels. */
      cursor(): Promise<Point>;
      /** Point or rectangle from physical pixels to DIP. */
      toDip(value: Point | RectLike): Promise<Point | RectLike>;
      /** Point or rectangle from DIP to physical pixels. */
      toScreen(value: Point | RectLike): Promise<Point | RectLike>;
      /** The colour under the cursor. */
      colorPick(): Promise<{ hex: string; rgb: string }>;
    };

    /** The document store: `data\db\<widget>.json` plus an attachments folder. */
    db: {
      put(doc: DbDoc): Promise<DbResult>;
      get(id: string): Promise<DbDoc | null>;
      remove(docOrId: string | DbDoc): Promise<DbResult>;
      bulkDocs(docs: DbDoc[]): Promise<DbResult[]>;
      allDocs(options?: { idStartsWith?: string; ids?: string[] }): Promise<DbDoc[]>;
      postAttachment(id: string, data: string, type: string): Promise<DbResult>;
      /** The attachment as a PNG data URL. */
      getAttachment(id: string): Promise<string | null>;
      getAttachmentType(id: string): Promise<string>;
    };

    /** Timed tasks, kept in `data\schedules.json`. Needs the "schedule" permission. */
    schedule: {
      request(task: Schedule): Promise<void>;
      list(): Promise<ScheduleInfo[]>;
      remove(code: string): Promise<void>;
      /** Runs when a task is due; a throw or a rejection is recorded as a failure. */
      onTrigger(listener: (trigger: ScheduleTrigger) => void | Promise<void>): () => void;
    };

    /** Keyboard and mouse injection. Needs the "input" permission; coordinates are physical pixels. */
    simulate: {
      keyboardTap(key: string, ...modifiers: ("shift" | "ctrl" | "alt" | "command")[]): Promise<void>;
      mouseMove(x: number, y: number): Promise<void>;
      mouseClick(x: number, y: number): Promise<void>;
      mouseDoubleClick(x: number, y: number): Promise<void>;
      mouseRightClick(x: number, y: number): Promise<void>;
    };

    /** The commands this widget adds while it runs, kept in `data\features.json`. */
    features: {
      get(codes?: string[]): Promise<Feature[]>;
      set(feature: Feature): Promise<void>;
      remove(code: string): Promise<boolean>;
    };

    /** Opening another widget by one of its commands. */
    redirect: {
      to(label: string | [string, string], payload?: MatchPayload): Promise<boolean>;
      hotkey(cmdLabel: string, autocopy?: boolean): Promise<boolean>;
      hotkeyGet(cmdLabel: string): Promise<string | null>;
    };

    /** Fetching a page without a browser window. Needs the "ubrowser" permission. */
    ubrowser: {
      fetch(url: string, options?: { timeout?: number }): Promise<{ url: string; title: string; text: string; html: string; skipped: string[] }>;
    };

    /** Image processing in the host. Needs the "sharp" permission; chain calls, then read the result. */
    sharp(input?: SharpInput, options?: { format?: "png" | "jpeg" | "webp" | "tiff"; quality?: number }): SharpImage;

    /** A file type's icon as a data URL: a path, an extension (".pdf") or "folder". Needs "shell.launch". */
    fileIcon(spec: string, options?: { size?: number }): Promise<string | null>;

    /** Simplified ↔ Traditional Chinese, character by character, with Windows' own tables. */
    convertChinese(text: string, to: "traditional" | "simplified"): Promise<string>;

    window: {
      getSize(): Promise<Size>;
      /** Clamped to the min/max size in widget.json. */
      setSize(width: number, height: number): Promise<Size>;
      /** Starts moving the widget with the mouse (call from a mousedown handler). */
      startDrag(): void;
      /** Puts the card away; the tray menu and the control center bring it back. */
      hide(): Promise<void>;
      /** Brings a hidden card back. */
      show(): Promise<void>;
    };

    appearance: {
      get(): Appearance;
      onChange(listener: (appearance: Appearance) => void): () => void;
    };

    /** Writes a line to the WinWidget log (and nothing else). */
    log(...values: any[]): void;
  }
}

/** The WinWidget API, ready when your script runs. */
declare const widget: WinWidget.Widget;

namespace WinWidget {
  /**
   * The uTools compatibility layer: the subset of `utools.*` a plain web page can use.
   * It is NOT the uTools runtime — no Electron, no Node, no native modules here.
   * Check `utools.__compat` before relying on anything beyond the members below.
   */
  interface Utools {
    __compat: {
      host: "WinWidget";
      level: "web-subset";
      supported: readonly string[];
      degraded: readonly string[];
      unsupported: readonly string[];
      supports(name: string): boolean;
    };
    /** Runs after the page is up; a returned Promise is awaited before onPluginEnter fires. */
    onPluginReady(fn: () => void | Promise<void>): void;
    /**
     * Opens a window of the widget's own, the uTools way:
     * `utools.createBrowserWindow("panel.html", { width: 520, height: 380, show: false },
     *   (win) => win.show())`.
     *
     * The page is a file inside this widget (`panel.html` or `panel.html?mode=1`); it inherits the
     * widget's origin, theme and storage. The object returned is a `BrowserWindow` (see
     * `WinWidget.BrowserWindow`) whose getters answer from a local mirror, because building the
     * window is one asynchronous hop through the host.
     */
    createBrowserWindow(
      url: string,
      options?: BrowserWindowOptions,
      callback?: (win: BrowserWindow) => void
    ): BrowserWindow;
    /** "main" on a card, "custom" inside a window you opened. */
    getWindowType(): "main" | "custom";
    /** From a custom window: send a message back to the window that opened it. */
    sendToParent(channel: string, ...args: unknown[]): Promise<void>;
    /** Find text in the card's page. */
    findInPage(text: string, options?: { forward?: boolean; matchCase?: boolean }): Promise<void>;
    stopFindInPage(action?: "clearSelection" | "keepSelection"): Promise<void>;
    /** Hides the card. `isFocusPrevWindow` hands the keyboard back to the previous window. */
    hideMainWindow(isFocusPrevWindow?: boolean): Promise<boolean>;
    showMainWindow(): Promise<boolean>;
    outPlugin(isKill?: boolean): Promise<{ isKill: boolean }>;
    setExpendHeight(height: number): Promise<boolean>;
    /** The card came on screen. Fires once per show, with the uTools-shaped action object. */
    onPluginEnter(fn: (enter: PluginEnterAction) => void): void;
    /** Hidden (isKill = false) or removed / app quitting (isKill = true). */
    onPluginOut(fn: (isKill: boolean) => void): void;
    /** Registered but never called: every card is already its own window. */
    onPluginDetach(fn: () => void): void;
    /**
     * A schedule this widget asked for has come due. The callback may return a Promise; a throw or a
     * rejected Promise is counted as a failure in `getSchedules()`.
     */
    onScheduleTrigger(fn: (action: ScheduleTrigger) => void | Promise<void>): void;
    /** Not available: no search box. Throws code "utools.unsupported". */
    onMainPush(fn: (action: unknown) => unknown, onSelect?: (action: PluginEnterAction) => boolean | undefined): never;
    /** Not available: no cross-device sync. Throws code "utools.unsupported". */
    onDbPull(fn: (docs: unknown[]) => void): never;
    shellOpenPath(fullPath: string): Promise<string>;
    shellShowItemInFolder(fullPath: string): Promise<void>;
    shellOpenExternal(url: string): Promise<void>;
    shellTrashItem(fullPath: string): Promise<boolean>;
    shellBeep(): void;
    getPath(name: string): string;
    getFileIcon(filePath: string): Promise<string | null>;
    getFileIconAsync(filePath: string): Promise<string | null>;
    showOpenDialog(options?: { title?: string; properties?: string[] }): Promise<string[] | undefined>;
    showSaveDialog(options?: { title?: string; defaultPath?: string }): Promise<string | undefined>;
    getAppVersion(): string;
    getNativeId(): string;
    getUser(): null;
    isDev(): boolean;
    isWindows(): boolean;
    isMacOS(): boolean;
    isLinux(): boolean;
    isDarkColors(): boolean;
    copyText(text: string): Promise<boolean>;
    /** A data URL, a bare file path or a NativeImage. */
    copyImage(image: string | NativeImage): Promise<boolean>;
    /** Puts one or more paths on the clipboard as files (`CF_HDROP`). */
    copyFile(path: string | string[]): Promise<boolean>;
    /** The files on the clipboard, empty when there are none. Async here, sync in uTools. */
    getCopyedFiles(): Promise<CopiedFile[]>;
    /** Documents and attachments, stored in `data/db/<widget>.json`; every method is a Promise. */
    db: DbApi;
    dbStorage: {
      getItem(key: string): unknown;
      setItem(key: string, value: unknown): unknown;
      removeItem(key: string): void;
      clear(): void;
    };
    /** The virtual desktop as a PNG data URL; needs the "screen" permission. */
    captureScreen(): Promise<string | null>;
    /** Displays, DIP conversion and screenshots; every method needs the "screen" permission. */
    screen: ScreenApi;
    /** The pixel under the cursor right now: `{ hex, rgb }`. */
    screenColorPick(): Promise<{ hex: string; rgb: string }>;
    hideMainWindowPasteText(text: string): Promise<boolean>;
    hideMainWindowPasteFile(path: string | string[]): Promise<boolean>;
    hideMainWindowPasteImage(image: string | NativeImage): Promise<boolean>;
    hideMainWindowTypeString(text: string): Promise<boolean>;
    requestSchedule(schedule: Schedule): Promise<void>;
    getSchedules(): Promise<ScheduleInfo[]>;
    removeSchedule(code: string): Promise<void>;
    simulateKeyboardTap(key: string, ...modifiers: Array<"shift" | "ctrl" | "alt" | "command">): Promise<void>;
    simulateMouseMove(x: number, y: number): Promise<void>;
    simulateMouseClick(x: number, y: number): Promise<void>;
    simulateMouseDoubleClick(x: number, y: number): Promise<void>;
    simulateMouseRightClick(x: number, y: number): Promise<void>;
    getFeatures(codes?: string[]): Promise<Feature[]>;
    setFeature(feature: Feature): Promise<void>;
    removeFeature(code: string): Promise<boolean>;
    /** Shows the widget that owns this command; false when nothing owns it. */
    redirect(label: string | [pluginName: string, label: string], payload?: MatchPayload): Promise<boolean>;
    redirectHotKeySetting(cmdLabel: string, autocopy?: boolean): Promise<void>;
    getCmdHotKey(cmdLabel: string): Promise<string | null>;
    /** A chain of picture operations; only what the `image` crate can do is implemented. */
    sharp(input?: SharpInput, options?: unknown): SharpImage;
    /** Page fetching only: there is no embedded browser behind this. */
    ubrowser: UBrowser;
    getPluginLocalDataPath(): string;
    getPluginTempPath(): string;
    /** Anything else throws an Error whose code is "utools.unsupported". */
    [api: string]: unknown;
  }

  /** A picture in memory. Decoding happens asynchronously here, so the methods return Promises. */
  interface NativeImage {
    isEmpty(): boolean;
    getSize(): Promise<{ width: number; height: number }>;
    toDataURL(): Promise<string>;
    toPNG(): Promise<Uint8Array>;
    toJPEG(quality?: number): Promise<Uint8Array>;
    crop(rect: RectLike): Promise<NativeImage>;
    resize(options: { width?: number; height?: number; quality?: number }): Promise<NativeImage>;
    readonly __dataUrl: string;
  }

  interface RectLike {
    x?: number;
    y?: number;
    left?: number;
    top?: number;
    width: number;
    height: number;
  }

  interface Point {
    x: number;
    y: number;
  }

  interface Display {
    id: number;
    label: string;
    primary: boolean;
    /** In DIP: divide the Win32 pixel rectangle by `scaleFactor`. */
    bounds: RectLike;
    workArea: RectLike;
    workAreaSize: { width: number; height: number };
    scaleFactor: number;
    rotation: 0;
    size: { width: number; height: number };
  }

  interface ScreenApi {
    getCursorScreenPoint(): Promise<{ x: number; y: number }>;
    getPrimaryDisplay(): Promise<Display>;
    getAllDisplays(): Promise<Display[]>;
    getDisplayNearestPoint(point: { x: number; y: number }): Promise<Display>;
    getDisplayMatching(rect: RectLike): Promise<Display>;
    screenToDipPoint(point: { x: number; y: number }): Promise<{ x: number; y: number }>;
    dipToScreenPoint(point: { x: number; y: number }): Promise<{ x: number; y: number }>;
    screenToDipRect(rect: RectLike): Promise<RectLike>;
    dipToScreenRect(rect: RectLike): Promise<RectLike>;
    capture(display?: unknown): Promise<NativeImage>;
    captureDisplay(display: number): Promise<NativeImage>;
    captureInteractive(timeout?: number): Promise<NativeImage | null>;
  }

  interface CopiedFile {
    path: string;
    isDirectory: boolean;
    isFile: boolean;
    name: string;
  }

  interface DbDoc {
    _id: string;
    _rev?: string;
    [field: string]: unknown;
  }

  interface DbResult {
    id: string;
    rev?: string;
    ok?: boolean;
    error?: string;
    name?: string;
    message?: string;
  }

  interface DbApi {
    put(doc: DbDoc & { _id?: string }): Promise<DbResult>;
    get(id: string): Promise<DbDoc | null>;
    remove(doc: { _id: string; _rev?: string } | string): Promise<DbResult>;
    bulkDocs(docs: Array<DbDoc & { _id?: string }>): Promise<DbResult[]>;
    allDocs(options?: { idStartsWith?: string; ids?: string[] }): Promise<DbDoc[]>;
    postAttachment(id: string, data: string, type: string): Promise<DbResult>;
    getAttachment(id: string): Promise<NativeImage>;
    getAttachmentType(id: string): Promise<string | null>;
    replicateStateFromCloud(): Promise<null>;
    readonly promises: DbApi;
  }

  interface Schedule {
    code: string;
    label?: string;
    /** A timestamp (one-shot) or a standard 5-field cron with an optional window. */
    trigger: number | { cron?: string; startTime?: number; endTime?: number };
  }

  interface ScheduleInfo extends Schedule {
    successCount: number;
    failureCount: number;
    lastExecuteAt?: number;
    lastStatus?: "success" | "failure";
  }

  interface ScheduleTrigger {
    code: string;
    label: string;
    /** Minute the task fired, in milliseconds. */
    at: number;
  }

  interface FeatureCmd {
    type: "regex" | "over" | "img" | "files" | "window";
    label: string;
    match?: string;
    exclude?: string;
    extensions?: string[];
    minLength?: number;
    maxLength?: number;
  }

  interface Feature {
    code: string;
    description?: string;
    icon?: string;
    platform?: string;
    mainHide?: boolean;
    mainPush?: boolean;
    cmds: Array<string | FeatureCmd>;
  }

  interface MatchPayload {
    type: "img" | "files";
    data: string | string[];
  }

  type SharpInput = string | { data: string } | { path: string } | { create: { width: number; height: number; background?: string } };

  interface SharpImage {
    resize(width?: number, height?: number): SharpImage;
    rotate(angle?: number): SharpImage;
    flip(): SharpImage;
    flop(): SharpImage;
    extract(rect: RectLike): SharpImage;
    extend(edges: { top?: number; bottom?: number; left?: number; right?: number; background?: string }): SharpImage;
    grayscale(): SharpImage;
    negate(): SharpImage;
    blur(sigma?: number): SharpImage;
    sharpen(sigma?: number, flat?: number, jagged?: number): SharpImage;
    threshold(level?: number): SharpImage;
    gamma(value?: number): SharpImage;
    flatten(background?: string): SharpImage;
    jpeg(options?: { quality?: number }): SharpImage;
    png(): SharpImage;
    webp(): SharpImage;
    tiff(): SharpImage;
    clone(): SharpImage;
    toBuffer(): Promise<Uint8Array>;
    toUint8Array(): Promise<Uint8Array>;
    toFile(path: string): Promise<{ path: string; width: number; height: number; format: string }>;
    metadata(): Promise<{ width: number; height: number; format: string }>;
  }

  interface UBrowserPage {
    url: string;
    title: string;
    text: string;
    html: string;
    /** Interaction steps that were refused because there is no embedded browser. */
    skipped: string[];
  }

  interface UBrowser {
    goto(url: string): { goto(url: string): unknown; run(): Promise<UBrowserPage> };
    run(): Promise<UBrowserPage>;
  }

  /**
   * `BrowserWindowConstructorOptions`, uTools / Electron shaped. Every field is accepted; the ones
   * WebView2 cannot honour (`roundedCorners: false`, `hasShadow`, `titleBarStyle`, …) are ignored
   * rather than refused, and the docs say which.
   */
  interface BrowserWindowOptions {
    show?: boolean;
    title?: string;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    x?: number;
    y?: number;
    center?: boolean;
    resizable?: boolean;
    movable?: boolean;
    minimizable?: boolean;
    maximizable?: boolean;
    closable?: boolean;
    frame?: boolean;
    hasShadow?: boolean;
    roundedCorners?: boolean;
    alwaysOnTop?: boolean;
    focusable?: boolean;
    skipTaskbar?: boolean;
    fullscreen?: boolean;
    opacity?: number;
    backgroundColor?: string;
    transparent?: boolean;
    titleBarStyle?: string;
    acceptFirstMouse?: boolean;
    /** Accepted for compatibility; the script does NOT run (no Node) — use the page itself. */
    webPreferences?: { preload?: string; [key: string]: unknown };
  }

  interface WebContents {
    id: number;
    /** Sends `channel` + args to the window's page (it receives them through `ipcRenderer.on`). */
    send(channel: string, ...args: unknown[]): Promise<void>;
    openDevTools(): void;
    closeDevTools(): void;
    isDevToolsOpened(): boolean;
    executeJavaScript(code: string): void;
    reload(): void;
  }

  /**
   * A window opened by `utools.createBrowserWindow`. Getters read a local mirror, so they answer
   * synchronously the way Electron's do; setters apply the mirror and tell the host.
   */
  interface BrowserWindow {
    readonly id: number;
    readonly webContents: WebContents;
    show(): void;
    showInactive(): void;
    hide(): void;
    close(): void;
    destroy(): void;
    isVisible(): boolean;
    isDestroyed(): boolean;
    isFocused(): boolean;
    focus(): void;
    blur(): void;
    setSize(width: number, height: number): void;
    getSize(): [number, number];
    setContentSize(width: number, height: number): void;
    getContentSize(): [number, number];
    setPosition(x: number, y: number): void;
    getPosition(): [number, number];
    setBounds(bounds: Partial<Rectangle> & { width?: number; height?: number }): void;
    getBounds(): Rectangle;
    getNormalBounds(): Rectangle;
    setContentBounds(bounds: Partial<Rectangle> & { width?: number; height?: number }): void;
    getContentBounds(): Rectangle;
    setMinimumSize(width: number, height: number): void;
    getMinimumSize(): [number, number];
    setMaximumSize(width: number, height: number): void;
    getMaximumSize(): [number, number];
    center(): void;
    setResizable(on: boolean): void;
    isResizable(): boolean;
    maximize(): void;
    unmaximize(): void;
    isMaximized(): boolean;
    minimize(): void;
    restore(): void;
    isMinimized(): boolean;
    isNormal(): boolean;
    setFullScreen(on: boolean): void;
    isFullScreen(): boolean;
    setClosable(on: boolean): void;
    isClosable(): boolean;
    setAlwaysOnTop(flag: boolean, level?: string): void;
    isAlwaysOnTop(): boolean;
    moveTop(): void;
    setTitle(title: string): void;
    getTitle(): string;
    setBackgroundColor(color: string): void;
    getBackgroundColor(): string;
    setOpacity(opacity: number): void;
    setSkipTaskbar(skip: boolean): void;
    setIgnoreMouseEvents(ignore: boolean): void;
    /** No-op on Windows with WebView2; kept so a plugin's call does not crash. */
    setHasShadow(_: boolean): void;
    hasShadow(): boolean;
    on(event: "closed" | "loaded" | "ready-to-show", fn: () => void): BrowserWindow;
  }

  interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  /** Page-side stand-in for Electron's `ipcRenderer`: `on(channel, …)` for window messages. */
  interface IpcRenderer {
    on(channel: string, fn: (event: unknown, ...args: unknown[]) => void): IpcRenderer;
    once(channel: string, fn: (event: unknown, ...args: unknown[]) => void): IpcRenderer;
    removeListener(channel: string, fn: Function): IpcRenderer;
    removeAllListeners(channel?: string): IpcRenderer;
    /** There is no main process: `send` goes to the parent window, like `utools.sendToParent`. */
    send(channel: string, ...args: unknown[]): Promise<void>;
    sendSync(...args: unknown[]): never;
  }
}

/** Present in every page, card and custom window alike. */
declare const ipcRenderer: WinWidget.IpcRenderer;

interface Window {
  readonly widget: WinWidget.Widget;
  readonly utools: WinWidget.Utools;
}
