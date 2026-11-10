//! Image helpers: PNG encoding for icons/covers, and small thumbnails for photo-frame widgets.

use std::path::Path;

/// Encodes raw RGBA bytes as a PNG.
pub fn encode_png(w: u32, h: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut buf = Vec::with_capacity((w * h * 4) as usize);
    {
        let encoder = ::image::codecs::png::PngEncoder::new(&mut buf);
        ::image::ImageEncoder::write_image(encoder, rgba, w, h, ::image::ExtendedColorType::Rgba8)
            .map_err(|e| e.to_string())?;
    }
    Ok(buf)
}

/// Decodes any supported image to RGBA.
pub fn decode_rgba(path: &Path) -> Result<(u32, u32, Vec<u8>), String> {
    let reader = ::image::ImageReader::open(path).map_err(|e| e.to_string())?;
    let img = reader.decode().map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    Ok((w, h, rgba.into_raw()))
}

/// A copy no wider than `max_width` (never upscaled), as PNG.
pub fn thumbnail(path: &Path, max_width: u32) -> Result<Vec<u8>, String> {
    let reader = ::image::ImageReader::open(path).map_err(|e| e.to_string())?;
    let img = reader.decode().map_err(|e| e.to_string())?;
    shrink(img, max_width)
}

/// The same, from bytes already in hand (a widget's icon, an album cover).
pub fn thumbnail_bytes(bytes: &[u8], max_width: u32) -> Result<Vec<u8>, String> {
    let img = ::image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    shrink(img, max_width)
}

fn shrink(img: ::image::DynamicImage, max_width: u32) -> Result<Vec<u8>, String> {
    let (w, h) = (img.width(), img.height());
    let target = max_width.min(w).max(1);
    let thumb = if target < w {
        let ratio = target as f64 / w as f64;
        img.resize(
            target,
            ((h as f64 * ratio).round() as u32).max(1),
            ::image::imageops::FilterType::Triangle,
        )
    } else {
        img
    };
    let rgba = thumb.to_rgba8();
    let (tw, th) = rgba.dimensions();
    encode_png(tw, th, &rgba.into_raw())
}

/// Image dimensions without decoding the whole file, for `files.info`.
pub fn dimensions(path: &Path) -> Option<(u32, u32)> {
    let reader = ::image::ImageReader::open(path).ok()?;
    reader.into_dimensions().ok()
}
