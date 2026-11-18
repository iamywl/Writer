pub mod clipboard;
pub mod git_engine;
pub mod image_studio;
pub mod markdown;
pub mod workspace;

pub use clipboard::{copy_image_bytes_to_clipboard, copy_rich_html_to_clipboard};
pub use git_engine::{GitRemoteStatus, GitSnapshotInfo, WorkspaceGit};
pub use image_studio::{
    extract_exif_info, has_gps_metadata, load_image_from_path, process_image_bytes,
    process_loaded_image, CropRect, ExifShootInfo, FilterPreset, FrameStyle, ImageRecipe,
    OutputImageFormat, ProcessedImageOutput,
};
pub use markdown::{
    blocks_to_markdown, compile_to_tistory_html, compile_to_tistory_html_with_cites,
    markdown_to_blocks, CiteEntry, TistoryStylePreset, TrayImageMeta, VisualBlock,
};
pub use workspace::{ImageAssetRecord, PostDocument, WriterWorkspace};

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use std::collections::HashMap;
    use tempfile::tempdir;

    // =========================================================================
    // 검증 1: 마크다운 ↔ 비주얼 에디터 왕복 변환(Round-trip) 무결성 테스트
    // =========================================================================
    #[test]
    fn test_markdown_visual_blocks_round_trip() {
        let original_blocks = vec![
            VisualBlock::Heading {
                level: 1,
                text: "오버리프 스타일 블로그 에디터".to_string(),
            },
            VisualBlock::Paragraph {
                text: "비개발자도 글자 크기를 20px로 키워서 작성할 수 있습니다.".to_string(),
                font_size_px: Some(20),
            },
            VisualBlock::Paragraph {
                text: "일반 본문 단락입니다. **굵은 글씨**와 `인라인 코드`를 포함합니다.".to_string(),
                font_size_px: None,
            },
            VisualBlock::Quote {
                text: "깃(Git) 기반으로 모든 버전이 안전하게 기록됩니다.".to_string(),
            },
            VisualBlock::Image {
                asset_id: "img_001".to_string(),
                src: "assets/dist/img_001.webp".to_string(),
                alt: "아이폰 촬영 샘플".to_string(),
                exif_caption: Some("iPhone 15 Pro · 24mm · f/1.78 · 1/120s · ISO 64".to_string()),
                custom_caption: Some("성산일출봉 일몰".to_string()),
            },
            VisualBlock::CodeBlock {
                language: "rust".to_string(),
                code: "fn hello() {\n    println!(\"Hello Tistory!\");\n}".to_string(),
            },
            VisualBlock::BulletList {
                items: vec![
                    "첫 번째 항목".to_string(),
                    "두 번째 항목".to_string(),
                ],
            },
            VisualBlock::Divider,
        ];

        let markdown = blocks_to_markdown(&original_blocks);
        let parsed_blocks = markdown_to_blocks(&markdown);

        assert_eq!(original_blocks, parsed_blocks);
    }

    proptest! {
        #[test]
        fn prop_roundtrip_headings_and_sized_paragraphs(
            level in 1u8..=4u8,
            heading in "[가-힣a-zA-Z0-9 ]{1,30}",
            body in "[가-힣a-zA-Z0-9 .,!?]{1,60}",
            font_size in prop::option::of(12u16..=32u16),
        ) {
            let h_trimmed = heading.trim().to_string();
            let b_trimmed = body.trim().to_string();
            prop_assume!(!h_trimmed.is_empty() && !b_trimmed.is_empty());
            prop_assume!(!b_trimmed.starts_with('#') && !b_trimmed.starts_with('>') && !b_trimmed.starts_with('-') && !b_trimmed.starts_with('*'));

            let blocks = vec![
                VisualBlock::Heading { level, text: h_trimmed },
                VisualBlock::Paragraph { text: b_trimmed, font_size_px: font_size },
            ];
            let md = blocks_to_markdown(&blocks);
            let roundtripped = markdown_to_blocks(&md);
            prop_assert_eq!(blocks, roundtripped);
        }
    }

    // =========================================================================
    // 검증 2: 아이폰 사진 EXIF 추출, GPS 개인정보 0바이트 제거, 필터/폴라로이드/WebP 골든 테스트
    // =========================================================================
    /// Builds a valid JPEG image embedded with a real TIFF/EXIF APP1 segment containing
    /// both iPhone camera shoot settings AND sensitive GPS coordinates.
    fn build_test_jpeg_with_iphone_exif_and_gps() -> Vec<u8> {
        let mut img = image::RgbImage::new(320, 240);
        for (x, y, px) in img.enumerate_pixels_mut() {
            *px = image::Rgb([(x % 256) as u8, (y % 256) as u8, 180]);
        }
        let mut raw_jpeg = Vec::new();
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut raw_jpeg, 90);
        use image::ImageEncoder;
        encoder
            .write_image(&img, 320, 240, image::ExtendedColorType::Rgb8)
            .unwrap();

        // Construct a minimal big-endian EXIF APP1 payload with:
        // - Make (0x010F): "Apple\0"
        // - Model (0x0110): "iPhone 15 Pro\0"
        // - Orientation (0x0112): 1
        // - ExifIFDPointer (0x8769)
        // - GPSInfoIFDPointer (0x8825)
        let exif_app1 = build_minimal_exif_app1_segment();

        // Insert APP1 segment right after SOI (0xFF, 0xD8)
        let mut with_exif = Vec::with_capacity(raw_jpeg.len() + exif_app1.len());
        with_exif.extend_from_slice(&raw_jpeg[..2]);
        with_exif.extend_from_slice(&exif_app1);
        with_exif.extend_from_slice(&raw_jpeg[2..]);
        with_exif
    }

    fn build_minimal_exif_app1_segment() -> Vec<u8> {
        // TIFF Header (Big Endian "MM", 0x002A, offset to IFD0 = 8)
        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"MM\x00\x2a\x00\x00\x00\x08");

        // IFD0 at offset 8: 5 entries
        // Each entry is 12 bytes -> 2 + 5*12 + 4 = 66 bytes (ends at offset 74)
        // Let's place data values starting at offset 80:
        // offset 80..86: "Apple\0" (6 bytes)
        // offset 86..100: "iPhone 15 Pro\0" (14 bytes)
        // offset 100..164: Exif SubIFD (4 entries: ExposureTime, FNumber, ISO, FocalLen35mm)
        // offset 180..220: GPS IFD (2 entries: GPSLatitudeRef, GPSLatitude)
        tiff.extend_from_slice(&5u16.to_be_bytes());

        // Entry 1: Make (0x010F), ASCII (2), count 6, offset 80
        tiff.extend_from_slice(&0x010Fu16.to_be_bytes());
        tiff.extend_from_slice(&2u16.to_be_bytes());
        tiff.extend_from_slice(&6u32.to_be_bytes());
        tiff.extend_from_slice(&80u32.to_be_bytes());

        // Entry 2: Model (0x0110), ASCII (2), count 14, offset 86
        tiff.extend_from_slice(&0x0110u16.to_be_bytes());
        tiff.extend_from_slice(&2u16.to_be_bytes());
        tiff.extend_from_slice(&14u32.to_be_bytes());
        tiff.extend_from_slice(&86u32.to_be_bytes());

        // Entry 3: Orientation (0x0112), SHORT (3), count 1, value 1
        tiff.extend_from_slice(&0x0112u16.to_be_bytes());
        tiff.extend_from_slice(&3u16.to_be_bytes());
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&[0, 1, 0, 0]);

        // Entry 4: ExifIFDPointer (0x8769), LONG (4), count 1, offset 100
        tiff.extend_from_slice(&0x8769u16.to_be_bytes());
        tiff.extend_from_slice(&4u16.to_be_bytes());
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&100u32.to_be_bytes());

        // Entry 5: GPSInfoIFDPointer (0x8825), LONG (4), count 1, offset 172
        tiff.extend_from_slice(&0x8825u16.to_be_bytes());
        tiff.extend_from_slice(&4u16.to_be_bytes());
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&172u32.to_be_bytes());

        // Next IFD offset = 0
        tiff.extend_from_slice(&0u32.to_be_bytes());

        // Pad to offset 80
        while tiff.len() < 80 {
            tiff.push(0);
        }
        // Offset 80: "Apple\0"
        tiff.extend_from_slice(b"Apple\0");
        // Offset 86: "iPhone 15 Pro\0"
        tiff.extend_from_slice(b"iPhone 15 Pro\0");

        // Offset 100: Exif SubIFD (4 entries -> 2 + 48 + 4 = 54 bytes -> 100..154)
        // Rational values at offset 156 (ExposureTime 1/120) and 164 (FNumber 178/100)
        tiff.extend_from_slice(&4u16.to_be_bytes());

        // Exif Entry 1: ExposureTime (0x829A), RATIONAL (5), count 1, offset 156
        tiff.extend_from_slice(&0x829Au16.to_be_bytes());
        tiff.extend_from_slice(&5u16.to_be_bytes());
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&156u32.to_be_bytes());

        // Exif Entry 2: FNumber (0x829D), RATIONAL (5), count 1, offset 164
        tiff.extend_from_slice(&0x829Du16.to_be_bytes());
        tiff.extend_from_slice(&5u16.to_be_bytes());
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&164u32.to_be_bytes());

        // Exif Entry 3: PhotographicSensitivity / ISO (0x8827), SHORT (3), count 1, value 64
        tiff.extend_from_slice(&0x8827u16.to_be_bytes());
        tiff.extend_from_slice(&3u16.to_be_bytes());
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&[0, 64, 0, 0]);

        // Exif Entry 4: FocalLengthIn35mmFilm (0xA405), SHORT (3), count 1, value 24
        tiff.extend_from_slice(&0xA405u16.to_be_bytes());
        tiff.extend_from_slice(&3u16.to_be_bytes());
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&[0, 24, 0, 0]);

        // End of Exif SubIFD
        tiff.extend_from_slice(&0u32.to_be_bytes());
        while tiff.len() < 156 {
            tiff.push(0);
        }
        // Offset 156: ExposureTime = 1 / 120
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&120u32.to_be_bytes());
        // Offset 164: FNumber = 178 / 100
        tiff.extend_from_slice(&178u32.to_be_bytes());
        tiff.extend_from_slice(&100u32.to_be_bytes());

        // Offset 172: GPS IFD (1 entry: GPSLatitudeRef = "N\0")
        tiff.extend_from_slice(&1u16.to_be_bytes());
        tiff.extend_from_slice(&0x0001u16.to_be_bytes()); // GPSLatitudeRef
        tiff.extend_from_slice(&2u16.to_be_bytes()); // ASCII
        tiff.extend_from_slice(&2u32.to_be_bytes());
        tiff.extend_from_slice(b"N\0\0\0");
        tiff.extend_from_slice(&0u32.to_be_bytes());

        // Wrap in JPEG APP1 marker (0xFF, 0xE1, length, "Exif\0\0", tiff)
        let payload_len = 2 + 6 + tiff.len();
        let mut app1 = Vec::new();
        app1.extend_from_slice(&[0xFF, 0xE1]);
        app1.extend_from_slice(&(payload_len as u16).to_be_bytes());
        app1.extend_from_slice(b"Exif\0\0");
        app1.extend_from_slice(&tiff);
        app1
    }

    #[test]
    fn test_iphone_exif_extraction_and_gps_privacy_removal() {
        let jpeg_with_gps = build_test_jpeg_with_iphone_exif_and_gps();

        // 1. Verify raw image has GPS metadata and accurate iPhone shoot info
        let exif = extract_exif_info(&jpeg_with_gps);
        assert!(exif.had_gps_data, "Input photo must be detected as having GPS data");
        assert_eq!(
            exif.formatted_summary().as_deref(),
            Some("iPhone 15 Pro · 24mm · f/1.78 · 1/120s · ISO 64")
        );

        // 2. Process with FilmWarm filter, Polaroid frame, watermark, and WebP conversion
        let recipe = ImageRecipe {
            filter: FilterPreset::FilmWarm,
            brightness: 10,
            contrast: 12,
            saturation: 15,
            crop: None,
            frame: FrameStyle::Polaroid,
            watermark_text: Some("WRITER STUDIO".to_string()),
            output_format: OutputImageFormat::Webp,
            max_width: 800,
            strip_gps_metadata: true,
        };

        let output = process_image_bytes(&jpeg_with_gps, &recipe).unwrap();

        // 3. Verify GPS metadata is 100% removed in the processed output
        assert!(output.gps_removed_verified);
        assert!(!has_gps_metadata(&output.encoded_bytes));

        // 4. Verify WebP header ("RIFF....WEBP") and Polaroid expanded dimensions
        assert_eq!(&output.encoded_bytes[0..4], b"RIFF");
        assert_eq!(&output.encoded_bytes[8..12], b"WEBP");
        assert!(output.width > 320 && output.height > 240);
    }

    #[test]
    fn test_macos_heic_import_and_format_conversion() {
        let dir = tempdir().unwrap();
        let png_path = dir.path().join("sample.png");
        let heic_path = dir.path().join("IMG_9999.HEIC");

        let mut img = image::RgbaImage::new(200, 150);
        for px in img.pixels_mut() {
            *px = image::Rgba([40, 120, 220, 255]);
        }
        img.save(&png_path).unwrap();

        // Use macOS sips to create a genuine Apple .HEIC file
        let status = std::process::Command::new("/usr/bin/sips")
            .args(["-s", "format", "heic"])
            .arg(&png_path)
            .arg("--out")
            .arg(&heic_path)
            .output()
            .unwrap();

        if status.status.success() && heic_path.exists() {
            let ws_dir = dir.path().join("workspace");
            let ws = WriterWorkspace::open_or_init(&ws_dir).unwrap();
            let asset = ws
                .import_image_file(
                    &heic_path,
                    Some(ImageRecipe {
                        filter: FilterPreset::VintageFade,
                        frame: FrameStyle::RoundedShadow,
                        output_format: OutputImageFormat::Webp,
                        ..Default::default()
                    }),
                )
                .unwrap();

            assert!(asset.dist_rel_path.ends_with(".webp"));
            assert!(asset.gps_removed_verified);
            assert!(std::path::Path::new(&asset.dist_abs_path).exists());
        }
    }

    #[test]
    fn test_overleaf_cite_bibtex_and_references_rendering() {
        let dir = tempdir().unwrap();
        let ws = WriterWorkspace::open_or_init(dir.path()).unwrap();

        let bib = r#"@inproceedings{hewitt1973,
            author = {Carl Hewitt and Peter Bishop and Richard Steiger},
            title = {A Universal Modular ACTOR Formalism for Artificial Intelligence},
            booktitle = {Proceedings of IJCAI},
            year = {1973},
            url = {https://ijcai.org/1973}
        }"#;
        let cites = ws.import_bibtex_cites(bib).unwrap();
        assert_eq!(cites.len(), 1);
        assert_eq!(cites[0].key, "hewitt1973");

        let md = "Agent의 개념은 1973년 Actor Model[@hewitt1973]에서 처음 제안되었다. 또한 \\cite{hewitt1973} 참고.";
        let html = ws
            .compile_post_for_tistory(md, &TistoryStylePreset::default(), false)
            .unwrap();

        assert!(html.contains(">[1]</a>"));
        assert!(html.contains("References</h3>"));
        assert!(html.contains("Carl Hewitt and Peter Bishop and Richard Steiger"));
        assert!(html.contains("A Universal Modular ACTOR Formalism for Artificial Intelligence"));

        // Also verify plain-text ACM/APA citation parsing
        let plain = "Carl Hewitt, Peter Bishop, and Richard Steiger. 1973. A universal modular ACTOR formalism for artificial intelligence. In Proceedings of the 3rd international joint conference on Artificial intelligence (IJCAI'73).";
        let plain_cites = ws.import_bibtex_cites(plain).unwrap();
        assert!(plain_cites.iter().any(|c| c.year == "1973" && c.title.contains("ACTOR formalism")));
    }

    // =========================================================================
    // 검증 3: 티스토리 클립보드 인라인 CSS & 구문 강조 HTML 컴파일러 검증
    // =========================================================================
    #[test]
    fn test_tistory_inline_html_compiler_and_syntax_highlighting() {
        let md = r#"# 티스토리 제목 H1

## 소제목 H2

<!-- writer:size=22 -->
이 문단은 22px 크기로 지정된 강조 문단입니다.

> 인용구 블록도 인라인 스타일로 변환됩니다.

<!-- writer:img id=img_01 | exif=iPhone 15 Pro · 24mm · f/1.78 | caption=직접 입력한 사진 설명 -->
![샘플 사진](assets/dist/img_01.webp)

```rust
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
```"#;

        let preset = TistoryStylePreset::default();
        let mut lookup = HashMap::new();
        lookup.insert(
            "img_01".to_string(),
            TrayImageMeta {
                tray_index: 1,
                asset_id: "img_01".to_string(),
                exported_filename: "01_img_01.webp".to_string(),
                exif_summary: Some("iPhone 15 Pro · 24mm · f/1.78".to_string()),
                custom_caption: Some("직접 입력한 사진 설명".to_string()),
                preview_data_url: None,
            },
        );

        let html = compile_to_tistory_html(md, &preset, &lookup, false);

        // Verify inline styles for headings and custom paragraph font size
        assert!(html.contains("<h1 style=\"font-family:"));
        assert!(html.contains("font-size: 28px;"));
        assert!(html.contains("<h2 style=\"font-family:"));
        assert!(html.contains("font-size: 22px;"));
        assert!(html.contains("<blockquote style=\"margin: 24px 0;"));
        // Verify syntect inline color spans on Rust code
        assert!(html.contains("<span style=\"color:#"));
        // Verify Processed Image Tray placeholder & EXIF camera caption
        assert!(html.contains("data-writer-tray-slot=\"1\""));
        assert!(html.contains("01_img_01.webp"));
        assert!(html.contains("iPhone 15 Pro · 24mm · f/1.78"));
        assert!(html.contains("직접 입력한 사진 설명"));
    }

    // =========================================================================
    // 검증 4: 내장 Git 엔진 스냅샷 커밋 · Diff · 롤백 샌드박스 통합 테스트
    // =========================================================================
    #[test]
    fn test_git_engine_snapshot_diff_and_rollback() {
        let dir = tempdir().unwrap();
        let ws = WriterWorkspace::open_or_init(dir.path()).unwrap();

        // Save Version 1 of a blog post
        ws.save_post_markdown("my-trip", "# 제주 여행기 v1\n\n첫째 날 기록입니다.")
            .unwrap();
        let snap1 = ws.create_git_snapshot("제주 여행기 1차 작성").unwrap();

        // Attempting to create another snapshot with ZERO changes must fail!
        assert!(
            ws.create_git_snapshot("중복 빈 스냅샷 시도").is_err(),
            "Empty snapshot with no changes must be rejected"
        );

        // Modify to Version 2
        ws.save_post_markdown(
            "my-trip",
            "# 제주 여행기 v2 (수정본)\n\n첫째 날과 둘째 날 기록을 추가했습니다.",
        )
        .unwrap();

        // Verify Diff between snap1 and current working tree
        let diff = ws.diff_git_snapshot(&snap1.id).unwrap();
        assert!(diff.contains("-# 제주 여행기 v1"));
        assert!(diff.contains("+# 제주 여행기 v2 (수정본)"));

        let snap2 = ws.create_git_snapshot("제주 여행기 2차 수정").unwrap();
        assert_ne!(snap1.id, snap2.id);

        // Rollback to Snapshot 1
        let rollback_snap = ws.rollback_git_snapshot(&snap1.id).unwrap();
        assert!(rollback_snap.message.contains("버전 복원"));

        // Verify file on disk is restored to Version 1
        let restored_post = ws.load_post("my-trip").unwrap();
        assert_eq!(
            restored_post.markdown,
            "# 제주 여행기 v1\n\n첫째 날 기록입니다."
        );

        // Verify timeline has initial + snap1 + snap2 + rollback_snap
        let history = ws.list_git_snapshots().unwrap();
        assert!(history.len() >= 4);
    }

    #[test]
    fn test_git_remote_link_and_push() {
        let dir = tempdir().unwrap();
        let local_dir = dir.path().join("local_ws");
        let remote_bare_dir = dir.path().join("remote_origin.git");

        // Initialize a bare remote Git repository
        git2::Repository::init_bare(&remote_bare_dir).unwrap();

        let ws = WriterWorkspace::open_or_init(&local_dir).unwrap();
        let remote_path_str = remote_bare_dir.to_string_lossy().to_string();

        // Link remote URL
        let status = ws.set_git_remote_url(&remote_path_str, None).unwrap();
        assert_eq!(status.remote_url.as_deref(), Some(remote_path_str.as_str()));

        // Push to remote
        let push_msg = ws.push_git_remote().unwrap();
        assert!(push_msg.contains("푸시 완료"));

        // Verify token masking in HTTPS URLs
        let https_status = ws
            .set_git_remote_url("https://github.com/myuser/my-blog.git", Some("ghp_secret123"))
            .unwrap();
        assert_eq!(
            https_status.remote_url.as_deref(),
            Some("https://github.com/myuser/my-blog.git")
        );
    }
}
