use anyhow::{Context, Result};
use base64::Engine;
use exif::{In, Reader as ExifReader, Tag, Value as ExifValue};
use image::{
    codecs::jpeg::JpegEncoder, codecs::png::PngEncoder, codecs::webp::WebPEncoder, DynamicImage,
    GenericImageView, ImageEncoder, Rgba, RgbaImage,
};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::Path;

/// Target format for converted blog images.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputImageFormat {
    Webp,
    Jpeg,
    Png,
}

impl OutputImageFormat {
    pub fn extension(&self) -> &'static str {
        match self {
            OutputImageFormat::Webp => "webp",
            OutputImageFormat::Jpeg => "jpg",
            OutputImageFormat::Png => "png",
        }
    }

    pub fn mime_type(&self) -> &'static str {
        match self {
            OutputImageFormat::Webp => "image/webp",
            OutputImageFormat::Jpeg => "image/jpeg",
            OutputImageFormat::Png => "image/png",
        }
    }
}

/// Color grading presets tailored for blog photography.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterPreset {
    Original,
    FilmWarm,
    VintageFade,
    Monochrome,
    VividPop,
    CoolCinema,
}

/// Decorative border/frame styles for blog images.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameStyle {
    None,
    MinimalWhite,
    Polaroid,
    RoundedShadow,
}

/// Normalized crop rectangle (values in 0.0..=1.0).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CropRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// Non-destructive image editing recipe saved in Git alongside raw assets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageRecipe {
    pub filter: FilterPreset,
    /// -100 to +100
    pub brightness: i32,
    /// -100 to +100
    pub contrast: i32,
    /// -100 to +100
    pub saturation: i32,
    pub crop: Option<CropRect>,
    pub frame: FrameStyle,
    pub watermark_text: Option<String>,
    pub output_format: OutputImageFormat,
    pub max_width: u32,
    pub strip_gps_metadata: bool,
}

impl Default for ImageRecipe {
    fn default() -> Self {
        Self {
            filter: FilterPreset::Original,
            brightness: 0,
            contrast: 0,
            saturation: 0,
            crop: None,
            frame: FrameStyle::None,
            watermark_text: None,
            output_format: OutputImageFormat::Webp,
            max_width: 1280,
            strip_gps_metadata: true,
        }
    }
}

/// Extracted EXIF camera shoot info (safe for blog display) + privacy check result.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExifShootInfo {
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub focal_length: Option<String>,
    pub aperture: Option<String>,
    pub shutter_speed: Option<String>,
    pub iso: Option<String>,
    pub orientation: u16,
    pub had_gps_data: bool,
}

impl ExifShootInfo {
    /// Formats a clean one-line photography caption like:
    /// `"iPhone 15 Pro · 24mm · f/1.78 · 1/120s · ISO 64"`
    pub fn formatted_summary(&self) -> Option<String> {
        let mut parts = Vec::new();
        if let Some(model) = &self.camera_model {
            let trimmed = model.trim();
            if !trimmed.is_empty() {
                parts.push(trimmed.to_string());
            }
        } else if let Some(make) = &self.camera_make {
            let trimmed = make.trim();
            if !trimmed.is_empty() {
                parts.push(trimmed.to_string());
            }
        }

        if let Some(fl) = &self.focal_length {
            parts.push(fl.clone());
        }
        if let Some(ap) = &self.aperture {
            parts.push(ap.clone());
        }
        if let Some(ss) = &self.shutter_speed {
            parts.push(ss.clone());
        }
        if let Some(iso) = &self.iso {
            parts.push(iso.clone());
        }

        if parts.is_empty() {
            None
        } else {
            Some(parts.join(" · "))
        }
    }
}

/// Result of running an image through the Rust Image Studio pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessedImageOutput {
    pub encoded_bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub format: OutputImageFormat,
    pub original_size_bytes: usize,
    pub processed_size_bytes: usize,
    pub exif_info: ExifShootInfo,
    pub gps_removed_verified: bool,
    pub preview_data_url: String,
}

/// Extracts EXIF shoot info and detects whether GPS coordinates exist in raw image bytes.
pub fn extract_exif_info(raw_bytes: &[u8]) -> ExifShootInfo {
    let mut info = ExifShootInfo {
        orientation: 1,
        ..Default::default()
    };

    let mut cursor = Cursor::new(raw_bytes);
    let Ok(exif) = ExifReader::new().read_from_container(&mut cursor) else {
        return info;
    };

    if let Some(field) = exif.get_field(Tag::Make, In::PRIMARY) {
        info.camera_make = Some(clean_exif_str(&field.display_value().to_string()));
    }
    if let Some(field) = exif.get_field(Tag::Model, In::PRIMARY) {
        info.camera_model = Some(clean_exif_str(&field.display_value().to_string()));
    }
    if let Some(field) = exif.get_field(Tag::FocalLengthIn35mmFilm, In::PRIMARY) {
        if let ExifValue::Short(ref v) = field.value {
            if let Some(&fl) = v.first() {
                if fl > 0 {
                    info.focal_length = Some(format!("{}mm", fl));
                }
            }
        }
    }
    if info.focal_length.is_none() {
        if let Some(field) = exif.get_field(Tag::FocalLength, In::PRIMARY) {
            if let ExifValue::Rational(ref v) = field.value {
                if let Some(r) = v.first() {
                    if r.denom != 0 {
                        let mm = r.num as f32 / r.denom as f32;
                        if (mm - mm.round()).abs() < 0.05 {
                            info.focal_length = Some(format!("{}mm", mm.round() as u32));
                        } else {
                            info.focal_length = Some(format!("{:.1}mm", mm));
                        }
                    }
                }
            }
        }
    }

    if let Some(field) = exif.get_field(Tag::FNumber, In::PRIMARY) {
        if let ExifValue::Rational(ref v) = field.value {
            if let Some(r) = v.first() {
                if r.denom != 0 {
                    let f = r.num as f32 / r.denom as f32;
                    let formatted = format!("{:.2}", f);
                    let trimmed = formatted.trim_end_matches('0').trim_end_matches('.');
                    info.aperture = Some(format!("f/{}", trimmed));
                }
            }
        }
    }

    if let Some(field) = exif.get_field(Tag::ExposureTime, In::PRIMARY) {
        if let ExifValue::Rational(ref v) = field.value {
            if let Some(r) = v.first() {
                if r.num > 0 && r.denom > 0 {
                    if r.num < r.denom {
                        let denom = (r.denom as f32 / r.num as f32).round() as u32;
                        info.shutter_speed = Some(format!("1/{}s", denom));
                    } else {
                        let secs = r.num as f32 / r.denom as f32;
                        info.shutter_speed = Some(format!("{:.1}s", secs));
                    }
                }
            }
        }
    }

    if let Some(field) = exif.get_field(Tag::PhotographicSensitivity, In::PRIMARY) {
        if let ExifValue::Short(ref v) = field.value {
            if let Some(&iso) = v.first() {
                info.iso = Some(format!("ISO {}", iso));
            }
        }
    }

    if let Some(field) = exif.get_field(Tag::Orientation, In::PRIMARY) {
        if let ExifValue::Short(ref v) = field.value {
            if let Some(&o) = v.first() {
                info.orientation = o;
            }
        }
    }

    let gps_tags = [
        Tag::GPSLatitude,
        Tag::GPSLongitude,
        Tag::GPSAltitude,
        Tag::GPSLatitudeRef,
        Tag::GPSLongitudeRef,
    ];
    info.had_gps_data = gps_tags
        .iter()
        .any(|&t| exif.get_field(t, In::PRIMARY).is_some());

    info
}

/// Checks if encoded image bytes contain any GPS EXIF metadata.
pub fn has_gps_metadata(image_bytes: &[u8]) -> bool {
    extract_exif_info(image_bytes).had_gps_data
}

fn clean_exif_str(s: &str) -> String {
    s.trim().trim_matches('"').trim().to_string()
}

/// Loads an image from path, automatically handling iPhone `.heic`/`.heif` on macOS via `sips`
/// while preserving raw EXIF extraction from the original file.
pub fn load_image_from_path(path: &Path) -> Result<(DynamicImage, Vec<u8>)> {
    let raw_bytes =
        std::fs::read(path).with_context(|| format!("Failed to read image: {}", path.display()))?;

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "heic" || ext == "heif" {
        let decoded = decode_heic_with_macos_sips(path)?;
        return Ok((decoded, raw_bytes));
    }

    match image::load_from_memory(&raw_bytes) {
        Ok(img) => Ok((img, raw_bytes)),
        Err(_) => {
            // Fallback to macOS sips for Apple container formats
            let decoded = decode_heic_with_macos_sips(path)?;
            Ok((decoded, raw_bytes))
        }
    }
}

fn decode_heic_with_macos_sips(path: &Path) -> Result<DynamicImage> {
    let tmp_png = std::env::temp_dir().join(format!("writer_heic_{}.png", uuid::Uuid::new_v4()));
    let status = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "png"])
        .arg(path)
        .arg("--out")
        .arg(&tmp_png)
        .output()
        .context("Failed to execute /usr/bin/sips for HEIC conversion")?;

    if !status.status.success() {
        anyhow::bail!(
            "sips failed to convert HEIC image: {}",
            String::from_utf8_lossy(&status.stderr)
        );
    }

    let png_bytes = std::fs::read(&tmp_png)?;
    let _ = std::fs::remove_file(&tmp_png);
    let img = image::load_from_memory(&png_bytes)?;
    Ok(img)
}

/// Processes raw image bytes using the non-destructive `ImageRecipe`.
pub fn process_image_bytes(raw_bytes: &[u8], recipe: &ImageRecipe) -> Result<ProcessedImageOutput> {
    let exif_info = extract_exif_info(raw_bytes);
    let img = image::load_from_memory(raw_bytes).context("Failed to decode input image bytes")?;
    process_loaded_image(img, raw_bytes.len(), exif_info, recipe)
}

/// Processes an already-decoded `DynamicImage` (e.g., from HEIC or memory) with `ImageRecipe`.
pub fn process_loaded_image(
    mut img: DynamicImage,
    original_size_bytes: usize,
    exif_info: ExifShootInfo,
    recipe: &ImageRecipe,
) -> Result<ProcessedImageOutput> {
    // 1. Apply EXIF orientation correction if needed
    img = apply_exif_orientation(img, exif_info.orientation);

    // 2. Apply normalized crop if specified
    if let Some(crop) = recipe.crop {
        let (w, h) = img.dimensions();
        let cx = ((crop.x.clamp(0.0, 0.95)) * w as f32).round() as u32;
        let cy = ((crop.y.clamp(0.0, 0.95)) * h as f32).round() as u32;
        let cw = ((crop.width.clamp(0.05, 1.0)) * w as f32)
            .round()
            .min((w - cx) as f32) as u32;
        let ch = ((crop.height.clamp(0.05, 1.0)) * h as f32)
            .round()
            .min((h - cy) as f32) as u32;
        if cw > 0 && ch > 0 {
            img = img.crop_imm(cx, cy, cw, ch);
        }
    }

    // 3. Resize if wider than max_width
    if recipe.max_width > 0 && img.width() > recipe.max_width {
        let ratio = recipe.max_width as f32 / img.width() as f32;
        let new_h = ((img.height() as f32) * ratio).round().max(1.0) as u32;
        img = img.resize(
            recipe.max_width,
            new_h,
            image::imageops::FilterType::Lanczos3,
        );
    }

    // 4. Apply color filter preset + brightness/contrast/saturation in a single RGBA pass
    let mut rgba = img.to_rgba8();
    apply_color_pipeline(&mut rgba, recipe);

    // 5. Apply decorative frame (None / MinimalWhite / Polaroid / RoundedShadow)
    rgba = apply_frame_style(rgba, recipe.frame, &exif_info, &recipe.watermark_text);

    // 6. Apply watermark stamp if not already rendered in Polaroid footer
    if recipe.frame != FrameStyle::Polaroid {
        if let Some(wm) = &recipe.watermark_text {
            let trimmed = wm.trim();
            if !trimmed.is_empty() {
                draw_watermark_stamp(&mut rgba, trimmed);
            }
        }
    }

    let (final_w, final_h) = rgba.dimensions();

    // 7. Encode to target format (WebP / JPEG / PNG).
    // Because we encode strictly from the raw RGBA pixel buffer, all GPS and raw EXIF segments
    // are guaranteed to be stripped!
    let mut encoded_bytes = Vec::new();
    match recipe.output_format {
        OutputImageFormat::Webp => {
            let encoder = WebPEncoder::new_lossless(&mut encoded_bytes);
            encoder.write_image(&rgba, final_w, final_h, image::ExtendedColorType::Rgba8)?;
        }
        OutputImageFormat::Jpeg => {
            let rgb = DynamicImage::ImageRgba8(rgba.clone()).to_rgb8();
            let encoder = JpegEncoder::new_with_quality(&mut encoded_bytes, 88);
            encoder.write_image(&rgb, final_w, final_h, image::ExtendedColorType::Rgb8)?;
        }
        OutputImageFormat::Png => {
            let encoder = PngEncoder::new(&mut encoded_bytes);
            encoder.write_image(&rgba, final_w, final_h, image::ExtendedColorType::Rgba8)?;
        }
    }

    let gps_removed_verified = !has_gps_metadata(&encoded_bytes);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&encoded_bytes);
    let preview_data_url = format!("data:{};base64,{}", recipe.output_format.mime_type(), b64);
    let processed_size_bytes = encoded_bytes.len();

    Ok(ProcessedImageOutput {
        encoded_bytes,
        width: final_w,
        height: final_h,
        format: recipe.output_format,
        original_size_bytes,
        processed_size_bytes,
        exif_info,
        gps_removed_verified,
        preview_data_url,
    })
}

fn apply_exif_orientation(img: DynamicImage, orientation: u16) -> DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

fn apply_color_pipeline(rgba: &mut RgbaImage, recipe: &ImageRecipe) {
    let b_offset = (recipe.brightness.clamp(-100, 100) as f32) * 1.8;
    let c_factor = {
        let c = (recipe.contrast.clamp(-100, 100) as f32) * 1.28;
        (259.0 * (c + 255.0)) / (255.0 * (259.0 - c))
    };
    let s_factor = 1.0 + (recipe.saturation.clamp(-100, 100) as f32) / 100.0;

    for pixel in rgba.pixels_mut() {
        let mut r = pixel[0] as f32;
        let mut g = pixel[1] as f32;
        let mut b = pixel[2] as f32;

        // 1. Brightness
        r += b_offset;
        g += b_offset;
        b += b_offset;

        // 2. Contrast
        r = c_factor * (r - 128.0) + 128.0;
        g = c_factor * (g - 128.0) + 128.0;
        b = c_factor * (b - 128.0) + 128.0;

        // 3. Saturation
        let luma = 0.299 * r + 0.587 * g + 0.114 * b;
        r = luma + (r - luma) * s_factor;
        g = luma + (g - luma) * s_factor;
        b = luma + (b - luma) * s_factor;

        // 4. Filter Preset
        match recipe.filter {
            FilterPreset::Original => {}
            FilterPreset::FilmWarm => {
                // Warm golden highlights + soft lifted shadows (Kodak Portra style)
                r = r * 1.06 + 8.0;
                g = g * 1.02 + 3.0;
                b = b * 0.93 - 4.0;
            }
            FilterPreset::VintageFade => {
                // Matte faded blacks + warm retro tint
                let fade = 0.85;
                r = r * fade + 28.0;
                g = g * fade + 24.0;
                b = b * fade + 16.0;
            }
            FilterPreset::Monochrome => {
                // High-contrast monochrome
                let bw = 0.299 * r + 0.587 * g + 0.114 * b;
                let contrasted = 1.15 * (bw - 128.0) + 128.0;
                r = contrasted;
                g = contrasted;
                b = contrasted;
            }
            FilterPreset::VividPop => {
                let lum = 0.299 * r + 0.587 * g + 0.114 * b;
                r = lum + (r - lum) * 1.32;
                g = lum + (g - lum) * 1.32;
                b = lum + (b - lum) * 1.32;
                r = 1.08 * (r - 128.0) + 128.0;
                g = 1.08 * (g - 128.0) + 128.0;
                b = 1.08 * (b - 128.0) + 128.0;
            }
            FilterPreset::CoolCinema => {
                // Teal & cool shadows
                r = r * 0.94;
                g = g * 1.02 + 2.0;
                b = b * 1.09 + 8.0;
            }
        }

        pixel[0] = r.clamp(0.0, 255.0) as u8;
        pixel[1] = g.clamp(0.0, 255.0) as u8;
        pixel[2] = b.clamp(0.0, 255.0) as u8;
    }
}

fn apply_frame_style(
    inner: RgbaImage,
    style: FrameStyle,
    exif: &ExifShootInfo,
    watermark: &Option<String>,
) -> RgbaImage {
    let (w, h) = inner.dimensions();
    match style {
        FrameStyle::None => inner,
        FrameStyle::MinimalWhite => {
            let pad = ((w.min(h) as f32) * 0.045).round().max(12.0) as u32;
            let new_w = w + pad * 2;
            let new_h = h + pad * 2;
            let mut canvas = RgbaImage::from_pixel(new_w, new_h, Rgba([255, 255, 255, 255]));
            image::imageops::overlay(&mut canvas, &inner, pad as i64, pad as i64);
            canvas
        }
        FrameStyle::Polaroid => {
            let side_pad = ((w.min(h) as f32) * 0.05).round().max(16.0) as u32;
            let bottom_pad = ((w.min(h) as f32) * 0.18).round().max(56.0) as u32;
            let outer_margin = ((w.min(h) as f32) * 0.025).round().max(8.0) as u32;
            let card_w = w + side_pad * 2;
            let card_h = h + side_pad + bottom_pad;
            let total_w = card_w + outer_margin * 2;
            let total_h = card_h + outer_margin * 2;

            // Soft neutral background with subtle drop shadow
            let mut canvas = RgbaImage::from_pixel(total_w, total_h, Rgba([241, 245, 249, 255]));

            // Draw drop shadow
            let shadow_offset = (outer_margin / 3).max(3);
            for y in (outer_margin + shadow_offset)..(outer_margin + card_h + shadow_offset) {
                for x in (outer_margin + shadow_offset)..(outer_margin + card_w + shadow_offset) {
                    if x < total_w && y < total_h {
                        canvas.put_pixel(x, y, Rgba([203, 213, 225, 255]));
                    }
                }
            }

            // Draw white Polaroid card
            for y in outer_margin..(outer_margin + card_h) {
                for x in outer_margin..(outer_margin + card_w) {
                    canvas.put_pixel(x, y, Rgba([255, 255, 255, 255]));
                }
            }

            // Overlay photo
            image::imageops::overlay(
                &mut canvas,
                &inner,
                (outer_margin + side_pad) as i64,
                (outer_margin + side_pad) as i64,
            );

            // Render footer label (watermark or EXIF shoot info) in Polaroid bottom space
            let footer_text = watermark
                .as_ref()
                .filter(|s| !s.trim().is_empty())
                .cloned()
                .or_else(|| exif.formatted_summary().map(|s| s.replace(" · ", " | ")))
                .unwrap_or_else(|| "SHOT ON IPHONE".to_string());

            let scale = ((bottom_pad as f32) / 28.0).round().clamp(1.0, 3.0) as u32;
            let text_w = measure_bitmap_text(&footer_text, scale);
            let tx = (outer_margin + card_w / 2).saturating_sub(text_w / 2);
            let ty = outer_margin + side_pad + h + (bottom_pad.saturating_sub(7 * scale)) / 2;
            draw_bitmap_text(
                &mut canvas,
                &footer_text,
                tx,
                ty,
                scale,
                Rgba([71, 85, 105, 255]),
            );

            canvas
        }
        FrameStyle::RoundedShadow => {
            let pad = ((w.min(h) as f32) * 0.05).round().max(14.0) as u32;
            let radius = ((w.min(h) as f32) * 0.04).round().max(10.0) as i32;
            let new_w = w + pad * 2;
            let new_h = h + pad * 2;
            let mut canvas = RgbaImage::from_pixel(new_w, new_h, Rgba([248, 250, 252, 255]));

            for y in 0..h {
                for x in 0..w {
                    if is_inside_rounded_rect(x as i32, y as i32, w as i32, h as i32, radius) {
                        let px = inner.get_pixel(x, y);
                        canvas.put_pixel(x + pad, y + pad, *px);
                    }
                }
            }
            canvas
        }
    }
}

fn is_inside_rounded_rect(x: i32, y: i32, w: i32, h: i32, r: i32) -> bool {
    let cx = if x < r {
        r - x
    } else if x >= w - r {
        x - (w - r - 1)
    } else {
        0
    };
    let cy = if y < r {
        r - y
    } else if y >= h - r {
        y - (h - r - 1)
    } else {
        0
    };
    cx * cx + cy * cy <= r * r
}

fn draw_watermark_stamp(canvas: &mut RgbaImage, text: &str) {
    let (w, h) = canvas.dimensions();
    let scale = ((w.min(h) as f32) / 360.0).round().clamp(1.0, 3.0) as u32;
    let text_w = measure_bitmap_text(text, scale);
    let text_h = 7 * scale;
    let margin = 12 * scale;
    if w <= text_w + margin * 2 || h <= text_h + margin * 2 {
        return;
    }

    let x0 = w - text_w - margin;
    let y0 = h - text_h - margin;

    // Semi-transparent pill background for readability
    let pad_x = 6 * scale;
    let pad_y = 4 * scale;
    for y in y0.saturating_sub(pad_y)..(y0 + text_h + pad_y).min(h) {
        for x in x0.saturating_sub(pad_x)..(x0 + text_w + pad_x).min(w) {
            let bg = canvas.get_pixel(x, y);
            let blended = Rgba([
                ((bg[0] as u16 * 40 + 15 * 60) / 100) as u8,
                ((bg[1] as u16 * 40 + 23 * 60) / 100) as u8,
                ((bg[2] as u16 * 40 + 42 * 60) / 100) as u8,
                255,
            ]);
            canvas.put_pixel(x, y, blended);
        }
    }

    draw_bitmap_text(canvas, text, x0, y0, scale, Rgba([255, 255, 255, 255]));
}

fn measure_bitmap_text(text: &str, scale: u32) -> u32 {
    let chars = text.chars().count() as u32;
    if chars == 0 {
        0
    } else {
        chars * 6 * scale - scale
    }
}

fn draw_bitmap_text(
    canvas: &mut RgbaImage,
    text: &str,
    start_x: u32,
    start_y: u32,
    scale: u32,
    color: Rgba<u8>,
) {
    let (w, h) = canvas.dimensions();
    let mut cursor_x = start_x;
    for ch in text.chars() {
        let glyph = glyph_5x7(ch.to_ascii_uppercase());
        for (row_idx, &row_bits) in glyph.iter().enumerate() {
            for col_idx in 0..5 {
                if (row_bits >> (4 - col_idx)) & 1 == 1 {
                    for sy in 0..scale {
                        for sx in 0..scale {
                            let px = cursor_x + (col_idx as u32) * scale + sx;
                            let py = start_y + (row_idx as u32) * scale + sy;
                            if px < w && py < h {
                                canvas.put_pixel(px, py, color);
                            }
                        }
                    }
                }
            }
        }
        cursor_x += 6 * scale;
    }
}

fn glyph_5x7(ch: char) -> [u8; 7] {
    match ch {
        'A' => [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
        'B' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
        'C' => [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
        'D' => [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
        'E' => [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
        'F' => [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
        'G' => [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
        'H' => [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
        'I' => [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        'J' => [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
        'K' => [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
        'L' => [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
        'M' => [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
        'N' => [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
        'O' => [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
        'P' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
        'Q' => [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
        'R' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
        'S' => [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
        'T' => [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
        'U' => [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
        'V' => [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
        'W' => [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
        'X' => [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
        'Y' => [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
        'Z' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
        '0' => [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
        '1' => [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        '2' => [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
        '3' => [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
        '4' => [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
        '5' => [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
        '6' => [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
        '7' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
        '8' => [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
        '9' => [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
        '.' => [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
        ':' => [0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000],
        '/' => [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
        '-' => [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
        '|' => [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
        '@' => [0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01110],
        _ => [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
    }
}
