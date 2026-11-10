//! Simplified ↔ traditional Chinese, using the conversion tables Windows ships
//! (`LCMapStringEx`), so nothing has to be bundled.

use crate::platform::win32 as w;

const LCMAP_TRADITIONAL_CHINESE: u32 = 0x0400_0000;
const LCMAP_SIMPLIFIED_CHINESE: u32 = 0x0200_0000;

/// `to` is "traditional" (default) or "simplified".
pub fn convert(text: &str, to: &str) -> String {
    let (locale, flag) = if to.eq_ignore_ascii_case("simplified") || to.eq_ignore_ascii_case("zh-cn") {
        ("zh-CN", LCMAP_SIMPLIFIED_CHINESE)
    } else {
        ("zh-TW", LCMAP_TRADITIONAL_CHINESE)
    };
    let source: Vec<u16> = text.encode_utf16().collect();
    let mut dest = vec![0u16; source.len() + 16];
    let locale_w = w::wide(locale);
    let written = unsafe {
        w::LCMapStringEx(
            locale_w.as_ptr(),
            flag,
            source.as_ptr(),
            source.len() as i32,
            dest.as_mut_ptr(),
            dest.len() as i32,
            std::ptr::null(),
            0,
            0,
        )
    };
    if written <= 0 {
        return text.to_string();
    }
    let mut buf = dest;
    buf.truncate(written as usize);
    String::from_utf16_lossy(&buf)
}
