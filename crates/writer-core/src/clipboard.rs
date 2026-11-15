use anyhow::{Context, Result};
use arboard::{Clipboard, ImageData};
use std::borrow::Cow;

/// Copies Tistory-formatted inline HTML along with a plain-text fallback to the OS clipboard.
pub fn copy_rich_html_to_clipboard(html: &str, plain_fallback: &str) -> Result<()> {
    let mut clipboard = Clipboard::new().context("Failed to access OS clipboard")?;
    clipboard
        .set_html(html, Some(plain_fallback))
        .context("Failed to write HTML to OS clipboard")?;
    Ok(())
}

/// Decodes an encoded image (`WebP` / `JPEG` / `PNG`) into an RGBA bitmap and copies it
/// directly to the OS clipboard so the user can press `Cmd+V` inside Tistory to paste the photo.
pub fn copy_image_bytes_to_clipboard(encoded_image_bytes: &[u8]) -> Result<(u32, u32)> {
    let img = image::load_from_memory(encoded_image_bytes)
        .context("Failed to decode image for clipboard copy")?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let raw_pixels = rgba.into_raw();

    let mut clipboard = Clipboard::new().context("Failed to access OS clipboard")?;
    let img_data = ImageData {
        width: width as usize,
        height: height as usize,
        bytes: Cow::Owned(raw_pixels),
    };
    clipboard
        .set_image(img_data)
        .context("Failed to copy RGBA bitmap to OS clipboard")?;

    Ok((width, height))
}
