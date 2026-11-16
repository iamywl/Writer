#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use writer_core::{
    copy_image_bytes_to_clipboard, copy_rich_html_to_clipboard, GitRemoteStatus, GitSnapshotInfo,
    ImageAssetRecord, ImageRecipe, PostDocument, TistoryStylePreset, VisualBlock, WriterWorkspace,
};

#[derive(Clone)]
pub struct AppState {
    pub workspace_dir: PathBuf,
}

impl AppState {
    pub fn open_workspace(&self) -> anyhow::Result<WriterWorkspace> {
        WriterWorkspace::open_or_init(&self.workspace_dir)
    }
}

#[derive(Serialize)]
pub struct WorkspaceBootstrapResponse {
    pub workspace_path: String,
    pub posts: Vec<PostDocument>,
    pub active_post: PostDocument,
    pub assets: Vec<ImageAssetRecord>,
    pub snapshots: Vec<GitSnapshotInfo>,
    pub git_remote: GitRemoteStatus,
    pub default_preset: TistoryStylePreset,
    pub preview_html: String,
    pub copy_html: String,
}

#[derive(Serialize)]
pub struct SavePostResponse {
    pub post: PostDocument,
    pub posts: Vec<PostDocument>,
    pub preview_html: String,
    pub copy_html: String,
    pub has_changes: bool,
}

pub fn handle_get_workspace_bootstrap(state: &AppState) -> Result<WorkspaceBootstrapResponse, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    let posts = ws.list_posts().map_err(|e| e.to_string())?;
    let active_post = posts
        .first()
        .cloned()
        .ok_or_else(|| "No posts found in workspace".to_string())?;
    let assets = ws.list_assets().map_err(|e| e.to_string())?;
    let snapshots = ws.list_git_snapshots().map_err(|e| e.to_string())?;
    let git_remote = ws.get_git_remote_status().map_err(|e| e.to_string())?;
    let default_preset = TistoryStylePreset::default();
    let preview_html = ws
        .compile_post_for_tistory(&active_post.markdown, &default_preset, true)
        .map_err(|e| e.to_string())?;
    let copy_html = ws
        .compile_post_for_tistory(&active_post.markdown, &default_preset, false)
        .map_err(|e| e.to_string())?;

    Ok(WorkspaceBootstrapResponse {
        workspace_path: ws.root_dir().to_string_lossy().to_string(),
        posts,
        active_post,
        assets,
        snapshots,
        git_remote,
        default_preset,
        preview_html,
        copy_html,
    })
}

pub fn handle_load_post(
    state: &AppState,
    slug: &str,
    preset: &TistoryStylePreset,
) -> Result<SavePostResponse, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    let post = ws.load_post(slug).map_err(|e| e.to_string())?;
    let posts = ws.list_posts().map_err(|e| e.to_string())?;
    let preview_html = ws
        .compile_post_for_tistory(&post.markdown, preset, true)
        .map_err(|e| e.to_string())?;
    let copy_html = ws
        .compile_post_for_tistory(&post.markdown, preset, false)
        .map_err(|e| e.to_string())?;
    let has_changes = ws
        .git()
        .has_uncommitted_changes()
        .unwrap_or(false);
    Ok(SavePostResponse {
        post,
        posts,
        preview_html,
        copy_html,
        has_changes,
    })
}

pub fn handle_create_post(
    state: &AppState,
    slug: &str,
    title: &str,
    preset: &TistoryStylePreset,
) -> Result<SavePostResponse, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    let initial_md = format!("# {}\n\n새로운 블로그 글을 작성해 보세요.", title);
    let post = ws
        .save_post_markdown(slug, &initial_md)
        .map_err(|e| e.to_string())?;
    let posts = ws.list_posts().map_err(|e| e.to_string())?;
    let preview_html = ws
        .compile_post_for_tistory(&post.markdown, preset, true)
        .map_err(|e| e.to_string())?;
    let copy_html = ws
        .compile_post_for_tistory(&post.markdown, preset, false)
        .map_err(|e| e.to_string())?;
    let has_changes = ws
        .git()
        .has_uncommitted_changes()
        .unwrap_or(true);
    Ok(SavePostResponse {
        post,
        posts,
        preview_html,
        copy_html,
        has_changes,
    })
}

pub fn handle_save_markdown(
    state: &AppState,
    slug: &str,
    markdown: &str,
    preset: &TistoryStylePreset,
) -> Result<SavePostResponse, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    let post = ws
        .save_post_markdown(slug, markdown)
        .map_err(|e| e.to_string())?;
    let posts = ws.list_posts().map_err(|e| e.to_string())?;
    let preview_html = ws
        .compile_post_for_tistory(&post.markdown, preset, true)
        .map_err(|e| e.to_string())?;
    let copy_html = ws
        .compile_post_for_tistory(&post.markdown, preset, false)
        .map_err(|e| e.to_string())?;
    let has_changes = ws
        .git()
        .has_uncommitted_changes()
        .unwrap_or(false);
    Ok(SavePostResponse {
        post,
        posts,
        preview_html,
        copy_html,
        has_changes,
    })
}

pub fn handle_save_visual_blocks(
    state: &AppState,
    slug: &str,
    blocks: &[VisualBlock],
    preset: &TistoryStylePreset,
) -> Result<SavePostResponse, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    let post = ws
        .save_post_blocks(slug, blocks)
        .map_err(|e| e.to_string())?;
    let posts = ws.list_posts().map_err(|e| e.to_string())?;
    let preview_html = ws
        .compile_post_for_tistory(&post.markdown, preset, true)
        .map_err(|e| e.to_string())?;
    let copy_html = ws
        .compile_post_for_tistory(&post.markdown, preset, false)
        .map_err(|e| e.to_string())?;
    let has_changes = ws
        .git()
        .has_uncommitted_changes()
        .unwrap_or(false);
    Ok(SavePostResponse {
        post,
        posts,
        preview_html,
        copy_html,
        has_changes,
    })
}

pub fn handle_upload_image(
    state: &AppState,
    filename: &str,
    base64_data: &str,
    recipe: Option<ImageRecipe>,
) -> Result<Value, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    let raw_bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Invalid base64 image data: {}", e))?;
    let asset = ws
        .import_image_bytes(filename, &raw_bytes, recipe)
        .map_err(|e| e.to_string())?;
    let assets = ws.list_assets().map_err(|e| e.to_string())?;
    let has_changes = ws.git().has_uncommitted_changes().unwrap_or(true);
    Ok(json!({
        "asset": asset,
        "assets": assets,
        "has_changes": has_changes,
    }))
}

pub fn handle_update_image_recipe(
    state: &AppState,
    asset_id: &str,
    recipe: ImageRecipe,
    custom_caption: Option<String>,
    markdown: &str,
    preset: &TistoryStylePreset,
) -> Result<Value, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    let asset = ws
        .update_image_recipe(asset_id, recipe, custom_caption)
        .map_err(|e| e.to_string())?;
    let assets = ws.list_assets().map_err(|e| e.to_string())?;
    let preview_html = ws
        .compile_post_for_tistory(markdown, preset, true)
        .map_err(|e| e.to_string())?;
    let copy_html = ws
        .compile_post_for_tistory(markdown, preset, false)
        .map_err(|e| e.to_string())?;
    let has_changes = ws.git().has_uncommitted_changes().unwrap_or(true);
    Ok(json!({
        "asset": asset,
        "assets": assets,
        "preview_html": preview_html,
        "copy_html": copy_html,
        "has_changes": has_changes,
    }))
}

pub fn handle_copy_tistory_html(
    state: &AppState,
    markdown: &str,
    preset: &TistoryStylePreset,
) -> Result<Value, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    let html = ws
        .compile_post_for_tistory(markdown, preset, false)
        .map_err(|e| e.to_string())?;
    let copied = copy_rich_html_to_clipboard(&html, markdown).is_ok();
    Ok(json!({
        "html": html,
        "copied_to_os_clipboard": copied,
    }))
}

pub fn handle_copy_tray_image(state: &AppState, asset_id: &str) -> Result<Value, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    let record = ws.load_asset_record(asset_id).map_err(|e| e.to_string())?;
    let encoded_bytes = std::fs::read(&record.dist_abs_path).map_err(|e| e.to_string())?;
    let copied = copy_image_bytes_to_clipboard(&encoded_bytes).is_ok();
    Ok(json!({
        "width": record.width,
        "height": record.height,
        "preview_data_url": record.preview_data_url,
        "copied_to_os_clipboard": copied,
    }))
}

pub fn handle_create_git_snapshot(state: &AppState, message: &str) -> Result<Value, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    let snapshot = ws.create_git_snapshot(message).map_err(|e| e.to_string())?;
    let snapshots = ws.list_git_snapshots().map_err(|e| e.to_string())?;
    Ok(json!({
        "snapshot": snapshot,
        "snapshots": snapshots,
    }))
}

pub fn handle_diff_git_snapshot(state: &AppState, snapshot_id: &str) -> Result<Value, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    let diff = ws
        .diff_git_snapshot(snapshot_id)
        .map_err(|e| e.to_string())?;
    Ok(json!({ "diff": diff }))
}

pub fn handle_rollback_git_snapshot(
    state: &AppState,
    snapshot_id: &str,
    active_slug: &str,
    preset: &TistoryStylePreset,
) -> Result<WorkspaceBootstrapResponse, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    ws.rollback_git_snapshot(snapshot_id)
        .map_err(|e| e.to_string())?;
    let posts = ws.list_posts().map_err(|e| e.to_string())?;
    let active_post = ws
        .load_post(active_slug)
        .or_else(|_| {
            posts
                .first()
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("No post"))
        })
        .map_err(|e| e.to_string())?;
    let assets = ws.list_assets().map_err(|e| e.to_string())?;
    let snapshots = ws.list_git_snapshots().map_err(|e| e.to_string())?;
    let git_remote = ws.get_git_remote_status().map_err(|e| e.to_string())?;
    let preview_html = ws
        .compile_post_for_tistory(&active_post.markdown, preset, true)
        .map_err(|e| e.to_string())?;
    let copy_html = ws
        .compile_post_for_tistory(&active_post.markdown, preset, false)
        .map_err(|e| e.to_string())?;

    Ok(WorkspaceBootstrapResponse {
        workspace_path: ws.root_dir().to_string_lossy().to_string(),
        posts,
        active_post,
        assets,
        snapshots,
        git_remote,
        default_preset: preset.clone(),
        preview_html,
        copy_html,
    })
}

pub fn handle_set_git_remote(
    state: &AppState,
    remote_url: &str,
    token: Option<&str>,
) -> Result<Value, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    let status = ws
        .set_git_remote_url(remote_url, token)
        .map_err(|e| e.to_string())?;
    Ok(json!({ "git_remote": status }))
}

pub fn handle_push_git_remote(state: &AppState) -> Result<Value, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    let msg = ws.push_git_remote().map_err(|e| e.to_string())?;
    Ok(json!({ "message": msg }))
}

pub fn handle_pull_git_remote(
    state: &AppState,
    active_slug: &str,
    preset: &TistoryStylePreset,
) -> Result<WorkspaceBootstrapResponse, String> {
    let ws = state.open_workspace().map_err(|e| e.to_string())?;
    ws.pull_git_remote().map_err(|e| e.to_string())?;
    let posts = ws.list_posts().map_err(|e| e.to_string())?;
    let active_post = ws
        .load_post(active_slug)
        .or_else(|_| {
            posts
                .first()
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("No post"))
        })
        .map_err(|e| e.to_string())?;
    let assets = ws.list_assets().map_err(|e| e.to_string())?;
    let snapshots = ws.list_git_snapshots().map_err(|e| e.to_string())?;
    let git_remote = ws.get_git_remote_status().map_err(|e| e.to_string())?;
    let preview_html = ws
        .compile_post_for_tistory(&active_post.markdown, preset, true)
        .map_err(|e| e.to_string())?;
    let copy_html = ws
        .compile_post_for_tistory(&active_post.markdown, preset, false)
        .map_err(|e| e.to_string())?;

    Ok(WorkspaceBootstrapResponse {
        workspace_path: ws.root_dir().to_string_lossy().to_string(),
        posts,
        active_post,
        assets,
        snapshots,
        git_remote,
        default_preset: preset.clone(),
        preview_html,
        copy_html,
    })
}

// =========================================================================
// Tauri v2 Commands
// =========================================================================
#[tauri::command]
fn get_workspace_bootstrap(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<WorkspaceBootstrapResponse, String> {
    handle_get_workspace_bootstrap(&state)
}

#[tauri::command]
fn load_post_cmd(
    state: tauri::State<'_, Arc<AppState>>,
    slug: String,
    preset: TistoryStylePreset,
) -> Result<SavePostResponse, String> {
    handle_load_post(&state, &slug, &preset)
}

#[tauri::command]
fn create_post_cmd(
    state: tauri::State<'_, Arc<AppState>>,
    slug: String,
    title: String,
    preset: TistoryStylePreset,
) -> Result<SavePostResponse, String> {
    handle_create_post(&state, &slug, &title, &preset)
}

#[tauri::command]
fn save_markdown_cmd(
    state: tauri::State<'_, Arc<AppState>>,
    slug: String,
    markdown: String,
    preset: TistoryStylePreset,
) -> Result<SavePostResponse, String> {
    handle_save_markdown(&state, &slug, &markdown, &preset)
}

#[tauri::command]
fn save_visual_blocks_cmd(
    state: tauri::State<'_, Arc<AppState>>,
    slug: String,
    blocks: Vec<VisualBlock>,
    preset: TistoryStylePreset,
) -> Result<SavePostResponse, String> {
    handle_save_visual_blocks(&state, &slug, &blocks, &preset)
}

#[tauri::command]
fn upload_image_cmd(
    state: tauri::State<'_, Arc<AppState>>,
    filename: String,
    #[allow(non_snake_case)] base64Data: String,
    recipe: Option<ImageRecipe>,
) -> Result<Value, String> {
    handle_upload_image(&state, &filename, &base64Data, recipe)
}

#[tauri::command]
fn update_image_recipe_cmd(
    state: tauri::State<'_, Arc<AppState>>,
    #[allow(non_snake_case)] assetId: String,
    recipe: ImageRecipe,
    #[allow(non_snake_case)] customCaption: Option<String>,
    markdown: String,
    preset: TistoryStylePreset,
) -> Result<Value, String> {
    handle_update_image_recipe(&state, &assetId, recipe, customCaption, &markdown, &preset)
}

#[tauri::command]
fn copy_tistory_html_cmd(
    state: tauri::State<'_, Arc<AppState>>,
    markdown: String,
    preset: TistoryStylePreset,
) -> Result<Value, String> {
    handle_copy_tistory_html(&state, &markdown, &preset)
}

#[tauri::command]
fn copy_tray_image_cmd(
    state: tauri::State<'_, Arc<AppState>>,
    #[allow(non_snake_case)] assetId: String,
) -> Result<Value, String> {
    handle_copy_tray_image(&state, &assetId)
}

#[tauri::command]
fn create_git_snapshot_cmd(
    state: tauri::State<'_, Arc<AppState>>,
    message: String,
) -> Result<Value, String> {
    handle_create_git_snapshot(&state, &message)
}

#[tauri::command]
fn diff_git_snapshot_cmd(
    state: tauri::State<'_, Arc<AppState>>,
    #[allow(non_snake_case)] snapshotId: String,
) -> Result<Value, String> {
    handle_diff_git_snapshot(&state, &snapshotId)
}

#[tauri::command]
fn rollback_git_snapshot_cmd(
    state: tauri::State<'_, Arc<AppState>>,
    #[allow(non_snake_case)] snapshotId: String,
    #[allow(non_snake_case)] activeSlug: String,
    preset: TistoryStylePreset,
) -> Result<WorkspaceBootstrapResponse, String> {
    handle_rollback_git_snapshot(&state, &snapshotId, &activeSlug, &preset)
}

#[tauri::command]
fn set_git_remote_cmd(
    state: tauri::State<'_, Arc<AppState>>,
    #[allow(non_snake_case)] remoteUrl: String,
    token: Option<String>,
) -> Result<Value, String> {
    handle_set_git_remote(&state, &remoteUrl, token.as_deref())
}

#[tauri::command]
fn push_git_remote_cmd(state: tauri::State<'_, Arc<AppState>>) -> Result<Value, String> {
    handle_push_git_remote(&state)
}

#[tauri::command]
fn pull_git_remote_cmd(
    state: tauri::State<'_, Arc<AppState>>,
    #[allow(non_snake_case)] activeSlug: String,
    preset: TistoryStylePreset,
) -> Result<WorkspaceBootstrapResponse, String> {
    handle_pull_git_remote(&state, &activeSlug, &preset)
}

#[tauri::command]
fn open_copy_window_cmd(
    app: tauri::AppHandle,
    #[allow(non_snake_case)] activeSlug: Option<String>,
) -> Result<Value, String> {
    let query = match activeSlug {
        Some(ref s) if !s.is_empty() => format!("index.html?window=copy&slug={}", s),
        _ => "index.html?window=copy".to_string(),
    };
    if let Some(win) = app.get_webview_window("copy-window") {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(json!({ "opened": true }));
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "copy-window",
        tauri::WebviewUrl::App(query.into()),
    )
    .title("Writer — 복붙 전용 창")
    .inner_size(640.0, 820.0)
    .min_inner_size(420.0, 480.0)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(json!({ "opened": true }))
}

// =========================================================================
// Local HTTP RPC Fallback Server (127.0.0.1:14210)
// =========================================================================
fn run_http_rpc_server(state: Arc<AppState>, port: u16) {
    let addr = format!("127.0.0.1:{}", port);
    let Ok(server) = tiny_http::Server::http(&addr) else {
        return;
    };
    println!("Writer Rust RPC server listening on http://{}", addr);

    for mut req in server.incoming_requests() {
        if req.method() == &tiny_http::Method::Options {
            let cors_origin =
                tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..])
                    .unwrap();
            let cors_methods = tiny_http::Header::from_bytes(
                &b"Access-Control-Allow-Methods"[..],
                &b"POST, GET, OPTIONS"[..],
            )
            .unwrap();
            let cors_headers = tiny_http::Header::from_bytes(
                &b"Access-Control-Allow-Headers"[..],
                &b"Content-Type"[..],
            )
            .unwrap();
            let response = tiny_http::Response::from_string("")
                .with_status_code(200)
                .with_header(cors_origin)
                .with_header(cors_methods)
                .with_header(cors_headers);
            let _ = req.respond(response);
            continue;
        }

        let url = req.url().to_string();
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let payload: Value = serde_json::from_str(&body).unwrap_or_else(|_| json!({}));

        let result: Result<Value, String> = match url.as_str() {
            "/api/get_workspace_bootstrap" => {
                handle_get_workspace_bootstrap(&state).map(|r| serde_json::to_value(r).unwrap())
            }
            "/api/load_post_cmd" => {
                let slug = payload["slug"].as_str().unwrap_or("");
                let preset: TistoryStylePreset =
                    serde_json::from_value(payload["preset"].clone()).unwrap_or_default();
                handle_load_post(&state, slug, &preset).map(|r| serde_json::to_value(r).unwrap())
            }
            "/api/create_post_cmd" => {
                let slug = payload["slug"].as_str().unwrap_or("new-post");
                let title = payload["title"].as_str().unwrap_or("새 포스트");
                let preset: TistoryStylePreset =
                    serde_json::from_value(payload["preset"].clone()).unwrap_or_default();
                handle_create_post(&state, slug, title, &preset)
                    .map(|r| serde_json::to_value(r).unwrap())
            }
            "/api/save_markdown_cmd" => {
                let slug = payload["slug"].as_str().unwrap_or("");
                let markdown = payload["markdown"].as_str().unwrap_or("");
                let preset: TistoryStylePreset =
                    serde_json::from_value(payload["preset"].clone()).unwrap_or_default();
                handle_save_markdown(&state, slug, markdown, &preset)
                    .map(|r| serde_json::to_value(r).unwrap())
            }
            "/api/save_visual_blocks_cmd" => {
                let slug = payload["slug"].as_str().unwrap_or("");
                let blocks: Vec<VisualBlock> =
                    serde_json::from_value(payload["blocks"].clone()).unwrap_or_default();
                let preset: TistoryStylePreset =
                    serde_json::from_value(payload["preset"].clone()).unwrap_or_default();
                handle_save_visual_blocks(&state, slug, &blocks, &preset)
                    .map(|r| serde_json::to_value(r).unwrap())
            }
            "/api/upload_image_cmd" => {
                let filename = payload["filename"].as_str().unwrap_or("photo.jpg");
                let base64_data = payload["base64Data"].as_str().unwrap_or("");
                let recipe: Option<ImageRecipe> =
                    serde_json::from_value(payload["recipe"].clone()).ok();
                handle_upload_image(&state, filename, base64_data, recipe)
            }
            "/api/update_image_recipe_cmd" => {
                let asset_id = payload["assetId"].as_str().unwrap_or("");
                let recipe: ImageRecipe =
                    serde_json::from_value(payload["recipe"].clone()).unwrap_or_default();
                let custom_caption = payload["customCaption"].as_str().map(|s| s.to_string());
                let markdown = payload["markdown"].as_str().unwrap_or("");
                let preset: TistoryStylePreset =
                    serde_json::from_value(payload["preset"].clone()).unwrap_or_default();
                handle_update_image_recipe(
                    &state,
                    asset_id,
                    recipe,
                    custom_caption,
                    markdown,
                    &preset,
                )
            }
            "/api/copy_tistory_html_cmd" => {
                let markdown = payload["markdown"].as_str().unwrap_or("");
                let preset: TistoryStylePreset =
                    serde_json::from_value(payload["preset"].clone()).unwrap_or_default();
                handle_copy_tistory_html(&state, markdown, &preset)
            }
            "/api/copy_tray_image_cmd" => {
                let asset_id = payload["assetId"].as_str().unwrap_or("");
                handle_copy_tray_image(&state, asset_id)
            }
            "/api/create_git_snapshot_cmd" => {
                let message = payload["message"].as_str().unwrap_or("스냅샷 저장");
                handle_create_git_snapshot(&state, message)
            }
            "/api/diff_git_snapshot_cmd" => {
                let snapshot_id = payload["snapshotId"].as_str().unwrap_or("");
                handle_diff_git_snapshot(&state, snapshot_id)
            }
            "/api/rollback_git_snapshot_cmd" => {
                let snapshot_id = payload["snapshotId"].as_str().unwrap_or("");
                let active_slug = payload["activeSlug"].as_str().unwrap_or("");
                let preset: TistoryStylePreset =
                    serde_json::from_value(payload["preset"].clone()).unwrap_or_default();
                handle_rollback_git_snapshot(&state, snapshot_id, active_slug, &preset)
                    .map(|r| serde_json::to_value(r).unwrap())
            }
            "/api/set_git_remote_cmd" => {
                let remote_url = payload["remoteUrl"].as_str().unwrap_or("");
                let token = payload["token"].as_str();
                handle_set_git_remote(&state, remote_url, token)
            }
            "/api/push_git_remote_cmd" => handle_push_git_remote(&state),
            "/api/pull_git_remote_cmd" => {
                let active_slug = payload["activeSlug"].as_str().unwrap_or("");
                let preset: TistoryStylePreset =
                    serde_json::from_value(payload["preset"].clone()).unwrap_or_default();
                handle_pull_git_remote(&state, active_slug, &preset)
                    .map(|r| serde_json::to_value(r).unwrap())
            }
            _ => Err(format!("Unknown endpoint: {}", url)),
        };

        let (status, json_str) = match result {
            Ok(val) => (200, serde_json::to_string(&val).unwrap_or_default()),
            Err(err) => (400, serde_json::to_string(&json!({ "error": err })).unwrap_or_default()),
        };

        let header =
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
        let cors =
            tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap();
        let response = tiny_http::Response::from_string(json_str)
            .with_status_code(status)
            .with_header(header)
            .with_header(cors);
        let _ = req.respond(response);
    }
}

fn resolve_workspace_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("WRITER_WORKSPACE_DIR") {
        return PathBuf::from(custom);
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join("Documents").join("WriterWorkspace");
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.ends_with("src-tauri") {
        cwd.parent().unwrap_or(&cwd).join("blog_workspace")
    } else {
        cwd.join("blog_workspace")
    }
}

fn main() {
    let workspace_dir = resolve_workspace_dir();
    let state = Arc::new(AppState { workspace_dir });

    // Ensure workspace is initialized on startup
    let _ = state.open_workspace();

    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--headless-server") {
        run_http_rpc_server(state, 14210);
        return;
    }

    let bg_state = state.clone();
    std::thread::spawn(move || {
        run_http_rpc_server(bg_state, 14210);
    });

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_workspace_bootstrap,
            load_post_cmd,
            create_post_cmd,
            save_markdown_cmd,
            save_visual_blocks_cmd,
            upload_image_cmd,
            update_image_recipe_cmd,
            copy_tistory_html_cmd,
            copy_tray_image_cmd,
            create_git_snapshot_cmd,
            diff_git_snapshot_cmd,
            rollback_git_snapshot_cmd,
            set_git_remote_cmd,
            push_git_remote_cmd,
            pull_git_remote_cmd,
            open_copy_window_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Writer Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use writer_core::{FilterPreset, FrameStyle, OutputImageFormat};

    #[test]
    fn test_e2e_app_workflow_bootstrap_visual_edit_image_studio_and_git_rollback() {
        let tmp = tempfile::tempdir().unwrap();
        let state = AppState {
            workspace_dir: tmp.path().to_path_buf(),
        };

        // 1. Bootstrap initializes workspace, sample post, demo iPhone asset, and initial commit
        let boot = handle_get_workspace_bootstrap(&state).unwrap();
        assert!(!boot.posts.is_empty());
        assert!(!boot.assets.is_empty());
        assert!(!boot.snapshots.is_empty());
        assert!(boot.copy_html.contains("data-writer-tray-slot=\"1\""));

        let slug = boot.active_post.slug.clone();
        let preset = boot.default_preset.clone();

        // 2. Edit via Visual Blocks (non-developer workflow: heading + 24px paragraph + code block)
        let new_blocks = vec![
            VisualBlock::Heading {
                level: 1,
                text: "비주얼 에디터로 작성한 글".to_string(),
            },
            VisualBlock::Paragraph {
                text: "드래그해서 24px로 키운 문장입니다.".to_string(),
                font_size_px: Some(24),
            },
            VisualBlock::CodeBlock {
                language: "rust".to_string(),
                code: "let ok = true;".to_string(),
            },
        ];
        let saved = handle_save_visual_blocks(&state, &slug, &new_blocks, &preset).unwrap();
        assert!(saved.post.markdown.contains("<!-- writer:size=24 -->"));
        assert!(saved.copy_html.contains("font-size: 24px;"));

        // 3. Create Git Snapshot for this change
        let snap_res = handle_create_git_snapshot(&state, "비주얼 편집 완료").unwrap();
        let new_snap_id = snap_res["snapshot"]["id"].as_str().unwrap().to_string();

        // 4. Modify image recipe in Image Studio (VintageFade + Polaroid + JPEG conversion)
        let asset_id = boot.assets[0].asset_id.clone();
        let updated_recipe = ImageRecipe {
            filter: FilterPreset::VintageFade,
            brightness: 5,
            contrast: 10,
            saturation: -10,
            crop: None,
            frame: FrameStyle::Polaroid,
            watermark_text: Some("MY TISTORY BLOG".to_string()),
            output_format: OutputImageFormat::Jpeg,
            max_width: 1080,
            strip_gps_metadata: true,
        };
        let img_res = handle_update_image_recipe(
            &state,
            &asset_id,
            updated_recipe,
            Some("폴라로이드 프레임 적용 완료".to_string()),
            &saved.post.markdown,
            &preset,
        )
        .unwrap();
        assert_eq!(img_res["asset"]["recipe"]["output_format"], "jpeg");
        assert_eq!(img_res["asset"]["gps_removed_verified"], true);

        // 5. Modify markdown again and check Git Diff against `new_snap_id`
        handle_save_markdown(&state, &slug, "# 임시 수정본\n\n되돌릴 예정입니다.", &preset)
            .unwrap();
        let diff_res = handle_diff_git_snapshot(&state, &new_snap_id).unwrap();
        let diff_str = diff_res["diff"].as_str().unwrap();
        assert!(diff_str.contains("-# 비주얼 에디터로 작성한 글"));
        assert!(diff_str.contains("+# 임시 수정본"));

        // 6. Rollback to `new_snap_id` and verify restoration
        let rolled_back =
            handle_rollback_git_snapshot(&state, &new_snap_id, &slug, &preset).unwrap();
        assert!(rolled_back
            .active_post
            .markdown
            .contains("# 비주얼 에디터로 작성한 글"));
    }
}
