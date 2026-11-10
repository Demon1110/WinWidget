// Embeds the icon and the version block into the Windows executable.
//
// The resource compiler only exists on Windows toolchains, so every other target
// returns early: the crate still builds on Linux/macOS for development.

fn main() {
    println!("cargo:rerun-if-changed=assets/logo.ico");
    println!("cargo:rerun-if-changed=build.rs");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let mut res = winresource::WindowsResource::new();
    res.set_icon("assets/logo.ico")
        .set("ProductName", "WinWidget")
        .set("FileDescription", "WinWidget — Windows 桌面小组件")
        .set("CompanyName", "WinWidget")
        .set("LegalCopyright", "GPL-3.0-only · WinWidget contributors")
        .set("OriginalFilename", "winwidget.exe")
        .set_language(0x0804); // zh-CN, matches the default UI language

    res.compile()
        .expect("embedding resources needs rc.exe (MSVC) or windres (MinGW) on PATH");
}
