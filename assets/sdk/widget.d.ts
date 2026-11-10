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
      /**
       * Full paths of files dropped on the widget. Needs "shell.launch".
       *   document.addEventListener("drop", async e => { e.preventDefault(); add(await widget.shell.paths(e.dataTransfer.files)); });
       */
      paths(files: FileList | File[]): Promise<string[]>;
    };

    /** Simplified ↔ Traditional Chinese, character by character, with Windows' own tables. */
    convertChinese(text: string, to: "traditional" | "simplified"): Promise<string>;

    window: {
      getSize(): Promise<Size>;
      /** Clamped to the min/max size in widget.json. */
      setSize(width: number, height: number): Promise<Size>;
      /** Starts moving the widget with the mouse (call from a mousedown handler). */
      startDrag(): void;
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

interface Window {
  readonly widget: WinWidget.Widget;
}
