//! WinWidget — desktop widgets for Windows.
//!
//! A card is a borderless transparent window holding a WebView2 page served by a loopback HTTP
//! server; each page talks to the host over WebView2's message channel.
//!
//! The binary only wires things up: every module lives in the library crate (`src/lib.rs`).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::json;
use std::time::Duration;
use tao::event::{Event, StartCause, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use winwidget::core::{config, logging, paths, text};
use winwidget::model::catalog;
use winwidget::platform;
use winwidget::runtime::app::{self, App, Ev};
use winwidget::runtime::{bridge, window};
use winwidget::ui::{control, menus};
use winwidget::APP_VERSION;

fn main() {
    paths::init();
    logging::init(paths::get().log_file());
    // A GUI-subsystem build owns no console, so a panic would otherwise leave nothing behind but a
    // vanished process. Route it to the log file first.
    std::panic::set_hook(Box::new(|info| {
        logging::error(&format!("panic: {info}"));
        logging::error(&format!(
            "backtrace:\n{}",
            std::backtrace::Backtrace::force_capture()
        ));
    }));
    logging::info(&format!("WinWidget {APP_VERSION} starting"));

    let args: Vec<String> = std::env::args().skip(1).collect();
    // A release is one exe, so the update replaces it from the freshly downloaded copy. That copy
    // runs this branch and owns the work, so it must come before the single-instance check.
    if crate::platform::update::apply_from_args(&args) {
        return;
    }
    crate::platform::update::clean_downloads(&paths::get().local_dir);
    if !args.is_empty() {
        // The release build is a GUI-subsystem exe and owns no console: borrow the caller's one so
        // `winwidget list` prints where the user can see it, instead of into a void.
        attach_console();
        if run_cli(&args) {
            use std::io::Write;
            let _ = std::io::stdout().flush();
            return;
        }
    }
    if platform::single_instance().is_err() {
        logging::info("Another copy is already running; showing it");
        platform::open_control_center();
        return;
    }

    // One line saying where widgets, sdk and docs come from: a folder, or the copy inside the exe
    // (`embedded:/assets`). It is the first thing to look at when a packaged build behaves like the
    // source tree. The stray-profile sweep belongs here too: it may need the previous instance gone.
    logging::info(&format!("Assets: {}", paths::get().resource_root.display()));
    paths::clean_stray_profile();

    text::set_locale("auto");
    if config_low_resource() {
        // WebView2 reads this when it starts its browser process, so it has to be set first.
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-gpu --disable-gpu-compositing --js-flags=--lite-mode",
        );
    }

    let event_loop: tao::event_loop::EventLoop<Ev> =
        EventLoopBuilder::<Ev>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let mut app = App::new(proxy);
    // The saved language is the one everything should speak; "auto" follows Windows.
    text::set_locale(&app.cfg().language.clone());
    // The safety net behind page-driven dragging: works even when the web view missed the press.
    window::watch_presses(app.proxy.clone());
    app.refresh_tray_menu();
    {
        // Heartbeat of our own instead of tao's WaitUntil timer: tao's timer wakes the loop by
        // posting to its own event target, and such a message arriving inside a WebView build
        // re-enters tao's dispatcher and panics. Our posts are held back during a build instead.
        let proxy = app.proxy.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(250));
            if !app::post(&proxy, Ev::Tick) {
                return;
            }
        });
    }
    if app.cfg().instances.is_empty() {
        // First run: nothing on the desktop yet, so open the control center to explain itself.
        app.show_control(None);
    }

    event_loop.run(move |event, target, control| {
        app.flush_windows(target);

        match event {
            Event::NewEvents(StartCause::Init) => {
                *control = ControlFlow::Wait;
            }
            Event::NewEvents(StartCause::ResumeTimeReached { .. }) => {
                app.tick();
                app.watch_fullscreen();
                *control = ControlFlow::Wait;
            }
            Event::UserEvent(Ev::Ipc { win, msg }) => {
                if win == app::CONTROL_WIN {
                    control::handle(&mut app, &msg);
                } else if let Some(id) = win.strip_prefix("win:").and_then(|v| v.parse::<u32>().ok())
                {
                    if let Some(instance) = app.customs.get(&id).map(|w| w.instance.clone()) {
                        bridge::handle_window(&mut app, &instance, id, &msg);
                    }
                } else {
                    bridge::handle(&mut app, &win, &msg);
                }
                *control = ControlFlow::Wait;
            }
            Event::UserEvent(Ev::Reply { win, body }) => {
                app.send_to(&win, &body);
                *control = ControlFlow::Wait;
            }
            Event::UserEvent(Ev::Sample(value)) => {
                app.dispatch_sample(&value);
                *control = ControlFlow::Wait;
            }
            Event::UserEvent(Ev::Audio(value)) => {
                let ids: Vec<String> = app.audio_subs.iter().cloned().collect();
                for id in ids {
                    app.event_to(&id, "audio", value.clone());
                }
                *control = ControlFlow::Wait;
            }
            Event::UserEvent(Ev::Media(value)) => {
                let ids: Vec<String> = app.media_subs.iter().cloned().collect();
                for id in ids {
                    app.event_to(&id, "media", value.clone());
                }
                *control = ControlFlow::Wait;
            }
            Event::UserEvent(Ev::Command(action)) => {
                menus::run(&mut app, &action);
                app.after_command();
                *control = ControlFlow::Wait;
            }
            Event::UserEvent(Ev::Wake) => {
                // The window is built by the `flush_windows` at the top of the next iteration; this
                // event exists only to make that iteration happen now.
                *control = ControlFlow::Wait;
            }
            Event::UserEvent(Ev::Tick) => {
                // The heartbeat thread drives the clock: tao's own WaitUntil timer wakes the loop
                // by posting to its event target, which panics when it lands inside a build.
                app.tick();
                app.watch_fullscreen();
                *control = ControlFlow::Wait;
            }
            Event::WindowEvent {
                window_id,
                event: WindowEvent::CloseRequested,
                ..
            } => {
                if app.control.as_ref().map(|c| c.window.id()) == Some(window_id) {
                    if let Some(control_win) = &app.control {
                        control_win.window.set_visible(false);
                    }
                } else if let Some(id) = app
                    .customs
                    .iter()
                    .find(|(_, win)| win.window.id() == window_id)
                    .map(|(key, _)| *key)
                {
                    // The user pressed the title bar's ×: only a closable window goes away, exactly
                    // like Electron's `closable: false`.
                    let closable = app.customs.get(&id).map(|win| win.closable).unwrap_or(true);
                    if closable {
                        app.close_custom(id);
                    }
                }
                *control = ControlFlow::Wait;
            }
            // A card's size is the page's business: a widget uses it to lay itself out again.
            // (Focus is deliberately not reported: a card never takes the keyboard focus, so a
            // focus event would only ever be a promise the host does not keep.)
            Event::WindowEvent {
                window_id,
                event: WindowEvent::Resized(_size),
                ..
            } => {
                if let Some(id) = app.instance_of_window(window_id) {
                    // The card's own size, not the window's: the shadow margin around it is not part
                    // of the layout, and `window.getSize()` reports the same number, in CSS pixels.
                    if let Some(win) = app.windows.get(&id) {
                        let scale = win.scale;
                        let card = win.card;
                        let width = (card.width() as f64 / scale).round();
                        let height = (card.height() as f64 / scale).round();
                        app.event_to(&id, "resize", json!({ "width": width, "height": height }));
                    }
                }
                *control = ControlFlow::Wait;
            }
            Event::WindowEvent {
                window_id,
                event: WindowEvent::Destroyed,
                ..
            } => {
                app.forget_window(window_id);
                *control = ControlFlow::Wait;
            }
            Event::LoopDestroyed => {
                app.finish_quit();
                return;
            }
            _ => {}
        }

        if app.quitting {
            // Cards get a beat to answer their unload before the loop is torn down; the deadline
            // doubles as the wait target, so the heartbeat is not needed to wake us.
            match app.quit_at {
                Some(at) if std::time::Instant::now() < at => *control = ControlFlow::WaitUntil(at),
                Some(_) => {
                    app.finish_quit();
                    *control = ControlFlow::Exit;
                }
                None => *control = ControlFlow::Exit,
            }
        }
    });
}

fn config_low_resource() -> bool {
    config::ConfigStore::load().data.low_resource_mode
}

/// Gives a GUI-subsystem build a console to write to: the caller's if there is one, else a new one.
fn attach_console() {
    use windows::Win32::System::Console::{AllocConsole, AttachConsole, ATTACH_PARENT_PROCESS};
    unsafe {
        if AttachConsole(ATTACH_PARENT_PROCESS).is_err() {
            let _ = AllocConsole();
        }
    }
}

/// Headless commands for scripts. Anything that would race a running copy is refused rather than
/// writing config.json behind its back.
fn run_cli(args: &[String]) -> bool {
    let command = args[0].to_ascii_lowercase();
    match command.as_str() {
        "--version" | "-v" | "version" => {
            println!("WinWidget {APP_VERSION}");
            true
        }
        "list" => {
            let mut catalog = catalog::Catalog::default();
            catalog.scan();
            let store = config::ConfigStore::load();
            for inst in &store.data.instances {
                let name = catalog
                    .find(&inst.widget)
                    .map(|m| m.display_name())
                    .unwrap_or_else(|| inst.widget.clone());
                println!(
                    "{}  {}  {}x{}  ({}, {})  {}",
                    inst.id,
                    name,
                    inst.width as i64,
                    inst.height as i64,
                    inst.x,
                    inst.y,
                    inst.layer
                );
            }
            for manifest in catalog.sorted() {
                println!(
                    "widget  {}  {}  v{}",
                    manifest.id,
                    manifest.display_name(),
                    manifest.version
                );
            }
            true
        }
        "add" => {
            let Some(widget) = args.get(1) else {
                eprintln!("usage: winwidget add <widget-id>");
                return true;
            };
            let mut catalog = catalog::Catalog::default();
            catalog.scan();
            let Some(manifest) = catalog.find(widget).cloned() else {
                eprintln!("no widget called {widget}");
                return true;
            };
            if platform::single_instance().is_err() {
                eprintln!("WinWidget is running — add widgets in the control center instead");
                return true;
            }
            let mut store = config::ConfigStore::load();
            let inst = config::InstanceConfig {
                widget: manifest.id.clone(),
                width: manifest.size.width,
                height: manifest.size.height,
                ..config::InstanceConfig::default()
            };
            store.data.instances.push(inst.clone());
            store.save();
            println!("{}", inst.id);
            true
        }
        "remove" => {
            let Some(id) = args.get(1) else {
                eprintln!("usage: winwidget remove <instance-id>");
                return true;
            };
            if platform::single_instance().is_err() {
                eprintln!("WinWidget is running — remove widgets in the control center instead");
                return true;
            }
            let mut store = config::ConfigStore::load();
            let before = store.data.instances.len();
            store.data.instances.retain(|i| i.id != *id);
            store.save();
            println!(
                "{}",
                if store.data.instances.len() < before {
                    "removed"
                } else {
                    "no instance with that id"
                }
            );
            true
        }
        "install" => {
            eprintln!("Start WinWidget and drop the .fwz or a uTools .upx on the control center, or use it there.");
            true
        }
        "help" | "--help" | "-h" => {
            println!(
                "WinWidget {APP_VERSION}\n\n  winwidget               start the app\n  winwidget list          widgets and cards\n  winwidget add <id>      put a widget on the desktop\n  winwidget remove <id>   take a card off the desktop\n  winwidget install       how to install a .fwz or a .upx\n  winwidget --version"
            );
            true
        }
        _ => false,
    }
}
