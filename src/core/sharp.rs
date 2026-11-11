//! Sharp 图片处理 category: a chain of picture operations, run on the host.
//!
//! uTools hands out a real Sharp instance (a Node native module). WinWidget has the pure-Rust
//! `image` crate instead, so the page builds a list of steps and this file runs them with a builder
//! (`Pipeline`): resize, rotate, flip, flop, extract, extend, grayscale, negate, blur, sharpen,
//! threshold, gamma, flatten, then encode to JPEG/PNG/WebP into a buffer or a file.
//!
//! Anything Sharp can do that `image` cannot (composite, tint, median, animated joins) is refused by
//! name, so a page gets a clear reason instead of a silently different picture.

use crate::core::api::{Ctx, Reply};
use crate::core::util::{jnum, jstr, BridgeError, BridgeResult};
use crate::platform::win32 as w;
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, RgbaImage};
use serde_json::{json, Value};

const OWNS: &[&str] = &["sharp.run"];

pub fn call(ctx: &mut Ctx, method: &str, p: &Value) -> Option<BridgeResult<Reply>> {
    if !OWNS.contains(&method) {
        return None;
    }
    Some(handle(ctx, method, p))
}

fn handle(ctx: &mut Ctx, method: &str, p: &Value) -> BridgeResult<Reply> {
    debug_assert_eq!(method, "sharp.run");
    ctx.require("sharp")?;
    let input = p.get("input").cloned().unwrap_or(Value::Null);
    let ops = p
        .get("ops")
        .and_then(|o| o.as_array())
        .cloned()
        .unwrap_or_default();
    let output = p.get("output").cloned().unwrap_or(Value::Null);
    ctx.spawn_reply(move || run(input, ops, output));
    Ok(Reply::Later)
}

/// One picture, its steps, its output. Everything below is pure data, which is why it runs on a
/// worker thread away from the UI.
struct Pipeline {
    image: DynamicImage,
}

impl Pipeline {
    fn new(input: &Value) -> BridgeResult<Pipeline> {
        let image = load_input(input)?;
        Ok(Pipeline { image })
    }

    fn apply(&mut self, step: &Value) -> BridgeResult<()> {
        let op = jstr(step, "op").unwrap_or_default();
        match op.as_str() {
            "resize" => {
                let width = jnum(step, "width").map(|v| v.max(1.0) as u32);
                let height = jnum(step, "height").map(|v| v.max(1.0) as u32);
                let (iw, ih) = (self.image.width(), self.image.height());
                let (w, h) = match (width, height) {
                    (Some(w), Some(h)) => (w, h),
                    (Some(w), None) => {
                        let h = ((f64::from(ih) * f64::from(w)) / f64::from(iw)).round() as u32;
                        (w, h.max(1))
                    }
                    (None, Some(h)) => {
                        let w = ((f64::from(iw) * f64::from(h)) / f64::from(ih)).round() as u32;
                        (w.max(1), h)
                    }
                    (None, None) => {
                        return Err(BridgeError::new("resize needs a width or a height"))
                    }
                };
                self.image = self.image.resize_exact(w, h, FilterType::Lanczos3);
                Ok(())
            }
            "rotate" => {
                let angle = jnum(step, "angle").unwrap_or(0.0).rem_euclid(360.0);
                self.image = rotate(self.image.clone(), angle);
                Ok(())
            }
            // Sharp's `flip` turns the picture upside down, `flop` mirrors it left to right.
            "flip" => {
                self.image = self.image.flipv();
                Ok(())
            }
            "flop" => {
                self.image = self.image.fliph();
                Ok(())
            }
            "extract" => {
                let left = jnum(step, "left").unwrap_or(0.0).max(0.0) as u32;
                let top = jnum(step, "top").unwrap_or(0.0).max(0.0) as u32;
                let width = jnum(step, "width").unwrap_or(0.0).max(1.0) as u32;
                let height = jnum(step, "height").unwrap_or(0.0).max(1.0) as u32;
                let max_w = self.image.width().saturating_sub(left);
                let max_h = self.image.height().saturating_sub(top);
                if max_w == 0 || max_h == 0 {
                    return Err(BridgeError::new("extract is outside the picture"));
                }
                self.image = self.image.crop_imm(left, top, width.min(max_w), height.min(max_h));
                Ok(())
            }
            "extend" => {
                let top = jnum(step, "top").unwrap_or(0.0).max(0.0) as u32;
                let right = jnum(step, "right").unwrap_or(0.0).max(0.0) as u32;
                let bottom = jnum(step, "bottom").unwrap_or(0.0).max(0.0) as u32;
                let left = jnum(step, "left").unwrap_or(0.0).max(0.0) as u32;
                let color = color_of(step.get("background").and_then(|b| b.as_str()));
                let (iw, ih) = (self.image.width(), self.image.height());
                let mut canvas = RgbaImage::from_pixel(
                    iw + left + right,
                    ih + top + bottom,
                    color,
                );
                image::imageops::overlay(&mut canvas, &self.image.to_rgba8(), i64::from(left), i64::from(top));
                self.image = DynamicImage::ImageRgba8(canvas);
                Ok(())
            }
            "grayscale" => {
                self.image = self.image.grayscale();
                Ok(())
            }
            "negate" => {
                let mut rgba = self.image.to_rgba8();
                for px in rgba.pixels_mut() {
                    px.0[0] = 255 - px.0[0];
                    px.0[1] = 255 - px.0[1];
                    px.0[2] = 255 - px.0[2];
                }
                self.image = DynamicImage::ImageRgba8(rgba);
                Ok(())
            }
            "blur" => {
                let sigma = jnum(step, "sigma").unwrap_or(1.0).max(0.1) as f32;
                self.image = DynamicImage::ImageRgba8(image::imageops::blur(
                    &self.image.to_rgba8(),
                    sigma,
                ));
                Ok(())
            }
            "sharpen" => {
                let sigma = jnum(step, "sigma").unwrap_or(1.0).max(0.1) as f32;
                let threshold = jnum(step, "threshold").unwrap_or(0.0) as i32;
                self.image = DynamicImage::ImageRgba8(image::imageops::unsharpen(
                    &self.image.to_rgba8(),
                    sigma,
                    threshold,
                ));
                Ok(())
            }
            "threshold" => {
                let level = jnum(step, "threshold").unwrap_or(128.0).clamp(0.0, 255.0) as u8;
                let mut rgba = self.image.to_rgba8();
                for px in rgba.pixels_mut() {
                    let luma = (u32::from(px.0[0]) * 299
                        + u32::from(px.0[1]) * 587
                        + u32::from(px.0[2]) * 114)
                        / 1000;
                    let value = if luma >= u32::from(level) { 255 } else { 0 };
                    px.0[0] = value;
                    px.0[1] = value;
                    px.0[2] = value;
                }
                self.image = DynamicImage::ImageRgba8(rgba);
                Ok(())
            }
            "gamma" => {
                let g = jnum(step, "gamma").unwrap_or(1.0).max(0.01);
                let table: Vec<u8> = (0..256)
                    .map(|i| {
                        let v = (i as f64 / 255.0).powf(1.0 / g) * 255.0;
                        v.clamp(0.0, 255.0).round() as u8
                    })
                    .collect();
                let mut rgba = self.image.to_rgba8();
                for px in rgba.pixels_mut() {
                    px.0[0] = table[usize::from(px.0[0])];
                    px.0[1] = table[usize::from(px.0[1])];
                    px.0[2] = table[usize::from(px.0[2])];
                }
                self.image = DynamicImage::ImageRgba8(rgba);
                Ok(())
            }
            "flatten" => {
                let color = color_of(step.get("background").and_then(|b| b.as_str()));
                let rgba = self.image.to_rgba8();
                let mut canvas = RgbaImage::from_pixel(rgba.width(), rgba.height(), color);
                image::imageops::overlay(&mut canvas, &rgba, 0, 0);
                self.image = DynamicImage::ImageRgba8(canvas);
                Ok(())
            }
            "tint" | "median" | "composite" | "trim" | "normalize" => Err(BridgeError::new(format!(
                "sharp.{op} is not available in this build (the image crate has no equivalent)"
            ))),
            other => Err(BridgeError::new(format!("unknown sharp op '{other}'"))),
        }
    }
}

fn run(input: Value, ops: Vec<Value>, output: Value) -> BridgeResult<Value> {
    let mut pipeline = Pipeline::new(&input)?;
    for step in &ops {
        pipeline.apply(step)?;
    }
    let format = jstr(&output, "format").unwrap_or_else(|| "png".into());
    let target = jstr(&output, "target").unwrap_or_else(|| "buffer".into());
    let (width, height) = (pipeline.image.width(), pipeline.image.height());
    if target == "metadata" {
        return Ok(json!({ "width": width, "height": height, "format": format }));
    }
    let encoded = encode(&pipeline.image, &format, jnum(&output, "quality"))?;
    if target == "file" {
        let path = jstr(&output, "path")
            .filter(|p| !p.is_empty())
            .ok_or_else(|| BridgeError::new("output.path is required for toFile()"))?;
        if let Some(dir) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(dir).map_err(|e| BridgeError::new(e.to_string()))?;
        }
        std::fs::write(&path, &encoded).map_err(|e| BridgeError::new(e.to_string()))?;
        return Ok(json!({
            "path": path, "width": width, "height": height, "format": format,
        }));
    }
    Ok(json!({
        "data": w::base64(&encoded),
        "width": width,
        "height": height,
        "format": format,
    }))
}

/// Whatever the page passed in: a path, a data URL, bare base64, or `{ create: {…} }`.
fn load_input(input: &Value) -> BridgeResult<DynamicImage> {
    if let Some(create) = input.get("create") {
        let width = jnum(create, "width").unwrap_or(1.0).max(1.0) as u32;
        let height = jnum(create, "height").unwrap_or(1.0).max(1.0) as u32;
        let color = color_of(create.get("background").and_then(|b| b.as_str()));
        return Ok(DynamicImage::ImageRgba8(RgbaImage::from_pixel(
            width, height, color,
        )));
    }
    if let Some(path) = input.get("path").and_then(|p| p.as_str()) {
        return image::ImageReader::open(path)
            .map_err(|e| BridgeError::new(e.to_string()))?
            .decode()
            .map_err(|e| BridgeError::new(e.to_string()));
    }
    if let Some(data) = input.get("data").and_then(|d| d.as_str()) {
        let bytes = crate::core::clipboard::read_image_source(data)?;
        return image::load_from_memory(&bytes).map_err(|e| BridgeError::new(e.to_string()));
    }
    Err(BridgeError::new("sharp input must be a path, a data URL or { create }"))
}

fn encode(image: &DynamicImage, format: &str, quality: Option<f64>) -> BridgeResult<Vec<u8>> {
    let mut bytes = Vec::new();
    match format {
        "png" => image
            .write_to(&mut std::io::Cursor::new(&mut bytes), ImageFormat::Png)
            .map_err(|e| BridgeError::new(e.to_string()))?,
        "jpeg" | "jpg" => {
            let rgb = image.to_rgb8();
            let (w, h) = (rgb.width(), rgb.height());
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                &mut bytes,
                quality.unwrap_or(85.0).clamp(1.0, 100.0) as u8,
            );
            encoder
                .encode(&rgb, w, h, image::ExtendedColorType::Rgb8)
                .map_err(|e| BridgeError::new(e.to_string()))?;
        }
        "webp" => image
            .write_to(&mut std::io::Cursor::new(&mut bytes), ImageFormat::WebP)
            .map_err(|e| BridgeError::new(e.to_string()))?,
        "tiff" | "tif" => image
            .write_to(&mut std::io::Cursor::new(&mut bytes), ImageFormat::Tiff)
            .map_err(|e| BridgeError::new(e.to_string()))?,
        other => return Err(BridgeError::new(format!("unsupported output format '{other}'"))),
    }
    Ok(bytes)
}

/// `background` as `#rgb`, `#rrggbb`, `{r,g,b}` or `transparent`; transparent when absent.
fn color_of(spec: Option<&str>) -> image::Rgba<u8> {
    let spec = spec.unwrap_or("transparent");
    if let Some((r, g, b)) = crate::core::util::parse_color(spec) {
        return image::Rgba([r, g, b, 255]);
    }
    image::Rgba([0, 0, 0, 0])
}

/// Rotation at any angle, bilinear sampled; 90/180/270 go through `image`'s own exact paths.
fn rotate(image: DynamicImage, angle: f64) -> DynamicImage {
    match angle.round() as i64 {
        0 => image,
        90 => image.rotate90(),
        180 => image.rotate180(),
        270 => image.rotate270(),
        _ => {
            let rad = angle.to_radians();
            let (cos, sin) = (rad.cos(), rad.sin());
            let src = image.to_rgba8();
            let (sw, sh) = (src.width() as f64, src.height() as f64);
            let (dw, dh) = (
                (sw * cos.abs() + sh * sin.abs()).ceil(),
                (sw * sin.abs() + sh * cos.abs()).ceil(),
            );
            let mut out = RgbaImage::new(dw as u32, dh as u32);
            let (cx, cy) = (dw / 2.0, dh / 2.0);
            let (scx, scy) = (sw / 2.0, sh / 2.0);
            for y in 0..out.height() {
                for x in 0..out.width() {
                    let dx = f64::from(x) + 0.5 - cx;
                    let dy = f64::from(y) + 0.5 - cy;
                    let sx = dx * cos + dy * sin + scx - 0.5;
                    let sy = -dx * sin + dy * cos + scy - 0.5;
                    if sx < 0.0 || sy < 0.0 || sx >= sw - 1.0 || sy >= sh - 1.0 {
                        continue;
                    }
                    let (x0, y0) = (sx.floor() as u32, sy.floor() as u32);
                    let (fx, fy) = (sx - f64::from(x0), sy - f64::from(y0));
                    let p00 = src.get_pixel(x0, y0).0;
                    let p10 = src.get_pixel(x0 + 1, y0).0;
                    let p01 = src.get_pixel(x0, y0 + 1).0;
                    let p11 = src.get_pixel(x0 + 1, y0 + 1).0;
                    let mut px = [0u8; 4];
                    for c in 0..4 {
                        let top = f64::from(p00[c]) * (1.0 - fx) + f64::from(p10[c]) * fx;
                        let bottom = f64::from(p01[c]) * (1.0 - fx) + f64::from(p11[c]) * fx;
                        px[c] = (top * (1.0 - fy) + bottom * fy).round().clamp(0.0, 255.0) as u8;
                    }
                    out.put_pixel(x, y, image::Rgba(px));
                }
            }
            DynamicImage::ImageRgba8(out)
        }
    }
}
