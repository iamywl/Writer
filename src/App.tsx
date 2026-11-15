import React, { useEffect, useRef, useState } from "react";
import {
  api,
  FilterPreset,
  FrameStyle,
  GitRemoteStatus,
  GitSnapshotInfo,
  ImageAssetRecord,
  ImageRecipe,
  OutputImageFormat,
  PostDocument,
  TistoryStylePreset,
  VisualBlock,
} from "./api";

type EditorViewMode = "split" | "visual" | "code" | "tistory";

const FILTER_LABELS: { value: FilterPreset; label: string; desc: string }[] = [
  { value: "original", label: "Original", desc: "원본 색감" },
  { value: "film_warm", label: "Film Warm", desc: "따스한 코닥 필름" },
  { value: "vintage_fade", label: "Vintage Fade", desc: "매트 빈티지" },
  { value: "monochrome", label: "Monochrome", desc: "클래식 고대비 흑백" },
  { value: "vivid_pop", label: "Vivid Pop", desc: "선명한 색감 강조" },
  { value: "cool_cinema", label: "Cool Cinema", desc: "차분한 시네마틱" },
];

const FRAME_LABELS: { value: FrameStyle; label: string }[] = [
  { value: "none", label: "프레임 없음" },
  { value: "polaroid", label: "폴라로이드 프레임 (하단 스탬프)" },
  { value: "minimal_white", label: "미니멀 화이트 여백" },
  { value: "rounded_shadow", label: "둥근 모서리 + 배경" },
];

export function App() {
  const [workspacePath, setWorkspacePath] = useState<string>("");
  const [posts, setPosts] = useState<PostDocument[]>([]);
  const [activePost, setActivePost] = useState<PostDocument | null>(null);
  const [markdownText, setMarkdownText] = useState<string>("");
  const [visualBlocks, setVisualBlocks] = useState<VisualBlock[]>([]);
  const [assets, setAssets] = useState<ImageAssetRecord[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<ImageRecipe | null>(null);
  const [editingCaption, setEditingCaption] = useState<string>("");

  const [snapshots, setSnapshots] = useState<GitSnapshotInfo[]>([]);
  const [commitMessage, setCommitMessage] = useState<string>("");
  const [diffModal, setDiffModal] = useState<{ snapshot: GitSnapshotInfo; diff: string } | null>(
    null
  );
  const [gitRemote, setGitRemote] = useState<GitRemoteStatus>({
    remote_url: null,
    branch: "main",
  });
  const [showRemoteInput, setShowRemoteInput] = useState<boolean>(false);
  const [remoteUrlInput, setRemoteUrlInput] = useState<string>("");
  const [remoteTokenInput, setRemoteTokenInput] = useState<string>("");

  const [preset, setPreset] = useState<TistoryStylePreset>({
    name: "Tistory Modern Clean",
    font_family:
      "'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
    body_font_size_px: 16,
    line_height: 1.85,
    h1_size_px: 28,
    h2_size_px: 23,
    h3_size_px: 19,
    h4_size_px: 17,
    accent_color: "#2563eb",
    quote_bg_color: "#f8fafc",
    code_theme: "base16-ocean.dark",
  });

  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [copyHtml, setCopyHtml] = useState<string>("");
  const [viewMode, setViewMode] = useState<EditorViewMode>("split");
  const [rightTab, setRightTab] = useState<"tray" | "studio">("tray");
  const [showStyleConfig, setShowStyleConfig] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [newPostTitle, setNewPostTitle] = useState<string>("");
  const [showNewPostInput, setShowNewPostInput] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showToastMessage = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3400);
  };

  useEffect(() => {
    api
      .getBootstrap()
      .then((boot) => {
        setWorkspacePath(boot.workspace_path);
        setPosts(boot.posts);
        setActivePost(boot.active_post);
        setMarkdownText(boot.active_post.markdown);
        setVisualBlocks(boot.active_post.blocks);
        setAssets(boot.assets);
        if (boot.assets.length > 0) {
          setSelectedAssetId(boot.assets[0].asset_id);
          setEditingRecipe(boot.assets[0].recipe);
          setEditingCaption(boot.assets[0].custom_caption ?? "");
        }
        setSnapshots(boot.snapshots);
        if (boot.git_remote) {
          setGitRemote(boot.git_remote);
          setRemoteUrlInput(boot.git_remote.remote_url ?? "");
        }
        setPreset(boot.default_preset);
        setPreviewHtml(boot.preview_html);
        setCopyHtml(boot.copy_html);
      })
      .catch((err) => {
        showToastMessage(`초기화 오류: ${err.message}`);
      });
  }, []);

  const selectedAsset = assets.find((a) => a.asset_id === selectedAssetId) ?? null;

  const handleSelectAsset = (asset: ImageAssetRecord, switchToStudio = false) => {
    setSelectedAssetId(asset.asset_id);
    setEditingRecipe({ ...asset.recipe });
    setEditingCaption(asset.custom_caption ?? "");
    if (switchToStudio) {
      setRightTab("studio");
    }
  };

  const handleSelectPost = async (slug: string) => {
    try {
      const res = await api.loadPost(slug, preset);
      setActivePost(res.post);
      setPosts(res.posts);
      setMarkdownText(res.post.markdown);
      setVisualBlocks(res.post.blocks);
      setPreviewHtml(res.preview_html);
      setCopyHtml(res.copy_html);
    } catch (err: any) {
      showToastMessage(`글 불러오기 실패: ${err.message}`);
    }
  };

  const handleCreatePost = async () => {
    if (!newPostTitle.trim()) return;
    try {
      const slug =
        newPostTitle
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9가-힣]+/g, "-")
          .replace(/^-+|-+$/g, "") || `post-${Date.now()}`;
      const res = await api.createPost(slug, newPostTitle.trim(), preset);
      setActivePost(res.post);
      setPosts(res.posts);
      setMarkdownText(res.post.markdown);
      setVisualBlocks(res.post.blocks);
      setPreviewHtml(res.preview_html);
      setCopyHtml(res.copy_html);
      setNewPostTitle("");
      setShowNewPostInput(false);
      showToastMessage(`새 포스트 '${res.post.title}' 생성 완료`);
    } catch (err: any) {
      showToastMessage(`새 글 생성 실패: ${err.message}`);
    }
  };

  const syncFromMarkdown = async (newMd: string, customPreset = preset) => {
    setMarkdownText(newMd);
    if (!activePost) return;
    try {
      const res = await api.saveMarkdown(activePost.slug, newMd, customPreset);
      setActivePost(res.post);
      setPosts(res.posts);
      setVisualBlocks(res.post.blocks);
      setPreviewHtml(res.preview_html);
      setCopyHtml(res.copy_html);
    } catch (err: any) {
      showToastMessage(`동기화 오류: ${err.message}`);
    }
  };

  const syncFromVisualBlocks = async (newBlocks: VisualBlock[], customPreset = preset) => {
    setVisualBlocks(newBlocks);
    if (!activePost) return;
    try {
      const res = await api.saveVisualBlocks(activePost.slug, newBlocks, customPreset);
      setActivePost(res.post);
      setPosts(res.posts);
      setMarkdownText(res.post.markdown);
      setPreviewHtml(res.preview_html);
      setCopyHtml(res.copy_html);
    } catch (err: any) {
      showToastMessage(`비주얼 블록 저장 오류: ${err.message}`);
    }
  };

  const handlePresetChange = async (updated: TistoryStylePreset) => {
    setPreset(updated);
    if (activePost) {
      await syncFromMarkdown(markdownText, updated);
    }
  };

  const updateBlockAt = (idx: number, updated: VisualBlock) => {
    const next = [...visualBlocks];
    next[idx] = updated;
    syncFromVisualBlocks(next);
  };

  const removeBlockAt = (idx: number) => {
    const next = visualBlocks.filter((_, i) => i !== idx);
    syncFromVisualBlocks(next);
  };

  const moveBlock = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= visualBlocks.length) return;
    const next = [...visualBlocks];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    syncFromVisualBlocks(next);
  };

  const addBlock = (block: VisualBlock) => {
    syncFromVisualBlocks([...visualBlocks, block]);
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setIsBusy(true);
    try {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64Data = btoa(binary);
      const res = await api.uploadImage(file.name, base64Data);
      setAssets(res.assets);
      handleSelectAsset(res.asset, true);
      showToastMessage(
        `📸 '${file.name}' 임포트 및 GPS 메타데이터 제거 완료 (${res.asset.recipe.output_format.toUpperCase()})`
      );
    } catch (err: any) {
      showToastMessage(`이미지 처리 실패: ${err.message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleApplyImageRecipe = async () => {
    if (!selectedAsset || !editingRecipe) return;
    setIsBusy(true);
    try {
      const res = await api.updateImageRecipe(
        selectedAsset.asset_id,
        editingRecipe,
        editingCaption.trim() || null,
        markdownText,
        preset
      );
      setAssets(res.assets);
      setPreviewHtml(res.preview_html);
      setCopyHtml(res.copy_html);
      showToastMessage(
        `✨ 이미지 필터·프레임·포맷(${res.asset.recipe.output_format.toUpperCase()}) 렌더링 완료!`
      );
    } catch (err: any) {
      showToastMessage(`레시피 적용 실패: ${err.message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleInsertAssetIntoPost = (asset: ImageAssetRecord) => {
    const newBlock: VisualBlock = {
      type: "image",
      asset_id: asset.asset_id,
      src: asset.dist_rel_path,
      alt: asset.custom_caption || asset.original_filename,
      exif_caption: asset.exif_summary ?? undefined,
      custom_caption: asset.custom_caption ?? undefined,
    };
    addBlock(newBlock);
    showToastMessage(`본문에 '${asset.original_filename}' 사진 블록이 추가되었습니다.`);
  };

  const handleCopyTistoryHtml = async () => {
    try {
      const res = await api.copyTistoryHtml(markdownText, preset);
      // Also write to browser clipboard if available for dual safety
      if (navigator.clipboard && window.ClipboardItem) {
        try {
          const htmlBlob = new Blob([res.html], { type: "text/html" });
          const textBlob = new Blob([markdownText], { type: "text/plain" });
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": htmlBlob,
              "text/plain": textBlob,
            }),
          ]);
        } catch {
          // OS native arboard clipboard already succeeded
        }
      }
      showToastMessage(
        "📋 티스토리용 인라인 서식(HTML + 코드 하이라이팅) 복사 완료! 티스토리 에디터에 바로 붙여넣기(Cmd+V) 하세요."
      );
    } catch (err: any) {
      showToastMessage(`클립보드 복사 실패: ${err.message}`);
    }
  };

  const handleCopyTrayImage = async (asset: ImageAssetRecord) => {
    try {
      const res = await api.copyTrayImage(asset.asset_id);
      showToastMessage(
        `🖼️ 가공된 이미지(${res.width}×${res.height})가 OS 클립보드에 복사되었습니다! 티스토리 사진 자리에 바로 Cmd+V 하세요.`
      );
    } catch (err: any) {
      showToastMessage(`이미지 복사 실패: ${err.message}`);
    }
  };

  const handleCreateSnapshot = async () => {
    const msg = commitMessage.trim() || `버전 스냅샷 (${new Date().toLocaleTimeString()})`;
    try {
      const res = await api.createGitSnapshot(msg);
      setSnapshots(res.snapshots);
      setCommitMessage("");
      showToastMessage(`📌 Git 스냅샷 저장 완료: [${res.snapshot.short_id}] ${res.snapshot.message}`);
    } catch (err: any) {
      showToastMessage(`Git 커밋 실패: ${err.message}`);
    }
  };

  const handleViewDiff = async (snap: GitSnapshotInfo) => {
    try {
      const res = await api.diffGitSnapshot(snap.id);
      setDiffModal({
        snapshot: snap,
        diff: res.diff || "(현재 작업 본문과 이 스냅샷 간에 차이점이 없습니다.)",
      });
    } catch (err: any) {
      showToastMessage(`Diff 조회 실패: ${err.message}`);
    }
  };

  const handleRollbackSnapshot = async (snap: GitSnapshotInfo) => {
    if (!activePost) return;
    try {
      const boot = await api.rollbackGitSnapshot(snap.id, activePost.slug, preset);
      setPosts(boot.posts);
      setActivePost(boot.active_post);
      setMarkdownText(boot.active_post.markdown);
      setVisualBlocks(boot.active_post.blocks);
      setAssets(boot.assets);
      setSnapshots(boot.snapshots);
      setPreviewHtml(boot.preview_html);
      setCopyHtml(boot.copy_html);
      setDiffModal(null);
      showToastMessage(`⏪ 스냅샷 [${snap.short_id}] 상태로 안전하게 복원되었습니다!`);
    } catch (err: any) {
      showToastMessage(`버전 복원 실패: ${err.message}`);
    }
  };

  const handleSaveGitRemote = async () => {
    try {
      const res = await api.setGitRemote(remoteUrlInput.trim(), remoteTokenInput.trim());
      setGitRemote(res.git_remote);
      setRemoteTokenInput("");
      setShowRemoteInput(false);
      if (res.git_remote.remote_url) {
        showToastMessage(`🔗 Git 원격 저장소 연결 완료: ${res.git_remote.remote_url}`);
      } else {
        showToastMessage("원격 저장소 연결이 해제되었습니다.");
      }
    } catch (err: any) {
      showToastMessage(`원격 저장소 설정 실패: ${err.message}`);
    }
  };

  const handlePushRemote = async () => {
    setIsBusy(true);
    try {
      const res = await api.pushGitRemote();
      showToastMessage(`⬆️ ${res.message}`);
    } catch (err: any) {
      showToastMessage(`Push 오류: ${err.message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handlePullRemote = async () => {
    if (!activePost) return;
    setIsBusy(true);
    try {
      const boot = await api.pullGitRemote(activePost.slug, preset);
      setPosts(boot.posts);
      setActivePost(boot.active_post);
      setMarkdownText(boot.active_post.markdown);
      setVisualBlocks(boot.active_post.blocks);
      setAssets(boot.assets);
      setSnapshots(boot.snapshots);
      setPreviewHtml(boot.preview_html);
      setCopyHtml(boot.copy_html);
      showToastMessage("⬇️ 원격 저장소에서 최신 글과 이미지를 가져왔습니다!");
    } catch (err: any) {
      showToastMessage(`Pull 오류: ${err.message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="app-shell">
      {/* Top Overleaf-inspired Header */}
      <header className="top-bar">
        <div className="brand-group">
          <div className="brand-logo">W</div>
          <div>
            <div className="brand-title">
              Writer <span className="rust-badge">Rust + Git</span>
            </div>
            <div className="workspace-path" title={workspacePath}>
              📁 {workspacePath || "로컬 Git 워크스페이스"}
            </div>
          </div>
        </div>

        <div className="mode-switcher" role="tablist">
          <button
            className={viewMode === "split" ? "mode-btn active" : "mode-btn"}
            onClick={() => setViewMode("split")}
          >
            ⚡ Split (Overleaf 모드)
          </button>
          <button
            className={viewMode === "visual" ? "mode-btn active" : "mode-btn"}
            onClick={() => setViewMode("visual")}
          >
            ✍️ 비주얼 에디터 (일반)
          </button>
          <button
            className={viewMode === "code" ? "mode-btn active" : "mode-btn"}
            onClick={() => setViewMode("code")}
          >
            💻 마크다운 코드 (숙련자)
          </button>
          <button
            className={viewMode === "tistory" ? "mode-btn active" : "mode-btn"}
            onClick={() => setViewMode("tistory")}
          >
            👀 티스토리 프리뷰 & HTML
          </button>
        </div>

        <div className="top-actions">
          <button
            className="btn-secondary"
            onClick={() => setShowStyleConfig((prev) => !prev)}
          >
            🎨 티스토리 서식 설정
          </button>
          <button className="btn-primary-copy" onClick={handleCopyTistoryHtml}>
            📋 티스토리용 서식 전체 복사 (Cmd+V용)
          </button>
        </div>
      </header>

      {/* Collapsible Tistory Style Customizer Bar */}
      {showStyleConfig && (
        <div className="style-config-bar">
          <div className="style-field">
            <label>H1 제목 크기</label>
            <input
              type="number"
              value={preset.h1_size_px}
              min={20}
              max={42}
              onChange={(e) =>
                handlePresetChange({ ...preset, h1_size_px: Number(e.target.value) })
              }
            />
            <span>px</span>
          </div>
          <div className="style-field">
            <label>H2 소제목 크기</label>
            <input
              type="number"
              value={preset.h2_size_px}
              min={18}
              max={34}
              onChange={(e) =>
                handlePresetChange({ ...preset, h2_size_px: Number(e.target.value) })
              }
            />
            <span>px</span>
          </div>
          <div className="style-field">
            <label>본문 기본 크기</label>
            <input
              type="number"
              value={preset.body_font_size_px}
              min={13}
              max={24}
              onChange={(e) =>
                handlePresetChange({ ...preset, body_font_size_px: Number(e.target.value) })
              }
            />
            <span>px</span>
          </div>
          <div className="style-field">
            <label>줄간격</label>
            <input
              type="number"
              step="0.05"
              value={preset.line_height}
              min={1.4}
              max={2.4}
              onChange={(e) =>
                handlePresetChange({ ...preset, line_height: Number(e.target.value) })
              }
            />
          </div>
          <div className="style-field">
            <label>포인트 컬러</label>
            <input
              type="color"
              value={preset.accent_color}
              onChange={(e) => handlePresetChange({ ...preset, accent_color: e.target.value })}
            />
          </div>
          <div className="style-field">
            <label>코드 하이라이팅 테마</label>
            <select
              value={preset.code_theme}
              onChange={(e) => handlePresetChange({ ...preset, code_theme: e.target.value })}
            >
              <option value="base16-ocean.dark">Ocean Dark (다크)</option>
              <option value="InspiredGitHub">GitHub Clean (라이트)</option>
              <option value="Solarized (dark)">Solarized Dark</option>
              <option value="Solarized (light)">Solarized Light</option>
            </select>
          </div>
        </div>
      )}

      {/* Main 3-Column Workspace */}
      <div className="workspace-grid">
        {/* LEFT SIDEBAR: Posts & Git Version Timeline */}
        <aside className="left-sidebar">
          <div className="sidebar-section">
            <div className="section-header">
              <span>📄 블로그 글 목록</span>
              <button
                className="btn-mini"
                onClick={() => setShowNewPostInput((prev) => !prev)}
              >
                + 새 글
              </button>
            </div>
            {showNewPostInput && (
              <div className="new-post-box">
                <input
                  type="text"
                  placeholder="새 글 제목 입력..."
                  value={newPostTitle}
                  onChange={(e) => setNewPostTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreatePost()}
                />
                <button onClick={handleCreatePost}>생성</button>
              </div>
            )}
            <div className="post-list">
              {posts.map((p) => (
                <button
                  key={p.slug}
                  className={
                    activePost?.slug === p.slug ? "post-item active" : "post-item"
                  }
                  onClick={() => handleSelectPost(p.slug)}
                >
                  <div className="post-item-title">{p.title}</div>
                  <div className="post-item-slug">{p.slug}.md</div>
                </button>
              ))}
            </div>
          </div>

          <div className="sidebar-section git-section">
            <div className="section-header">
              <span>🌿 Git 타임라인 (버전 관리)</span>
              <span className="git-count">{snapshots.length} commits</span>
            </div>

            {/* Git Remote Link & Sync Box */}
            <div className="git-remote-card">
              <div className="git-remote-top">
                <span className="git-remote-label">
                  🔗 원격 저장소 ({gitRemote.branch})
                </span>
                <button
                  className="btn-mini"
                  onClick={() => setShowRemoteInput((prev) => !prev)}
                >
                  {gitRemote.remote_url ? "주소 변경" : "깃 링크 연결"}
                </button>
              </div>
              <div className="git-remote-url" title={gitRemote.remote_url ?? ""}>
                {gitRemote.remote_url
                  ? gitRemote.remote_url
                  : "연결된 원격 저장소 없음 (로컬 전용)"}
              </div>

              {showRemoteInput && (
                <div className="git-remote-form">
                  <input
                    type="text"
                    placeholder="https://github.com/아이디/저장소.git"
                    value={remoteUrlInput}
                    onChange={(e) => setRemoteUrlInput(e.target.value)}
                  />
                  <input
                    type="password"
                    placeholder="(선택) GitHub 토큰 ghp_... (SSH/키체인 사용 시 생략)"
                    value={remoteTokenInput}
                    onChange={(e) => setRemoteTokenInput(e.target.value)}
                  />
                  <button className="btn-save-remote" onClick={handleSaveGitRemote}>
                    원격 주소 저장
                  </button>
                </div>
              )}

              {gitRemote.remote_url && (
                <div className="git-sync-btns">
                  <button disabled={isBusy} onClick={handlePushRemote}>
                    ⬆️ 원격 Push (백업)
                  </button>
                  <button disabled={isBusy} onClick={handlePullRemote}>
                    ⬇️ 원격 Pull (가져오기)
                  </button>
                </div>
              )}
            </div>

            <div className="git-commit-box">
              <input
                type="text"
                placeholder="버전 메모 (예: 사진 보정 완료)"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateSnapshot()}
              />
              <button className="btn-git-commit" onClick={handleCreateSnapshot}>
                📌 현재 버전 스냅샷 저장
              </button>
            </div>

            <div className="snapshot-list">
              {snapshots.map((snap) => (
                <div key={snap.id} className="snapshot-card">
                  <div className="snapshot-top">
                    <span className="snapshot-hash">{snap.short_id}</span>
                    <span className="snapshot-time">
                      {new Date(snap.timestamp_iso).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="snapshot-msg">{snap.message}</div>
                  <div className="snapshot-actions">
                    <button onClick={() => handleViewDiff(snap)}>🔍 변경점(Diff)</button>
                    <button onClick={() => handleRollbackSnapshot(snap)}>
                      ⏪ 이 버전으로 복원
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* CENTER PANE: Dual Editor (Visual Mode / Markdown Code Mode / Split Mode / Tistory Preview) */}
        <main className="center-editor-area">
          {viewMode === "split" && (
            <div className="split-container">
              {/* Left side of split: Visual Rich Editor OR Markdown Code Editor */}
              <div className="split-pane">
                <div className="pane-toolbar">
                  <span className="pane-title">
                    ✍️ 비주얼 블록 에디터 (드래그/클릭으로 글자 크기·사진 편집)
                  </span>
                  <div className="add-block-bar">
                    <button
                      onClick={() =>
                        addBlock({ type: "heading", level: 2, text: "새 소제목을 입력하세요" })
                      }
                    >
                      + 소제목(H2)
                    </button>
                    <button
                      onClick={() =>
                        addBlock({
                          type: "paragraph",
                          text: "새 본문 단락을 입력하세요.",
                          font_size_px: 18,
                        })
                      }
                    >
                      + 글자크기 지정 단락
                    </button>
                    <button
                      onClick={() =>
                        addBlock({ type: "quote", text: "강조하고 싶은 인용구를 입력하세요." })
                      }
                    >
                      + 인용구
                    </button>
                    <button
                      onClick={() =>
                        addBlock({
                          type: "code_block",
                          language: "rust",
                          code: 'println!("Hello Writer!");',
                        })
                      }
                    >
                      + 코드블록
                    </button>
                  </div>
                </div>
                <div className="visual-editor-scroll">
                  {renderVisualBlocksEditor()}
                </div>
              </div>

              {/* Right side of split: Markdown Code + Live Tistory Preview */}
              <div className="split-pane">
                <div className="pane-toolbar">
                  <span className="pane-title">
                    💻 마크다운 원문 (실시간 양방향 동기화) & 티스토리 미리보기
                  </span>
                </div>
                <div className="split-right-vertical">
                  <textarea
                    className="markdown-textarea compact"
                    value={markdownText}
                    onChange={(e) => syncFromMarkdown(e.target.value)}
                    placeholder="마크다운을 직접 입력하면 좌측 비주얼 블록과 실시간 동기화됩니다..."
                  />
                  <div className="tistory-live-preview-wrapper">
                    <div className="preview-sticky-label">
                      티스토리 인라인 스타일 렌더링 미리보기
                    </div>
                    <div
                      className="tistory-preview-canvas"
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {viewMode === "visual" && (
            <div className="single-pane">
              <div className="pane-toolbar">
                <span className="pane-title">
                  ✍️ 비주얼 에디터 모드 — 마크다운 문법 없이 타이핑 후 글자 크기와 사진을 바로 조정하세요
                </span>
                <div className="add-block-bar">
                  <button
                    onClick={() =>
                      addBlock({ type: "heading", level: 1, text: "새 대제목(H1)" })
                    }
                  >
                    + 제목 H1
                  </button>
                  <button
                    onClick={() =>
                      addBlock({ type: "heading", level: 2, text: "새 소제목(H2)" })
                    }
                  >
                    + 소제목 H2
                  </button>
                  <button
                    onClick={() =>
                      addBlock({ type: "paragraph", text: "내용을 입력하세요." })
                    }
                  >
                    + 일반 단락
                  </button>
                  <button
                    onClick={() =>
                      addBlock({
                        type: "paragraph",
                        text: "크게 강조할 문단입니다.",
                        font_size_px: 22,
                      })
                    }
                  >
                    + 큰 글씨 단락(22px)
                  </button>
                  <button
                    onClick={() => addBlock({ type: "quote", text: "인용구 텍스트" })}
                  >
                    + 인용구
                  </button>
                  <button
                    onClick={() =>
                      addBlock({
                        type: "code_block",
                        language: "rust",
                        code: "// 코드를 입력하세요",
                      })
                    }
                  >
                    + 코드블록
                  </button>
                  <button onClick={() => addBlock({ type: "divider" })}>+ 구분선</button>
                </div>
              </div>
              <div className="visual-editor-scroll wide">{renderVisualBlocksEditor()}</div>
            </div>
          )}

          {viewMode === "code" && (
            <div className="single-pane">
              <div className="pane-toolbar">
                <span className="pane-title">
                  💻 마크다운 코드 에디터 모드 (숙련자용 원문 제어)
                </span>
                <span className="pane-hint">
                  <code>{"<!-- writer:size=20 -->"}</code> 또는 표준 마크다운 문법이 비주얼 에디터와 100% 호환됩니다.
                </span>
              </div>
              <textarea
                className="markdown-textarea full"
                value={markdownText}
                onChange={(e) => syncFromMarkdown(e.target.value)}
              />
            </div>
          )}

          {viewMode === "tistory" && (
            <div className="split-container">
              <div className="split-pane">
                <div className="pane-toolbar">
                  <span className="pane-title">
                    👀 티스토리 붙여넣기 실제 결과 미리보기
                  </span>
                </div>
                <div className="visual-editor-scroll">
                  <div
                    className="tistory-preview-canvas"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              </div>
              <div className="split-pane">
                <div className="pane-toolbar">
                  <span className="pane-title">
                    🔍 컴파일된 티스토리용 인라인 CSS HTML 원문
                  </span>
                  <button className="btn-mini" onClick={handleCopyTistoryHtml}>
                    HTML 클립보드 복사
                  </button>
                </div>
                <textarea className="markdown-textarea full" readOnly value={copyHtml} />
              </div>
            </div>
          )}
        </main>

        {/* RIGHT SIDEBAR: iPhone Image Studio & Processed Image Tray */}
        <aside className="right-sidebar">
          <div className="right-tabs">
            <button
              className={rightTab === "tray" ? "right-tab active" : "right-tab"}
              onClick={() => setRightTab("tray")}
            >
              🖼️ 가공 완료 사진 트레이 ({assets.length})
            </button>
            <button
              className={rightTab === "studio" ? "right-tab active" : "right-tab"}
              onClick={() => setRightTab("studio")}
            >
              🎞️ 아이폰 사진 필터·변환 스튜디오
            </button>
          </div>

          {/* Upload Dropzone (Always accessible) */}
          <div
            className="photo-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFileUpload(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".heic,.heif,image/*"
              style={{ display: "none" }}
              onChange={(e) => handleFileUpload(e.target.files)}
            />
            <div className="dropzone-title">
              📸 아이폰 사진(HEIC/JPG/PNG) 추가 또는 드래그
            </div>
            <div className="dropzone-sub">
              자동 GPS 위치 삭제 · EXIF 추출 · 필터 · WebP 변환
            </div>
          </div>

          {rightTab === "tray" ? (
            <div className="tray-container">
              <div className="tray-guide">
                <strong>티스토리 사진 넣기 워크플로우:</strong>
                <p>
                  1) 상단 <b>[티스토리용 서식 전체 복사]</b> 후 티스토리에 <code>Cmd+V</code>
                  <br />
                  2) 아래 트레이에서 가공된 사진을 <b>[원클릭 이미지 복사]</b> 또는{" "}
                  <b>드래그</b>하여 티스토리 사진 자리에 붙여넣기!
                </p>
              </div>

              <div className="tray-list">
                {assets.map((asset, idx) => (
                  <div
                    key={asset.asset_id}
                    className={
                      selectedAssetId === asset.asset_id
                        ? "tray-card selected"
                        : "tray-card"
                    }
                    draggable
                    onClick={() => handleSelectAsset(asset, false)}
                  >
                    <div className="tray-card-header">
                      <span className="tray-badge">트레이 #{idx + 1}</span>
                      <span className="format-pill">
                        {asset.recipe.output_format.toUpperCase()} · {asset.width}×{asset.height}
                      </span>
                      {asset.gps_removed_verified && (
                        <span className="privacy-pill" title="GPS 위치 메타데이터 0바이트 검증됨">
                          🛡️ GPS 삭제됨
                        </span>
                      )}
                    </div>

                    <div className="tray-thumb-wrap">
                      <img src={asset.preview_data_url} alt={asset.original_filename} />
                    </div>

                    {asset.exif_summary && (
                      <div className="tray-exif">📷 {asset.exif_summary}</div>
                    )}

                    <div className="tray-size-info">
                      원본 {formatBytes(asset.original_size_bytes)} → 가공 후{" "}
                      <strong>{formatBytes(asset.processed_size_bytes)}</strong> (
                      {asset.recipe.filter} / {asset.recipe.frame})
                    </div>

                    <div className="tray-card-actions">
                      <button
                        className="btn-copy-img"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyTrayImage(asset);
                        }}
                      >
                        🖼️ 이미지 복사 (티스토리에 Cmd+V)
                      </button>
                      <div className="tray-sub-actions">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectAsset(asset, true);
                          }}
                        >
                          🎨 필터/포맷 편집
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInsertAssetIntoPost(asset);
                          }}
                        >
                          ➕ 본문에 삽입
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="studio-container">
              {selectedAsset && editingRecipe ? (
                <>
                  <div className="studio-preview-box">
                    <img
                      src={selectedAsset.preview_data_url}
                      alt={selectedAsset.original_filename}
                    />
                    <div className="studio-meta-bar">
                      <span>{selectedAsset.original_filename}</span>
                      {selectedAsset.gps_removed_verified && (
                        <span className="privacy-pill">🛡️ GPS 위치정보 완전 제거됨</span>
                      )}
                    </div>
                    {selectedAsset.exif_summary && (
                      <div className="studio-exif-line">
                        📷 추출된 EXIF: {selectedAsset.exif_summary}
                      </div>
                    )}
                  </div>

                  <div className="studio-controls">
                    <div className="control-group">
                      <label>1. 감성 필터 프리셋 (Filter)</label>
                      <div className="filter-grid">
                        {FILTER_LABELS.map((f) => (
                          <button
                            key={f.value}
                            className={
                              editingRecipe.filter === f.value
                                ? "filter-chip active"
                                : "filter-chip"
                            }
                            onClick={() =>
                              setEditingRecipe({ ...editingRecipe, filter: f.value })
                            }
                          >
                            <div className="chip-name">{f.label}</div>
                            <div className="chip-desc">{f.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="control-group">
                      <label>2. 밝기 / 대비 / 채도 미세 보정</label>
                      <div className="slider-row">
                        <span>밝기 ({editingRecipe.brightness})</span>
                        <input
                          type="range"
                          min={-60}
                          max={60}
                          value={editingRecipe.brightness}
                          onChange={(e) =>
                            setEditingRecipe({
                              ...editingRecipe,
                              brightness: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="slider-row">
                        <span>대비 ({editingRecipe.contrast})</span>
                        <input
                          type="range"
                          min={-60}
                          max={60}
                          value={editingRecipe.contrast}
                          onChange={(e) =>
                            setEditingRecipe({
                              ...editingRecipe,
                              contrast: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="slider-row">
                        <span>채도 ({editingRecipe.saturation})</span>
                        <input
                          type="range"
                          min={-100}
                          max={60}
                          value={editingRecipe.saturation}
                          onChange={(e) =>
                            setEditingRecipe({
                              ...editingRecipe,
                              saturation: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="control-group">
                      <label>3. 테두리 프레임 & 폴라로이드 효과</label>
                      <select
                        value={editingRecipe.frame}
                        onChange={(e) =>
                          setEditingRecipe({
                            ...editingRecipe,
                            frame: e.target.value as FrameStyle,
                          })
                        }
                      >
                        {FRAME_LABELS.map((fr) => (
                          <option key={fr.value} value={fr.value}>
                            {fr.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="control-group">
                      <label>4. 워터마크 / 폴라로이드 하단 스탬프 (영문/숫자)</label>
                      <input
                        type="text"
                        placeholder="예: SHOT ON IPHONE 15 PRO"
                        value={editingRecipe.watermark_text ?? ""}
                        onChange={(e) =>
                          setEditingRecipe({
                            ...editingRecipe,
                            watermark_text: e.target.value || null,
                          })
                        }
                      />
                    </div>

                    <div className="control-group">
                      <label>5. 출력 이미지 확장자 변환 & 최대 가로폭</label>
                      <div className="format-row">
                        <select
                          value={editingRecipe.output_format}
                          onChange={(e) =>
                            setEditingRecipe({
                              ...editingRecipe,
                              output_format: e.target.value as OutputImageFormat,
                            })
                          }
                        >
                          <option value="webp">WebP (블로그 최적화·권장)</option>
                          <option value="jpeg">JPEG (.jpg 호환성 우선)</option>
                          <option value="png">PNG (.png 무손실)</option>
                        </select>
                        <select
                          value={editingRecipe.max_width}
                          onChange={(e) =>
                            setEditingRecipe({
                              ...editingRecipe,
                              max_width: Number(e.target.value),
                            })
                          }
                        >
                          <option value={800}>최대 800px</option>
                          <option value={1080}>최대 1080px</option>
                          <option value={1280}>최대 1280px</option>
                          <option value={1600}>최대 1600px</option>
                        </select>
                      </div>
                    </div>

                    <div className="control-group">
                      <label>6. 티스토리 사진 하단 설명 캡션</label>
                      <input
                        type="text"
                        placeholder="사진 하단에 들어갈 부연 설명..."
                        value={editingCaption}
                        onChange={(e) => setEditingCaption(e.target.value)}
                      />
                    </div>

                    <button
                      className="btn-apply-recipe"
                      disabled={isBusy}
                      onClick={handleApplyImageRecipe}
                    >
                      {isBusy
                        ? "Rust 엔진 렌더링 중..."
                        : "✨ 필터·프레임·확장자 변환 적용하기"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty-studio">사진을 먼저 선택하거나 업로드해 주세요.</div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Git Diff Viewer Modal */}
      {diffModal && (
        <div className="modal-backdrop" onClick={() => setDiffModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <strong>
                  🔍 스냅샷 [{diffModal.snapshot.short_id}] 대비 변경점 (Git Diff)
                </strong>
                <div className="modal-sub">{diffModal.snapshot.message}</div>
              </div>
              <button className="btn-close" onClick={() => setDiffModal(null)}>
                ✕
              </button>
            </div>
            <pre className="diff-pre">{diffModal.diff}</pre>
            <div className="modal-footer">
              <button
                className="btn-rollback"
                onClick={() => handleRollbackSnapshot(diffModal.snapshot)}
              >
                ⏪ 이 스냅샷 버전으로 워크스페이스 복원하기
              </button>
              <button className="btn-secondary" onClick={() => setDiffModal(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && <div className="toast-banner">{toast}</div>}
    </div>
  );

  function renderVisualBlocksEditor() {
    return (
      <div className="visual-blocks-list">
        {visualBlocks.map((block, idx) => (
          <div key={idx} className="visual-block-card">
            <div className="block-card-toolbar">
              <span className="block-type-tag">{block.type.toUpperCase()}</span>

              {block.type === "heading" && (
                <select
                  value={block.level}
                  onChange={(e) =>
                    updateBlockAt(idx, {
                      ...block,
                      level: Number(e.target.value),
                    })
                  }
                >
                  <option value={1}>H1 대제목 ({preset.h1_size_px}px)</option>
                  <option value={2}>H2 소제목 ({preset.h2_size_px}px)</option>
                  <option value={3}>H3 소항목 ({preset.h3_size_px}px)</option>
                  <option value={4}>H4 작은제목 ({preset.h4_size_px}px)</option>
                </select>
              )}

              {block.type === "paragraph" && (
                <select
                  value={block.font_size_px ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateBlockAt(idx, {
                      ...block,
                      font_size_px: val ? Number(val) : undefined,
                    });
                  }}
                >
                  <option value="">기본 글자 크기 ({preset.body_font_size_px}px)</option>
                  <option value="14">작게 (14px)</option>
                  <option value="16">보통 (16px)</option>
                  <option value="18">조금 크게 (18px)</option>
                  <option value="20">크게 강조 (20px)</option>
                  <option value="24">아주 크게 (24px)</option>
                  <option value="28">배너급 크기 (28px)</option>
                </select>
              )}

              {block.type === "code_block" && (
                <select
                  value={block.language}
                  onChange={(e) =>
                    updateBlockAt(idx, { ...block, language: e.target.value })
                  }
                >
                  <option value="rust">Rust</option>
                  <option value="typescript">TypeScript</option>
                  <option value="javascript">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="bash">Bash / Shell</option>
                  <option value="json">JSON</option>
                  <option value="sql">SQL</option>
                </select>
              )}

              <div className="block-order-btns">
                <button onClick={() => moveBlock(idx, -1)} title="위로 이동">
                  ↑
                </button>
                <button onClick={() => moveBlock(idx, 1)} title="아래로 이동">
                  ↓
                </button>
                <button
                  className="btn-del"
                  onClick={() => removeBlockAt(idx)}
                  title="블록 삭제"
                >
                  ✕
                </button>
              </div>
            </div>

            {block.type === "heading" && (
              <input
                className={`visual-heading-input h${block.level}`}
                style={{
                  fontSize:
                    block.level === 1
                      ? preset.h1_size_px
                      : block.level === 2
                      ? preset.h2_size_px
                      : preset.h3_size_px,
                }}
                value={block.text}
                onChange={(e) =>
                  updateBlockAt(idx, { ...block, text: e.target.value })
                }
              />
            )}

            {block.type === "paragraph" && (
              <textarea
                className="visual-paragraph-input"
                style={{
                  fontSize: `${block.font_size_px ?? preset.body_font_size_px}px`,
                  lineHeight: preset.line_height,
                }}
                rows={Math.max(2, block.text.split("\n").length)}
                value={block.text}
                onChange={(e) =>
                  updateBlockAt(idx, { ...block, text: e.target.value })
                }
              />
            )}

            {block.type === "quote" && (
              <textarea
                className="visual-quote-input"
                rows={2}
                value={block.text}
                onChange={(e) =>
                  updateBlockAt(idx, { ...block, text: e.target.value })
                }
              />
            )}

            {block.type === "code_block" && (
              <textarea
                className="visual-code-input"
                rows={Math.max(3, block.code.split("\n").length)}
                value={block.code}
                onChange={(e) =>
                  updateBlockAt(idx, { ...block, code: e.target.value })
                }
              />
            )}

            {block.type === "bullet_list" && (
              <textarea
                className="visual-paragraph-input"
                rows={Math.max(2, block.items.length)}
                value={block.items.join("\n")}
                onChange={(e) =>
                  updateBlockAt(idx, {
                    ...block,
                    items: e.target.value.split("\n"),
                  })
                }
              />
            )}

            {block.type === "image" && (
              <div className="visual-image-block">
                {(() => {
                  const matched = assets.find(
                    (a) => a.asset_id === block.asset_id || a.dist_rel_path === block.src
                  );
                  return (
                    <>
                      {matched ? (
                        <img
                          src={matched.preview_data_url}
                          alt={block.alt}
                          className="visual-img-preview"
                        />
                      ) : (
                        <div className="visual-img-missing">{block.src}</div>
                      )}
                      <div className="visual-img-controls">
                        <div className="visual-img-row">
                          <label>EXIF 촬영 정보:</label>
                          <input
                            type="text"
                            value={block.exif_caption ?? ""}
                            placeholder="예: iPhone 15 Pro · 24mm · f/1.78"
                            onChange={(e) =>
                              updateBlockAt(idx, {
                                ...block,
                                exif_caption: e.target.value || undefined,
                              })
                            }
                          />
                        </div>
                        <div className="visual-img-row">
                          <label>사진 캡션 설명:</label>
                          <input
                            type="text"
                            value={block.custom_caption ?? ""}
                            placeholder="사진 하단 캡션을 입력하세요"
                            onChange={(e) =>
                              updateBlockAt(idx, {
                                ...block,
                                custom_caption: e.target.value || undefined,
                                alt: e.target.value || block.alt,
                              })
                            }
                          />
                        </div>
                        {matched && (
                          <button
                            className="btn-edit-in-studio"
                            onClick={() => handleSelectAsset(matched, true)}
                          >
                            🎞️ 우측 스튜디오에서 이 사진 필터/폴라로이드/확장자 변경하기
                          </button>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {block.type === "divider" && <hr className="visual-divider" />}
          </div>
        ))}
      </div>
    );
  }
}
