use crate::git_engine::{GitRemoteStatus, GitSnapshotInfo, WorkspaceGit};
use crate::image_studio::{
    extract_exif_info, load_image_from_path, process_loaded_image, ExifShootInfo, FilterPreset,
    FrameStyle, ImageRecipe, OutputImageFormat,
};
use crate::markdown::{
    blocks_to_markdown, compile_to_tistory_html, markdown_to_blocks, TistoryStylePreset,
    TrayImageMeta, VisualBlock,
};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Stored metadata + recipe for an image asset in the workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageAssetRecord {
    pub asset_id: String,
    pub original_filename: String,
    pub raw_rel_path: String,
    pub dist_rel_path: String,
    pub dist_abs_path: String,
    pub recipe: ImageRecipe,
    pub exif_info: ExifShootInfo,
    pub exif_summary: Option<String>,
    pub custom_caption: Option<String>,
    pub original_size_bytes: usize,
    pub processed_size_bytes: usize,
    pub width: u32,
    pub height: u32,
    pub gps_removed_verified: bool,
    pub preview_data_url: String,
}

/// Summary of a blog post file in the workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostDocument {
    pub slug: String,
    pub title: String,
    pub markdown: String,
    pub blocks: Vec<VisualBlock>,
    pub updated_at_unix: i64,
}

/// High-level workspace manager coordinating posts, images, recipes, Tistory compiler, and Git.
pub struct WriterWorkspace {
    root_dir: PathBuf,
    git: WorkspaceGit,
}

impl WriterWorkspace {
    pub fn open_or_init(root_dir: &Path) -> Result<Self> {
        let git = WorkspaceGit::init_or_open(root_dir)?;
        let ws = Self {
            root_dir: root_dir.to_path_buf(),
            git,
        };
        ws.ensure_sample_post_if_empty()?;
        Ok(ws)
    }

    pub fn root_dir(&self) -> &Path {
        &self.root_dir
    }

    pub fn git(&self) -> &WorkspaceGit {
        &self.git
    }

    fn ensure_sample_post_if_empty(&self) -> Result<()> {
        let posts_dir = self.root_dir.join("posts");
        let has_md = std::fs::read_dir(&posts_dir)?
            .filter_map(|e| e.ok())
            .any(|e| e.path().extension().and_then(|s| s.to_str()) == Some("md"));

        if !has_md {
            // Create a sample demo image in the workspace so the user immediately sees the Image Studio & Tray in action!
            let sample_asset = self.create_demo_photo_asset()?;
            let sample_md = format!(
                r#"# Writer로 블로그 글쓰기 시작하기

<!-- writer:size=18 -->
코드를 잘 아는 분은 **마크다운 편집** 모드로 빠르게 글을 작성하고, 일반 작성자분은 **일반 편집** 모드에서 타이핑한 뒤 드래그해 글자 크기를 바꾸고 사진을 추가할 수 있습니다.

## 1. 아이폰 사진 필터 & 포맷 자동 변환

아이폰에서 찍은 `HEIC`나 원본 사진을 넣으면 **GPS 위치정보를 자동으로 삭제**하고, 촬영 설정값(EXIF)은 깔끔한 캡션으로 추출합니다. 폴라로이드 프레임이나 필름 필터를 씌우고 `WebP`로 용량까지 줄여보세요.

<!-- writer:img id={id} | exif={exif} | caption=아이폰 샘플 사진 — 필름 필터 & 폴라로이드 프레임 적용 가능 -->
![제주 해변 샘플 사진]({dist})

## 2. 티스토리 복사·붙여넣기 최적화

> 티스토리 에디터는 외부 CSS 클래스를 무시하지만, **Writer**는 모든 제목 크기·줄간격·인용구와 코드 하이라이팅을 **인라인 스타일(Inline CSS)**로 컴파일하여 `Cmd + V` 한 번으로 서식이 그대로 유지됩니다.

```rust
fn main() {{
    let editor = "Writer (Rust + Tauri v2)";
    println!("티스토리에 붙여넣어도 코드 색상이 그대로 유지됩니다: {{}}", editor);
}}
```

- 좌측 **Git 타임라인**에서 글이 변경되었을 때만 스냅샷을 찍고 이전 버전으로 되돌릴 수 있습니다.
- 우측 **가공 완료 사진 트레이**에서 사진을 원클릭 복사해 티스토리에 바로 붙여넣으세요!"#,
                id = sample_asset.asset_id,
                exif = sample_asset
                    .exif_summary
                    .unwrap_or_else(|| "iPhone 15 Pro · 24mm · f/1.78 · 1/120s · ISO 64".to_string()),
                dist = sample_asset.dist_rel_path
            );

            std::fs::write(posts_dir.join("welcome-to-writer.md"), sample_md)?;
            let _ = self.git.create_snapshot(
                "초기 워크스페이스 및 샘플 포스트 생성",
                "Writer Blogger",
                "blogger@writer.local",
            );
        }
        Ok(())
    }

    /// Generates a built-in scenic gradient sample image with simulated iPhone 15 Pro EXIF metadata
    /// so the user can immediately test filters, Polaroid frames, watermarks, and WebP conversion.
    pub fn create_demo_photo_asset(&self) -> Result<ImageAssetRecord> {
        let asset_id = "img_demo_01".to_string();
        let recipe_path = self
            .root_dir
            .join(".writer/recipes")
            .join(format!("{}.json", asset_id));
        if recipe_path.exists() {
            let content = std::fs::read_to_string(&recipe_path)?;
            if let Ok(record) = serde_json::from_str::<ImageAssetRecord>(&content) {
                return Ok(record);
            }
        }

        let width = 720u32;
        let height = 460u32;
        let mut img_buf = image::RgbaImage::new(width, height);
        for y in 0..height {
            let ty = y as f32 / height as f32;
            for x in 0..width {
                let tx = x as f32 / width as f32;
                // Sunset ocean horizon gradient with warm sun disc
                let sun_dist = ((tx - 0.68).powi(2) + (ty - 0.36).powi(2)).sqrt();
                let (mut r, mut g, mut b) = if ty < 0.62 {
                    // Sky
                    let k = ty / 0.62;
                    (
                        (45.0 + k * 205.0) as u8,
                        (85.0 + k * 110.0) as u8,
                        (165.0 - k * 45.0) as u8,
                    )
                } else {
                    // Ocean reflection
                    let k = (ty - 0.62) / 0.38;
                    let wave = ((y as f32 * 0.6 + x as f32 * 0.15).sin() * 10.0) as i16;
                    (
                        ((110.0 - k * 65.0) as i16 + wave).clamp(20, 240) as u8,
                        ((115.0 - k * 55.0) as i16 + wave).clamp(30, 240) as u8,
                        ((155.0 - k * 35.0) as i16 + wave).clamp(60, 250) as u8,
                    )
                };
                if sun_dist < 0.11 {
                    let glow = (1.0 - sun_dist / 0.11).powf(1.5);
                    r = (r as f32 + (255.0 - r as f32) * glow) as u8;
                    g = (g as f32 + (235.0 - g as f32) * glow) as u8;
                    b = (b as f32 + (190.0 - b as f32) * glow) as u8;
                }
                img_buf.put_pixel(x, y, image::Rgba([r, g, b, 255]));
            }
        }

        let raw_rel_path = "assets/raw/img_demo_01_IMG_4821.png".to_string();
        let raw_abs_path = self.root_dir.join(&raw_rel_path);
        let dyn_img = image::DynamicImage::ImageRgba8(img_buf);
        dyn_img.save(&raw_abs_path)?;
        let raw_size = std::fs::metadata(&raw_abs_path)?.len() as usize;

        let exif_info = ExifShootInfo {
            camera_make: Some("Apple".to_string()),
            camera_model: Some("iPhone 15 Pro".to_string()),
            focal_length: Some("24mm".to_string()),
            aperture: Some("f/1.78".to_string()),
            shutter_speed: Some("1/120s".to_string()),
            iso: Some("ISO 64".to_string()),
            orientation: 1,
            had_gps_data: true,
        };

        let recipe = ImageRecipe {
            filter: FilterPreset::FilmWarm,
            brightness: 4,
            contrast: 8,
            saturation: 10,
            crop: None,
            frame: FrameStyle::Polaroid,
            watermark_text: Some("SHOT ON IPHONE 15 PRO".to_string()),
            output_format: OutputImageFormat::Webp,
            max_width: 1080,
            strip_gps_metadata: true,
        };

        self.render_and_save_asset(
            &asset_id,
            "IMG_4821.HEIC",
            &raw_rel_path,
            dyn_img,
            raw_size,
            exif_info,
            recipe,
            Some("제주 해변 노을 (Film Warm + 폴라로이드 프레임)".to_string()),
        )
    }

    pub fn list_posts(&self) -> Result<Vec<PostDocument>> {
        let posts_dir = self.root_dir.join("posts");
        let mut posts = Vec::new();
        for entry in std::fs::read_dir(&posts_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("md") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if let Ok(doc) = self.load_post(stem) {
                        posts.push(doc);
                    }
                }
            }
        }
        posts.sort_by(|a, b| b.updated_at_unix.cmp(&a.updated_at_unix));
        Ok(posts)
    }

    pub fn load_post(&self, slug: &str) -> Result<PostDocument> {
        let safe_slug = sanitize_slug(slug);
        let path = self.root_dir.join("posts").join(format!("{}.md", safe_slug));
        let markdown = std::fs::read_to_string(&path)
            .with_context(|| format!("Failed to read post: {}", path.display()))?;
        let blocks = markdown_to_blocks(&markdown);
        let title = blocks
            .iter()
            .find_map(|b| match b {
                VisualBlock::Heading { text, .. } => Some(text.clone()),
                _ => None,
            })
            .unwrap_or_else(|| safe_slug.clone());
        let updated_at_unix = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        Ok(PostDocument {
            slug: safe_slug,
            title,
            markdown,
            blocks,
            updated_at_unix,
        })
    }

    pub fn save_post_markdown(&self, slug: &str, markdown: &str) -> Result<PostDocument> {
        let safe_slug = sanitize_slug(slug);
        let path = self.root_dir.join("posts").join(format!("{}.md", safe_slug));
        std::fs::write(&path, markdown)?;
        self.load_post(&safe_slug)
    }

    pub fn save_post_blocks(&self, slug: &str, blocks: &[VisualBlock]) -> Result<PostDocument> {
        let md = blocks_to_markdown(blocks);
        self.save_post_markdown(slug, &md)
    }

    /// Imports an external image file (`.heic`, `.jpg`, `.png`, `.webp`) into the workspace,
    /// extracts EXIF shoot info, strips GPS metadata, and renders the processed output.
    pub fn import_image_file(
        &self,
        source_path: &Path,
        initial_recipe: Option<ImageRecipe>,
    ) -> Result<ImageAssetRecord> {
        let (dyn_img, raw_bytes) = load_image_from_path(source_path)?;
        let original_filename = source_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("photo.jpg")
            .to_string();

        let short_uuid = &uuid::Uuid::new_v4().to_string()[..8];
        let asset_id = format!("img_{}", short_uuid);
        let raw_rel_path = format!("assets/raw/{}_{}", asset_id, original_filename);
        let raw_abs_path = self.root_dir.join(&raw_rel_path);
        std::fs::write(&raw_abs_path, &raw_bytes)?;

        let mut exif_info = extract_exif_info(&raw_bytes);
        // If importing an iPhone HEIC where EXIF make/model wasn't parsed from container box,
        // label it cleanly if extension is .heic
        if original_filename.to_lowercase().ends_with(".heic")
            && exif_info.camera_model.is_none()
        {
            exif_info.camera_make = Some("Apple".to_string());
            exif_info.camera_model = Some("iPhone (HEIC)".to_string());
        }

        let recipe = initial_recipe.unwrap_or_default();
        self.render_and_save_asset(
            &asset_id,
            &original_filename,
            &raw_rel_path,
            dyn_img,
            raw_bytes.len(),
            exif_info,
            recipe,
            None,
        )
    }

    /// Imports raw image bytes uploaded via drag-and-drop in the UI.
    pub fn import_image_bytes(
        &self,
        filename: &str,
        raw_bytes: &[u8],
        initial_recipe: Option<ImageRecipe>,
    ) -> Result<ImageAssetRecord> {
        let short_uuid = &uuid::Uuid::new_v4().to_string()[..8];
        let asset_id = format!("img_{}", short_uuid);
        let safe_name = filename.replace(['/', '\\'], "_");
        let raw_rel_path = format!("assets/raw/{}_{}", asset_id, safe_name);
        let raw_abs_path = self.root_dir.join(&raw_rel_path);
        std::fs::write(&raw_abs_path, raw_bytes)?;

        let (dyn_img, _) = load_image_from_path(&raw_abs_path)?;
        let mut exif_info = extract_exif_info(raw_bytes);
        if safe_name.to_lowercase().ends_with(".heic") && exif_info.camera_model.is_none() {
            exif_info.camera_make = Some("Apple".to_string());
            exif_info.camera_model = Some("iPhone (HEIC)".to_string());
        }

        let recipe = initial_recipe.unwrap_or_default();
        self.render_and_save_asset(
            &asset_id,
            &safe_name,
            &raw_rel_path,
            dyn_img,
            raw_bytes.len(),
            exif_info,
            recipe,
            None,
        )
    }

    /// Re-renders an existing asset with a modified `ImageRecipe` (non-destructive editing).
    pub fn update_image_recipe(
        &self,
        asset_id: &str,
        new_recipe: ImageRecipe,
        custom_caption: Option<String>,
    ) -> Result<ImageAssetRecord> {
        let existing = self.load_asset_record(asset_id)?;
        let raw_abs_path = self.root_dir.join(&existing.raw_rel_path);
        let (dyn_img, raw_bytes) = load_image_from_path(&raw_abs_path)?;

        self.render_and_save_asset(
            &existing.asset_id,
            &existing.original_filename,
            &existing.raw_rel_path,
            dyn_img,
            raw_bytes.len(),
            existing.exif_info,
            new_recipe,
            custom_caption.or(existing.custom_caption),
        )
    }

    pub fn load_asset_record(&self, asset_id: &str) -> Result<ImageAssetRecord> {
        let recipe_path = self
            .root_dir
            .join(".writer/recipes")
            .join(format!("{}.json", asset_id));
        let json = std::fs::read_to_string(&recipe_path)
            .with_context(|| format!("Asset record not found: {}", asset_id))?;
        let record: ImageAssetRecord = serde_json::from_str(&json)?;
        Ok(record)
    }

    pub fn list_assets(&self) -> Result<Vec<ImageAssetRecord>> {
        let recipes_dir = self.root_dir.join(".writer/recipes");
        let mut records = Vec::new();
        for entry in std::fs::read_dir(&recipes_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(json) = std::fs::read_to_string(&path) {
                    if let Ok(record) = serde_json::from_str::<ImageAssetRecord>(&json) {
                        records.push(record);
                    }
                }
            }
        }
        records.sort_by(|a, b| a.asset_id.cmp(&b.asset_id));
        Ok(records)
    }

    #[allow(clippy::too_many_arguments)]
    fn render_and_save_asset(
        &self,
        asset_id: &str,
        original_filename: &str,
        raw_rel_path: &str,
        dyn_img: image::DynamicImage,
        original_size_bytes: usize,
        exif_info: ExifShootInfo,
        recipe: ImageRecipe,
        custom_caption: Option<String>,
    ) -> Result<ImageAssetRecord> {
        let processed =
            process_loaded_image(dyn_img, original_size_bytes, exif_info.clone(), &recipe)?;
        let ext = recipe.output_format.extension();
        let dist_rel_path = format!("assets/dist/{}.{}", asset_id, ext);
        let dist_abs_path = self.root_dir.join(&dist_rel_path);
        std::fs::write(&dist_abs_path, &processed.encoded_bytes)?;

        let exif_summary = exif_info.formatted_summary();
        let record = ImageAssetRecord {
            asset_id: asset_id.to_string(),
            original_filename: original_filename.to_string(),
            raw_rel_path: raw_rel_path.to_string(),
            dist_rel_path,
            dist_abs_path: dist_abs_path.to_string_lossy().to_string(),
            recipe,
            exif_info,
            exif_summary,
            custom_caption,
            original_size_bytes: processed.original_size_bytes,
            processed_size_bytes: processed.processed_size_bytes,
            width: processed.width,
            height: processed.height,
            gps_removed_verified: processed.gps_removed_verified,
            preview_data_url: processed.preview_data_url,
        };

        let recipe_path = self
            .root_dir
            .join(".writer/recipes")
            .join(format!("{}.json", asset_id));
        std::fs::write(&recipe_path, serde_json::to_string_pretty(&record)?)?;

        Ok(record)
    }

    /// Compiles a post's Markdown into Tistory Rich HTML (both for clipboard copy and live preview).
    pub fn compile_post_for_tistory(
        &self,
        markdown: &str,
        preset: &TistoryStylePreset,
        include_preview_images: bool,
    ) -> Result<String> {
        let assets = self.list_assets()?;
        let mut lookup = HashMap::new();
        for (idx, asset) in assets.into_iter().enumerate() {
            let meta = TrayImageMeta {
                tray_index: idx + 1,
                asset_id: asset.asset_id.clone(),
                exported_filename: format!(
                    "{:02}_{}.{}",
                    idx + 1,
                    asset.asset_id,
                    asset.recipe.output_format.extension()
                ),
                exif_summary: asset.exif_summary.clone(),
                custom_caption: asset.custom_caption.clone(),
                preview_data_url: Some(asset.preview_data_url.clone()),
            };
            lookup.insert(asset.asset_id.clone(), meta.clone());
            lookup.insert(asset.dist_rel_path.clone(), meta);
        }

        Ok(compile_to_tistory_html(
            markdown,
            preset,
            &lookup,
            include_preview_images,
        ))
    }

    pub fn create_git_snapshot(&self, message: &str) -> Result<GitSnapshotInfo> {
        self.git
            .create_snapshot(message, "Writer Blogger", "blogger@writer.local")
    }

    pub fn list_git_snapshots(&self) -> Result<Vec<GitSnapshotInfo>> {
        self.git.list_snapshots(50)
    }

    pub fn diff_git_snapshot(&self, snapshot_id: &str) -> Result<String> {
        self.git.diff_snapshot_to_workdir(snapshot_id)
    }

    pub fn rollback_git_snapshot(&self, snapshot_id: &str) -> Result<GitSnapshotInfo> {
        self.git
            .rollback_to_snapshot(snapshot_id, "Writer Blogger", "blogger@writer.local")
    }

    pub fn get_git_remote_status(&self) -> Result<GitRemoteStatus> {
        self.git.get_remote_status()
    }

    pub fn set_git_remote_url(
        &self,
        remote_url: &str,
        token: Option<&str>,
    ) -> Result<GitRemoteStatus> {
        self.git.set_remote_url(remote_url, token)
    }

    pub fn push_git_remote(&self) -> Result<String> {
        self.git.push_to_remote()
    }

    pub fn pull_git_remote(&self) -> Result<String> {
        self.git.pull_from_remote()
    }
}

fn sanitize_slug(slug: &str) -> String {
    let s: String = slug
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = s.trim_matches('-');
    if trimmed.is_empty() {
        "untitled-post".to_string()
    } else {
        trimmed.to_string()
    }
}
