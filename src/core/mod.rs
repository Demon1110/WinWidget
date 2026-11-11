//! The core of the app: configuration, assets, storage and the uTools API categories.
//!
//! The categories are files, one per uTools documentation page, so a reader who knows the uTools API
//! knows where to look here:
//!
//! - `events`     事件 — the notifications a page and the host exchange without an `id`
//! - `window`     窗口 — cards, the main window, `createBrowserWindow`
//! - `system`     系统 — device figures, folders, shells, notifications
//! - `screen`     屏幕 — displays, DIP/pixel conversion, screen pictures
//! - `input`      输入 — paste/type into the window the user came from
//! - `clipboard`  复制 — text, files and pictures on the clipboard
//! - `db`         数据库 — documents and attachments per widget
//! - `ai`         AI 能力 — reserved
//! - `schedule`   定时任务 — cron style schedules
//! - `simulate`   模拟操作 — keyboard and mouse injection
//! - `features`   动态功能 — commands added at runtime
//! - `redirect`   快捷入口 — send a command label to the widget that owns it
//! - `ubrowser`   uBrowser — page fetching (no embedded browser)
//! - `sharp`      Sharp — picture pipeline
//! - `ffmpeg`     FFmpeg — reserved
//! - `payment`    支付 — reserved
//!
//! `widget` holds WinWidget's own protocol (settings, storage, audio, media, files, power, net),
//! and `api` is the dispatcher that walks the list.

pub mod api;
pub mod assets;
pub mod clipboard;
pub mod config;
pub mod db;
pub mod events;
pub mod features;
pub mod img;
pub mod input;
pub mod logging;
pub mod net;
pub mod paths;
pub mod redirect;
pub mod schedule;
pub mod screen;
pub mod sharp;
pub mod simulate;
pub mod storage;
pub mod system;
pub mod text;
pub mod ubrowser;
pub mod util;
pub mod widget;
pub mod window;
pub mod ai;
pub mod ffmpeg;
pub mod payment;
