use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use syntect::easy::HighlightLines;
use syntect::highlighting::ThemeSet;
use syntect::html::{styled_line_to_highlighted_html, IncludeBackground};
use syntect::parsing::SyntaxSet;
use syntect::util::LinesWithEndings;

/// Represents a block in the Visual Editor mode (for non-developers who edit like Word/Notion)
/// while remaining 100% round-trip convertible with Markdown (for developers in Code Mode).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum VisualBlock {
    Heading {
        level: u8,
        text: String,
    },
    Paragraph {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        font_size_px: Option<u16>,
    },
    Quote {
        text: String,
    },
    CodeBlock {
        language: String,
        code: String,
    },
    Image {
        asset_id: String,
        src: String,
        alt: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        exif_caption: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        custom_caption: Option<String>,
    },
    BulletList {
        items: Vec<String>,
    },
    Divider,
}

/// Styling preset for Tistory Copy & Paste inline CSS generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TistoryStylePreset {
    pub name: String,
    pub font_family: String,
    pub body_font_size_px: u16,
    pub line_height: f32,
    pub h1_size_px: u16,
    pub h2_size_px: u16,
    pub h3_size_px: u16,
    pub h4_size_px: u16,
    pub accent_color: String,
    pub quote_bg_color: String,
    pub code_theme: String,
}

impl Default for TistoryStylePreset {
    fn default() -> Self {
        Self {
            name: "Tistory Modern Clean".to_string(),
            font_family: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif".to_string(),
            body_font_size_px: 16,
            line_height: 1.85,
            h1_size_px: 28,
            h2_size_px: 23,
            h3_size_px: 19,
            h4_size_px: 17,
            accent_color: "#18181b".to_string(),
            quote_bg_color: "#fafafa".to_string(),
            code_theme: "base16-ocean.dark".to_string(),
        }
    }
}

/// A bibliographic reference / citation entry managed in Overleaf-style `.writer/references.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CiteEntry {
    pub key: String,
    pub authors: String,
    pub title: String,
    pub year: String,
    #[serde(default)]
    pub venue: String,
    #[serde(default)]
    pub url: String,
}

/// Metadata about a processed image in the Image Tray to enrich Tistory HTML output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrayImageMeta {
    pub tray_index: usize,
    pub asset_id: String,
    pub exported_filename: String,
    pub exif_summary: Option<String>,
    pub custom_caption: Option<String>,
    pub preview_data_url: Option<String>,
}

/// Convert Visual Editor blocks into clean, human-readable Markdown.
/// Special visual attributes (like custom paragraph font size or EXIF captions)
/// are preserved via lightweight metadata comments or standard Markdown syntax.
pub fn blocks_to_markdown(blocks: &[VisualBlock]) -> String {
    let mut out = Vec::new();

    for block in blocks {
        match block {
            VisualBlock::Heading { level, text } => {
                let lvl = (*level).clamp(1, 6) as usize;
                out.push(format!("{} {}", "#".repeat(lvl), text.trim()));
            }
            VisualBlock::Paragraph { text, font_size_px } => {
                if let Some(size) = font_size_px {
                    out.push(format!("<!-- writer:size={} -->\n{}", size, text.trim()));
                } else {
                    out.push(text.trim().to_string());
                }
            }
            VisualBlock::Quote { text } => {
                let quoted = text
                    .lines()
                    .map(|l| format!("> {}", l))
                    .collect::<Vec<_>>()
                    .join("\n");
                out.push(quoted);
            }
            VisualBlock::CodeBlock { language, code } => {
                out.push(format!("```{}\n{}\n```", language.trim(), code.trim_end()));
            }
            VisualBlock::Image {
                asset_id,
                src,
                alt,
                exif_caption,
                custom_caption,
            } => {
                let mut meta_parts = vec![format!("id={}", asset_id)];
                if let Some(exif) = exif_caption {
                    if !exif.is_empty() {
                        meta_parts.push(format!("exif={}", exif.replace("-->", "")));
                    }
                }
                if let Some(cap) = custom_caption {
                    if !cap.is_empty() {
                        meta_parts.push(format!("caption={}", cap.replace("-->", "")));
                    }
                }
                out.push(format!(
                    "<!-- writer:img {} -->\n![{}]({})",
                    meta_parts.join(" | "),
                    alt,
                    src
                ));
            }
            VisualBlock::BulletList { items } => {
                let list = items
                    .iter()
                    .map(|item| format!("- {}", item.trim()))
                    .collect::<Vec<_>>()
                    .join("\n");
                out.push(list);
            }
            VisualBlock::Divider => {
                out.push("---".to_string());
            }
        }
    }

    out.join("\n\n")
}

/// Parse Markdown into Visual Editor blocks for bidirectional editing.
pub fn markdown_to_blocks(markdown: &str) -> Vec<VisualBlock> {
    let mut blocks = Vec::new();
    let mut pending_font_size: Option<u16> = None;
    let mut pending_img_meta: Option<(String, Option<String>, Option<String>)> = None;

    // Normalize line endings
    let normalized = markdown.replace("\r\n", "\n");
    let chunks = split_markdown_top_level(&normalized);

    for chunk in chunks {
        let trimmed = chunk.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Check for writer metadata comment at the start of a chunk
        if let Some(rest) = trimmed.strip_prefix("<!-- writer:size=") {
            if let Some(end_idx) = rest.find("-->") {
                let num_str = rest[..end_idx].trim();
                if let Ok(sz) = num_str.parse::<u16>() {
                    pending_font_size = Some(sz);
                }
                let after = rest[end_idx + 3..].trim();
                if !after.is_empty() {
                    blocks.push(VisualBlock::Paragraph {
                        text: after.to_string(),
                        font_size_px: pending_font_size.take(),
                    });
                }
                continue;
            }
        }

        if let Some(rest) = trimmed.strip_prefix("<!-- writer:img ") {
            if let Some(end_idx) = rest.find("-->") {
                let meta_str = rest[..end_idx].trim();
                let mut asset_id = String::new();
                let mut exif_caption = None;
                let mut custom_caption = None;
                for part in meta_str.split('|') {
                    let p = part.trim();
                    if let Some(v) = p.strip_prefix("id=") {
                        asset_id = v.trim().to_string();
                    } else if let Some(v) = p.strip_prefix("exif=") {
                        exif_caption = Some(v.trim().to_string());
                    } else if let Some(v) = p.strip_prefix("caption=") {
                        custom_caption = Some(v.trim().to_string());
                    }
                }
                let after = rest[end_idx + 3..].trim();
                if let Some((alt, src)) = parse_markdown_image_line(after) {
                    blocks.push(VisualBlock::Image {
                        asset_id: if asset_id.is_empty() {
                            src.clone()
                        } else {
                            asset_id
                        },
                        src,
                        alt,
                        exif_caption,
                        custom_caption,
                    });
                } else {
                    pending_img_meta = Some((asset_id, exif_caption, custom_caption));
                }
                continue;
            }
        }

        if trimmed == "---" || trimmed == "***" || trimmed == "___" {
            blocks.push(VisualBlock::Divider);
            continue;
        }

        if let Some(code_block) = parse_fenced_code(trimmed) {
            blocks.push(code_block);
            continue;
        }

        if let Some((level, heading_text)) = parse_heading_line(trimmed) {
            blocks.push(VisualBlock::Heading {
                level,
                text: heading_text,
            });
            continue;
        }

        if trimmed.lines().all(|l| l.trim_start().starts_with('>')) {
            let quote_text = trimmed
                .lines()
                .map(|l| {
                    let s = l.trim_start().strip_prefix('>').unwrap_or(l);
                    s.strip_prefix(' ').unwrap_or(s)
                })
                .collect::<Vec<_>>()
                .join("\n");
            blocks.push(VisualBlock::Quote { text: quote_text });
            continue;
        }

        if trimmed
            .lines()
            .all(|l| l.trim_start().starts_with("- ") || l.trim_start().starts_with("* "))
        {
            let items = trimmed
                .lines()
                .map(|l| {
                    let s = l.trim_start();
                    s[2..].trim().to_string()
                })
                .collect::<Vec<_>>();
            blocks.push(VisualBlock::BulletList { items });
            continue;
        }

        if let Some((alt, src)) = parse_markdown_image_line(trimmed) {
            let (asset_id, exif_caption, custom_caption) = pending_img_meta
                .take()
                .unwrap_or_else(|| (src.clone(), None, None));
            blocks.push(VisualBlock::Image {
                asset_id,
                src,
                alt,
                exif_caption,
                custom_caption,
            });
            continue;
        }

        blocks.push(VisualBlock::Paragraph {
            text: trimmed.to_string(),
            font_size_px: pending_font_size.take(),
        });
    }

    blocks
}

fn split_markdown_top_level(md: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut in_fence = false;

    for line in md.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            current.push(line);
            if !in_fence {
                chunks.push(current.join("\n"));
                current.clear();
            }
            continue;
        }

        if in_fence {
            current.push(line);
        } else if line.trim().is_empty() {
            if !current.is_empty() {
                chunks.push(current.join("\n"));
                current.clear();
            }
        } else {
            current.push(line);
        }
    }

    if !current.is_empty() {
        chunks.push(current.join("\n"));
    }

    chunks
}

fn parse_fenced_code(chunk: &str) -> Option<VisualBlock> {
    let mut lines = chunk.lines();
    let first = lines.next()?.trim();
    if !first.starts_with("```") {
        return None;
    }
    let language = first.trim_start_matches('`').trim().to_string();
    let mut body_lines: Vec<&str> = lines.collect();
    if let Some(last) = body_lines.last() {
        if last.trim().starts_with("```") {
            body_lines.pop();
        }
    }
    Some(VisualBlock::CodeBlock {
        language,
        code: body_lines.join("\n"),
    })
}

fn parse_heading_line(chunk: &str) -> Option<(u8, String)> {
    if chunk.contains('\n') {
        return None;
    }
    let trimmed = chunk.trim();
    let hashes = trimmed.chars().take_while(|c| *c == '#').count();
    if (1..=6).contains(&hashes) {
        let rest = &trimmed[hashes..];
        if rest.starts_with(' ') {
            return Some((hashes as u8, rest.trim().to_string()));
        }
    }
    None
}

fn parse_markdown_image_line(chunk: &str) -> Option<(String, String)> {
    let trimmed = chunk.trim();
    if !trimmed.starts_with("![") || !trimmed.ends_with(')') || trimmed.contains('\n') {
        return None;
    }
    let mid = trimmed.find("](")?;
    let alt = trimmed[2..mid].to_string();
    let src = trimmed[mid + 2..trimmed.len() - 1].to_string();
    Some((alt, src))
}

/// Compiles Markdown into Tistory-ready HTML where every single element has explicit
/// inline CSS (`style="..."`) and syntax-highlighted `<pre>` blocks, so pasting into
/// Tistory's editor retains 100% of the visual design.
pub fn compile_to_tistory_html(
    markdown: &str,
    preset: &TistoryStylePreset,
    image_lookup: &HashMap<String, TrayImageMeta>,
    include_preview_images: bool,
) -> String {
    compile_to_tistory_html_with_cites(
        markdown,
        preset,
        image_lookup,
        include_preview_images,
        &[],
    )
}

/// Same as `compile_to_tistory_html`, but resolves `[@key]` and `\cite{key}` markers
/// against `cites` and appends a numbered `References` section at the bottom.
pub fn compile_to_tistory_html_with_cites(
    markdown: &str,
    preset: &TistoryStylePreset,
    image_lookup: &HashMap<String, TrayImageMeta>,
    include_preview_images: bool,
    cites: &[CiteEntry],
) -> String {
    let ss = SyntaxSet::load_defaults_newlines();
    let ts = ThemeSet::load_defaults();
    let theme = ts
        .themes
        .get(&preset.code_theme)
        .or_else(|| ts.themes.get("base16-ocean.dark"))
        .or_else(|| ts.themes.values().next())
        .expect("syntect default theme available");

    let blocks = markdown_to_blocks(markdown);
    let mut html_parts = Vec::new();

    html_parts.push(format!(
        r#"<div class="writer-tistory-article" style="font-family: {}; font-size: {}px; line-height: {:.2}; color: #1e293b; word-break: keep-all; overflow-wrap: break-word;">"#,
        preset.font_family, preset.body_font_size_px, preset.line_height
    ));

    let mut auto_img_counter = 0usize;

    for block in blocks {
        match block {
            VisualBlock::Heading { level, text } => {
                let inline_text = render_inline_markdown(&text, &preset.accent_color);
                let (tag, font_size, extra_style) = match level {
                    1 => (
                        "h1",
                        preset.h1_size_px,
                        format!(
                            "font-weight: 800; margin: 36px 0 18px 0; padding-bottom: 12px; border-bottom: 2px solid {}; color: #0f172a; letter-spacing: -0.02em;",
                            preset.accent_color
                        ),
                    ),
                    2 => (
                        "h2",
                        preset.h2_size_px,
                        format!(
                            "font-weight: 700; margin: 32px 0 14px 0; padding-left: 12px; border-left: 4px solid {}; color: #0f172a; letter-spacing: -0.01em;",
                            preset.accent_color
                        ),
                    ),
                    3 => (
                        "h3",
                        preset.h3_size_px,
                        "font-weight: 700; margin: 24px 0 10px 0; color: #1e293b;".to_string(),
                    ),
                    _ => (
                        "h4",
                        preset.h4_size_px,
                        "font-weight: 600; margin: 20px 0 8px 0; color: #334155;".to_string(),
                    ),
                };
                html_parts.push(format!(
                    r#"<{tag} style="font-family: {font}; font-size: {size}px; line-height: 1.4; {extra}">{content}</{tag}>"#,
                    tag = tag,
                    font = preset.font_family,
                    size = font_size,
                    extra = extra_style,
                    content = inline_text
                ));
            }
            VisualBlock::Paragraph { text, font_size_px } => {
                let sz = font_size_px.unwrap_or(preset.body_font_size_px);
                let inline_text = render_inline_markdown(&text, &preset.accent_color);
                html_parts.push(format!(
                    r#"<p style="font-family: {}; font-size: {}px; line-height: {:.2}; margin: 0 0 18px 0; color: #1e293b;">{}</p>"#,
                    preset.font_family, sz, preset.line_height, inline_text
                ));
            }
            VisualBlock::Quote { text } => {
                let inline_text = render_inline_markdown(&text, &preset.accent_color)
                    .replace('\n', "<br/>");
                html_parts.push(format!(
                    r#"<blockquote style="margin: 24px 0; padding: 16px 20px; border-left: 4px solid {}; background-color: {}; border-radius: 0 8px 8px 0; color: #334155; font-size: {}px; line-height: {:.2};">{}</blockquote>"#,
                    preset.accent_color,
                    preset.quote_bg_color,
                    preset.body_font_size_px,
                    preset.line_height,
                    inline_text
                ));
            }
            VisualBlock::CodeBlock { language, code } => {
                let syntax = if language.is_empty() {
                    ss.find_syntax_plain_text()
                } else {
                    ss.find_syntax_by_token(&language)
                        .unwrap_or_else(|| ss.find_syntax_plain_text())
                };
                let mut h = HighlightLines::new(syntax, theme);
                let bg = theme
                    .settings
                    .background
                    .unwrap_or(syntect::highlighting::Color {
                        r: 30,
                        g: 41,
                        b: 59,
                        a: 255,
                    });
                let mut highlighted_lines = String::new();
                for line in LinesWithEndings::from(&code) {
                    if let Ok(ranges) = h.highlight_line(line, &ss) {
                        if let Ok(html_line) =
                            styled_line_to_highlighted_html(&ranges[..], IncludeBackground::No)
                        {
                            highlighted_lines.push_str(&html_line);
                        }
                    }
                }
                let lang_badge = if language.is_empty() {
                    "CODE".to_string()
                } else {
                    language.to_uppercase()
                };
                html_parts.push(format!(
                    r#"<div style="margin: 24px 0; border-radius: 10px; overflow: hidden; background-color: rgb({},{},{}); box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);"><div style="padding: 8px 16px; background-color: rgba(255, 255, 255, 0.06); color: #94a3b8; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 12px; font-weight: 600; letter-spacing: 0.05em;">{}</div><pre style="margin: 0; padding: 16px 20px; overflow-x: auto; background-color: rgb({},{},{}); color: #f8fafc; font-family: 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace; font-size: 14px; line-height: 1.65;"><code>{}</code></pre></div>"#,
                    bg.r, bg.g, bg.b, escape_html(&lang_badge), bg.r, bg.g, bg.b, highlighted_lines
                ));
            }
            VisualBlock::Image {
                asset_id,
                src,
                alt,
                exif_caption,
                custom_caption,
            } => {
                auto_img_counter += 1;
                let meta = image_lookup.get(&asset_id).or_else(|| image_lookup.get(&src));
                let tray_idx = meta.map(|m| m.tray_index).unwrap_or(auto_img_counter);
                let filename = meta
                    .map(|m| m.exported_filename.clone())
                    .unwrap_or_else(|| src.clone());
                let exif_text = exif_caption.or_else(|| meta.and_then(|m| m.exif_summary.clone()));
                let cap_text = custom_caption
                    .or_else(|| meta.and_then(|m| m.custom_caption.clone()))
                    .or_else(|| {
                        if !alt.is_empty() {
                            Some(alt.clone())
                        } else {
                            None
                        }
                    });

                let img_inner = if include_preview_images {
                    let img_src = meta
                        .and_then(|m| m.preview_data_url.clone())
                        .unwrap_or_else(|| src.clone());
                    format!(
                        r#"<img src="{}" alt="{}" style="max-width: 100%; height: auto; border-radius: 6px; display: block; margin: 0 auto;" />"#,
                        escape_html(&img_src),
                        escape_html(&alt)
                    )
                } else {
                    format!(
                        r#"<div data-writer-tray-slot="{idx}" style="padding: 18px; border: 1px dashed #a1a1aa; border-radius: 6px; background-color: #fafafa; color: #3f3f46; font-size: 13px; font-weight: 500; text-align: center;">[사진 #{idx} : {file}]</div>"#,
                        idx = tray_idx,
                        file = escape_html(&filename)
                    )
                };

                let mut caption_html = String::new();
                if exif_text.is_some() || cap_text.is_some() {
                    caption_html.push_str(
                        r#"<figcaption style="margin-top: 10px; text-align: center; line-height: 1.5;">"#,
                    );
                    if let Some(exif) = exif_text {
                        caption_html.push_str(&format!(
                            r#"<div style="display: inline-block; padding: 2px 9px; background-color: #f4f4f5; color: #52525b; border-radius: 4px; font-family: 'SF Mono', Menlo, monospace; font-size: 11.5px; font-weight: 500; margin-bottom: 4px; letter-spacing: -0.01em;">{}</div>"#,
                            escape_html(&exif)
                        ));
                    }
                    if let Some(cap) = cap_text {
                        caption_html.push_str(&format!(
                            r#"<div style="color: #71717a; font-size: 13px; margin-top: 2px;">{}</div>"#,
                            escape_html(&cap)
                        ));
                    }
                    caption_html.push_str("</figcaption>");
                }

                html_parts.push(format!(
                    r#"<figure style="margin: 28px 0; text-align: center;">{}{}</figure>"#,
                    img_inner, caption_html
                ));
            }
            VisualBlock::BulletList { items } => {
                let lis = items
                    .iter()
                    .map(|item| {
                        format!(
                            r#"<li style="margin-bottom: 8px; line-height: {:.2};">{}</li>"#,
                            preset.line_height,
                            render_inline_markdown(item, &preset.accent_color)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("");
                html_parts.push(format!(
                    r#"<ul style="margin: 0 0 20px 0; padding-left: 24px; color: #1e293b; font-size: {}px;">{}</ul>"#,
                    preset.body_font_size_px, lis
                ));
            }
            VisualBlock::Divider => {
                html_parts.push(
                    r#"<hr style="border: 0; height: 1px; background-color: #e2e8f0; margin: 32px 0;" />"#
                        .to_string(),
                );
            }
        }
    }

    html_parts.push("</div>".to_string());
    let raw_html = html_parts.join("\n");
    resolve_citations_in_html(&raw_html, cites, preset)
}

/// Replaces `[@key]` and `\cite{key}` tokens in compiled HTML with `[1]`, `[2]`...
/// and appends a formatted `References` section at the bottom for all cited entries.
fn resolve_citations_in_html(
    html: &str,
    cites: &[CiteEntry],
    preset: &TistoryStylePreset,
) -> String {
    if cites.is_empty() && !html.contains("[@") && !html.contains("\\cite{") {
        return html.to_string();
    }

    let cite_map: HashMap<&str, &CiteEntry> =
        cites.iter().map(|c| (c.key.as_str(), c)).collect();
    let mut order: Vec<String> = Vec::new();
    let mut key_to_num: HashMap<String, usize> = HashMap::new();

    let mut out = String::with_capacity(html.len() + 512);
    let mut i = 0;
    let bytes = html.as_bytes();

    while i < bytes.len() {
        if html[i..].starts_with("[@") {
            if let Some(end_rel) = html[i + 2..].find(']') {
                let key = html[i + 2..i + 2 + end_rel].trim();
                if !key.is_empty() && !key.contains('<') && !key.contains(' ') {
                    let num = if let Some(&n) = key_to_num.get(key) {
                        n
                    } else {
                        order.push(key.to_string());
                        let n = order.len();
                        key_to_num.insert(key.to_string(), n);
                        n
                    };
                    out.push_str(&format!(
                        r##"<a href="#ref-{k}" style="color: {accent}; font-weight: 600; text-decoration: none;">[{n}]</a>"##,
                        k = escape_html(key),
                        accent = preset.accent_color,
                        n = num
                    ));
                    i += 2 + end_rel + 1;
                    continue;
                }
            }
        } else if html[i..].starts_with("\\cite{") {
            if let Some(end_rel) = html[i + 6..].find('}') {
                let keys_raw = &html[i + 6..i + 6 + end_rel];
                if !keys_raw.contains('<') {
                    let mut badges = Vec::new();
                    for raw_k in keys_raw.split(',') {
                        let key = raw_k.trim();
                        if key.is_empty() {
                            continue;
                        }
                        let num = if let Some(&n) = key_to_num.get(key) {
                            n
                        } else {
                            order.push(key.to_string());
                            let n = order.len();
                            key_to_num.insert(key.to_string(), n);
                            n
                        };
                        badges.push(format!(
                            r##"<a href="#ref-{k}" style="color: {accent}; font-weight: 600; text-decoration: none;">[{n}]</a>"##,
                            k = escape_html(key),
                            accent = preset.accent_color,
                            n = num
                        ));
                    }
                    if !badges.is_empty() {
                        out.push_str(&badges.join(" "));
                        i += 6 + end_rel + 1;
                        continue;
                    }
                }
            }
        }

        let ch = html[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }

    if order.is_empty() {
        return out;
    }

    let mut refs_html = String::new();
    refs_html.push_str(
        r#"<div style="margin-top: 36px; padding-top: 20px; border-top: 1px solid #e4e4e7;">"#,
    );
    refs_html.push_str(&format!(
        r#"<h3 style="font-family: {}; font-size: {}px; font-weight: 700; margin: 0 0 12px 0; color: #18181b;">References</h3>"#,
        preset.font_family, preset.h3_size_px
    ));
    refs_html.push_str(
        r#"<ol style="margin: 0; padding-left: 20px; color: #3f3f46; font-size: 14px; line-height: 1.65;">"#,
    );

    for (idx, key) in order.iter().enumerate() {
        let num = idx + 1;
        if let Some(entry) = cite_map.get(key.as_str()) {
            let mut parts = Vec::new();
            if !entry.authors.trim().is_empty() {
                parts.push(escape_html(entry.authors.trim()));
            }
            if !entry.year.trim().is_empty() {
                parts.push(format!("({})", escape_html(entry.year.trim())));
            }
            if !entry.title.trim().is_empty() {
                parts.push(format!(
                    "<strong>{}</strong>",
                    escape_html(entry.title.trim())
                ));
            }
            if !entry.venue.trim().is_empty() {
                parts.push(format!("<em>{}</em>", escape_html(entry.venue.trim())));
            }
            let mut body = parts.join(". ");
            if !entry.url.trim().is_empty() {
                body.push_str(&format!(
                    r#" <a href="{u}" style="color: {accent}; text-decoration: underline;">{u}</a>"#,
                    u = escape_html(entry.url.trim()),
                    accent = preset.accent_color
                ));
            }
            refs_html.push_str(&format!(
                r#"<li id="ref-{k}" value="{n}" style="margin-bottom: 8px;">{body}</li>"#,
                k = escape_html(key),
                n = num,
                body = body
            ));
        } else {
            refs_html.push_str(&format!(
                r#"<li id="ref-{k}" value="{n}" style="margin-bottom: 8px; color: #71717a;">[{k}] (등록되지 않은 참고문헌 키)</li>"#,
                k = escape_html(key),
                n = num
            ));
        }
    }

    refs_html.push_str("</ol></div>");

    if let Some(pos) = out.rfind("</div>") {
        out.insert_str(pos, &refs_html);
    } else {
        out.push_str(&refs_html);
    }
    out
}

/// Renders inline Markdown formatting (`**bold**`, `*italic*`, `` `code` ``, `[link](url)`, `==highlight==`)
/// with explicit inline CSS for Tistory.
fn render_inline_markdown(text: &str, accent_color: &str) -> String {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    let parser = Parser::new_ext(text, opts);

    let mut out = String::new();
    for event in parser {
        match event {
            Event::Start(Tag::Strong) => {
                out.push_str(r#"<strong style="font-weight: 700; color: #0f172a;">"#);
            }
            Event::End(TagEnd::Strong) => out.push_str("</strong>"),
            Event::Start(Tag::Emphasis) => {
                out.push_str(r#"<em style="font-style: italic;">"#);
            }
            Event::End(TagEnd::Emphasis) => out.push_str("</em>"),
            Event::Start(Tag::Strikethrough) => {
                out.push_str(r#"<del style="text-decoration: line-through; color: #94a3b8;">"#);
            }
            Event::End(TagEnd::Strikethrough) => out.push_str("</del>"),
            Event::Start(Tag::Link { dest_url, .. }) => {
                out.push_str(&format!(
                    r#"<a href="{}" style="color: {}; text-decoration: underline; font-weight: 500;">"#,
                    escape_html(&dest_url),
                    accent_color
                ));
            }
            Event::End(TagEnd::Link) => out.push_str("</a>"),
            Event::Code(code) => {
                out.push_str(&format!(
                    r#"<code style="padding: 2px 6px; background-color: #f1f5f9; color: #e11d48; border-radius: 4px; font-family: 'JetBrains Mono', Menlo, monospace; font-size: 0.9em;">{}</code>"#,
                    escape_html(&code)
                ));
            }
            Event::Text(t) => {
                out.push_str(&escape_html(&t));
            }
            Event::SoftBreak | Event::HardBreak => {
                out.push_str("<br/>");
            }
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(_))) => {}
            _ => {}
        }
    }
    out
}

pub fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
