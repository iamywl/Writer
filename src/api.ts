import { invoke } from "@tauri-apps/api/core";

export type VisualBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string; font_size_px?: number }
  | { type: "quote"; text: string }
  | { type: "code_block"; language: string; code: string }
  | {
      type: "image";
      asset_id: string;
      src: string;
      alt: string;
      exif_caption?: string;
      custom_caption?: string;
    }
  | { type: "bullet_list"; items: string[] }
  | { type: "divider" };

export type FilterPreset =
  | "original"
  | "film_warm"
  | "vintage_fade"
  | "monochrome"
  | "vivid_pop"
  | "cool_cinema";

export type FrameStyle = "none" | "minimal_white" | "polaroid" | "rounded_shadow";

export type OutputImageFormat = "webp" | "jpeg" | "png";

export interface ImageRecipe {
  filter: FilterPreset;
  brightness: number;
  contrast: number;
  saturation: number;
  crop: null | { x: number; y: number; width: number; height: number };
  frame: FrameStyle;
  watermark_text: string | null;
  output_format: OutputImageFormat;
  max_width: number;
  strip_gps_metadata: boolean;
}

export interface ExifShootInfo {
  camera_make: string | null;
  camera_model: string | null;
  focal_length: string | null;
  aperture: string | null;
  shutter_speed: string | null;
  iso: string | null;
  orientation: number;
  had_gps_data: boolean;
}

export interface ImageAssetRecord {
  asset_id: string;
  original_filename: string;
  raw_rel_path: string;
  dist_rel_path: string;
  dist_abs_path: string;
  recipe: ImageRecipe;
  exif_info: ExifShootInfo;
  exif_summary: string | null;
  custom_caption: string | null;
  original_size_bytes: number;
  processed_size_bytes: number;
  width: number;
  height: number;
  gps_removed_verified: boolean;
  preview_data_url: string;
}

export interface PostDocument {
  slug: string;
  title: string;
  markdown: string;
  blocks: VisualBlock[];
  updated_at_unix: number;
}

export interface GitSnapshotInfo {
  id: string;
  short_id: string;
  message: string;
  author: string;
  timestamp_iso: string;
  timestamp_unix: number;
}

export interface GitRemoteStatus {
  remote_url: string | null;
  branch: string;
}

export interface TistoryStylePreset {
  name: string;
  font_family: string;
  body_font_size_px: number;
  line_height: number;
  h1_size_px: number;
  h2_size_px: number;
  h3_size_px: number;
  h4_size_px: number;
  accent_color: string;
  quote_bg_color: string;
  code_theme: string;
}

export interface WorkspaceBootstrap {
  workspace_path: string;
  posts: PostDocument[];
  active_post: PostDocument;
  assets: ImageAssetRecord[];
  snapshots: GitSnapshotInfo[];
  git_remote: GitRemoteStatus;
  default_preset: TistoryStylePreset;
  preview_html: string;
  copy_html: string;
}

export interface SavePostResult {
  post: PostDocument;
  posts: PostDocument[];
  preview_html: string;
  copy_html: string;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function callBackend<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauriRuntime()) {
    try {
      return await invoke<T>(cmd, args);
    } catch {
      // Fallback to embedded local HTTP RPC server
    }
  }
  const res = await fetch(`http://127.0.0.1:14210/api/${cmd}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || `Backend error (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getBootstrap: () => callBackend<WorkspaceBootstrap>("get_workspace_bootstrap"),
  loadPost: (slug: string, preset: TistoryStylePreset) =>
    callBackend<SavePostResult>("load_post_cmd", { slug, preset }),
  createPost: (slug: string, title: string, preset: TistoryStylePreset) =>
    callBackend<SavePostResult>("create_post_cmd", { slug, title, preset }),
  saveMarkdown: (slug: string, markdown: string, preset: TistoryStylePreset) =>
    callBackend<SavePostResult>("save_markdown_cmd", { slug, markdown, preset }),
  saveVisualBlocks: (slug: string, blocks: VisualBlock[], preset: TistoryStylePreset) =>
    callBackend<SavePostResult>("save_visual_blocks_cmd", { slug, blocks, preset }),
  uploadImage: (filename: string, base64Data: string, recipe?: ImageRecipe) =>
    callBackend<{ asset: ImageAssetRecord; assets: ImageAssetRecord[] }>("upload_image_cmd", {
      filename,
      base64Data,
      recipe: recipe ?? null,
    }),
  updateImageRecipe: (
    assetId: string,
    recipe: ImageRecipe,
    customCaption: string | null,
    markdown: string,
    preset: TistoryStylePreset
  ) =>
    callBackend<{
      asset: ImageAssetRecord;
      assets: ImageAssetRecord[];
      preview_html: string;
      copy_html: string;
    }>("update_image_recipe_cmd", {
      assetId,
      recipe,
      customCaption,
      markdown,
      preset,
    }),
  copyTistoryHtml: (markdown: string, preset: TistoryStylePreset) =>
    callBackend<{ html: string; copied_to_os_clipboard: boolean }>("copy_tistory_html_cmd", {
      markdown,
      preset,
    }),
  copyTrayImage: (assetId: string) =>
    callBackend<{
      width: number;
      height: number;
      preview_data_url: string;
      copied_to_os_clipboard: boolean;
    }>("copy_tray_image_cmd", { assetId }),
  createGitSnapshot: (message: string) =>
    callBackend<{ snapshot: GitSnapshotInfo; snapshots: GitSnapshotInfo[] }>(
      "create_git_snapshot_cmd",
      { message }
    ),
  diffGitSnapshot: (snapshotId: string) =>
    callBackend<{ diff: string }>("diff_git_snapshot_cmd", { snapshotId }),
  rollbackGitSnapshot: (snapshotId: string, activeSlug: string, preset: TistoryStylePreset) =>
    callBackend<WorkspaceBootstrap>("rollback_git_snapshot_cmd", {
      snapshotId,
      activeSlug,
      preset,
    }),
  setGitRemote: (remoteUrl: string, token?: string) =>
    callBackend<{ git_remote: GitRemoteStatus }>("set_git_remote_cmd", {
      remoteUrl,
      token: token || null,
    }),
  pushGitRemote: () => callBackend<{ message: string }>("push_git_remote_cmd"),
  pullGitRemote: (activeSlug: string, preset: TistoryStylePreset) =>
    callBackend<WorkspaceBootstrap>("pull_git_remote_cmd", {
      activeSlug,
      preset,
    }),
};
