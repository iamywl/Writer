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

type EditorViewMode = "visual" | "code" | "split" | "tistory";
type LeftMenuTab = "posts" | "git" | "tray" | "studio" | "style";

const FILTER_LABELS: { value: FilterPreset; label: string; desc: string }[] = [
  { value: "original", label: "Original", desc: "원본 색감" },
  { value: "film_warm", label: "Film Warm", desc: "따스한 필름톤" },
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
  const [focusedBlockIdx, setFocusedBlockIdx] = useState<number>(0);

  const [assets, setAssets] = useState<ImageAssetRecord[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<ImageRecipe | null>(null);
  const [editingCaption, setEditingCaption] = useState<string>("");

  const [snapshots, setSnapshots] = useState<GitSnapshotInfo[]>([]);
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [commitMessage, setCommitMessage] = useState<string>("");
  const [diffModal, setDiffModal] = useState<{ snapshot: GitSnapshotInfo; diff: string } | null>(
    null
  );
  const [gitRemote, setGitRemote] = useState<GitRemoteStatus>({
    remote_url: null,
    branch: "main",
    has_changes: false,
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
  const [viewMode, setViewMode] = useState<EditorViewMode>("visual");

  // Unified Left Menu Bar & Drawer State
  const [activeMenu, setActiveMenu] = useState<LeftMenuTab | null>("posts");
  const [drawerWidth, setDrawerWidth] = useState<number>(310);
  const [splitPercent, setSplitPercent] = useState<number>(50);

  const [toast, setToast] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [newPostTitle, setNewPostTitle] = useState<string>("");
  const [showNewPostInput, setShowNewPostInput] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const centerAreaRef = useRef<HTMLElement | null>(null);

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
          setHasChanges(boot.git_remote.has_changes);
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

  const toggleMenuTab = (tab: LeftMenuTab) => {
    setActiveMenu((prev) => (prev === tab ? null : tab));
  };

  const startResizeDrawer = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = drawerWidth;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(480, Math.max(220, startW + (ev.clientX - startX)));
      setDrawerWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startResizeSplit = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = centerAreaRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.min(75, Math.max(25, pct)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const selectedAsset = assets.find((a) => a.asset_id === selectedAssetId) ?? null;

  const handleSelectAsset = (asset: ImageAssetRecord, switchToStudio = false) => {
    setSelectedAssetId(asset.asset_id);
    setEditingRecipe({ ...asset.recipe });
    setEditingCaption(asset.custom_caption ?? "");
    if (switchToStudio) {
      setActiveMenu("studio");
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
      setHasChanges(res.has_changes);
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
      setHasChanges(res.has_changes);
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
      setHasChanges(res.has_changes);
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
      setHasChanges(res.has_changes);
    } catch (err: any) {
      showToastMessage(`저장 오류: ${err.message}`);
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
    if (visualBlocks.length <= 1) {
      syncFromVisualBlocks([{ type: "paragraph", text: "" }]);
      return;
    }
    const next = visualBlocks.filter((_, i) => i !== idx);
    syncFromVisualBlocks(next);
    setFocusedBlockIdx(Math.max(0, idx - 1));
  };

  const moveBlock = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= visualBlocks.length) return;
    const next = [...visualBlocks];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    syncFromVisualBlocks(next);
    setFocusedBlockIdx(target);
  };

  const insertBlockAfter = (idx: number, block: VisualBlock) => {
    const next = [...visualBlocks];
    next.splice(idx + 1, 0, block);
    syncFromVisualBlocks(next);
    setFocusedBlockIdx(idx + 1);
  };

  const addBlock = (block: VisualBlock) => {
    const insertIdx = Math.min(focusedBlockIdx, visualBlocks.length - 1);
    if (visualBlocks.length === 0) {
      syncFromVisualBlocks([block]);
      setFocusedBlockIdx(0);
    } else {
      insertBlockAfter(insertIdx, block);
    }
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
      setHasChanges(res.has_changes);
      handleSelectAsset(res.asset, true);
      showToastMessage(
        `📸 '${file.name}' 추가 완료! GPS 위치정보 삭제 및 ${res.asset.recipe.output_format.toUpperCase()} 변환됨`
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
      setHasChanges(res.has_changes);
      showToastMessage(
        `✨ 필터·프레임·확장자(${res.asset.recipe.output_format.toUpperCase()}) 적용 완료!`
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
    showToastMessage(`본문에 '${asset.original_filename}' 사진이 삽입되었습니다.`);
  };

  const handleCopyTistoryHtml = async () => {
    try {
      const res = await api.copyTistoryHtml(markdownText, preset);
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
        "📋 티스토리용 서식(인라인 HTML + 코드 색상) 복사 완료! 티스토리 에디터에 바로 붙여넣기(Cmd+V) 하세요."
      );
    } catch (err: any) {
      showToastMessage(`클립보드 복사 실패: ${err.message}`);
    }
  };

  const handleCopyTrayImage = async (asset: ImageAssetRecord) => {
    try {
      const res = await api.copyTrayImage(asset.asset_id);
      showToastMessage(
        `🖼️ 가공된 사진(${res.width}×${res.height})이 클립보드에 복사되었습니다! 티스토리 사진 자리에 바로 Cmd+V 하세요.`
      );
    } catch (err: any) {
      showToastMessage(`이미지 복사 실패: ${err.message}`);
    }
  };

  const handleCreateSnapshot = async () => {
    if (!hasChanges) {
      showToastMessage("변경된 내용이 없습니다. 글이나 사진을 수정한 뒤 스냅샷을 저장해 주세요.");
      return;
    }
    const msg = commitMessage.trim() || `버전 스냅샷 (${new Date().toLocaleTimeString()})`;
    try {
      const res = await api.createGitSnapshot(msg);
      setSnapshots(res.snapshots);
      setHasChanges(false);
      setCommitMessage("");
      showToastMessage(`📌 Git 스냅샷 저장 완료: [${res.snapshot.short_id}] ${res.snapshot.message}`);
    } catch (err: any) {
      showToastMessage(`${err.message}`);
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
      setHasChanges(boot.git_remote.has_changes);
      setPreviewHtml(boot.preview_html);
      setCopyHtml(boot.copy_html);
      setDiffModal(null);
      showToastMessage(`⏪ 스냅샷 [${snap.short_id}] 상태로 복원되었습니다!`);
    } catch (err: any) {
      showToastMessage(`${err.message}`);
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
      setHasChanges(boot.git_remote.has_changes);
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

  const focusedBlock = visualBlocks[focusedBlockIdx] ?? null;

  return (
    <div className="app-shell">
      {/* Hidden Global File Input for Photo Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".heic,.heif,image/*"
        style={{ display: "none" }}
        onChange={(e) => handleFileUpload(e.target.files)}
      />

      {/* Top Header Bar */}
      <header className="top-bar">
        <div className="brand-group">
          <div className="brand-logo">W</div>
          <div className="brand-text-wrap">
            <div className="brand-title">
              Writer <span className="rust-badge">Rust + Git</span>
            </div>
            <div className="workspace-path" title={workspacePath}>
              📁 {activePost ? `${activePost.title} (${activePost.slug}.md)` : workspacePath}
            </div>
          </div>
        </div>

        <div className="mode-switcher" role="tablist">
          <button
            className={viewMode === "visual" ? "mode-btn active" : "mode-btn"}
            onClick={() => setViewMode("visual")}
          >
            ✍️ 일반 편집
          </button>
          <button
            className={viewMode === "code" ? "mode-btn active" : "mode-btn"}
            onClick={() => setViewMode("code")}
          >
            💻 마크다운 편집
          </button>
          <button
            className={viewMode === "split" ? "mode-btn active" : "mode-btn"}
            onClick={() => setViewMode("split")}
          >
            📐 분할 보기
          </button>
          <button
            className={viewMode === "tistory" ? "mode-btn active" : "mode-btn"}
            onClick={() => setViewMode("tistory")}
          >
            👀 티스토리 미리보기
          </button>
        </div>

        <div className="top-actions">
          <button className="btn-primary-copy" onClick={handleCopyTistoryHtml}>
            📋 티스토리용 서식 복사 (Cmd+V)
          </button>
        </div>
      </header>

      {/* Main Body: Left Icon Menu Bar + Collapsible Left Drawer + Main Editor */}
      <div className="workspace-flex">
        {/* LEFT ICON ACTIVITY MENU BAR */}
        <nav className="left-activity-bar" aria-label="좌측 기능 메뉴바">
          <button
            className={activeMenu === "posts" ? "activity-btn active" : "activity-btn"}
            onClick={() => toggleMenuTab("posts")}
            title="내 블로그 글 목록"
          >
            <span className="activity-icon">📄</span>
            <span className="activity-label">글 목록</span>
          </button>

          <button
            className={activeMenu === "git" ? "activity-btn active" : "activity-btn"}
            onClick={() => toggleMenuTab("git")}
            title="Git 버전 스냅샷 & 원격 저장소 연결"
          >
            <span className="activity-icon">🌿</span>
            <span className="activity-label">커밋·Git</span>
            {hasChanges && <span className="activity-dot dirty" />}
          </button>

          <button
            className={activeMenu === "tray" ? "activity-btn active" : "activity-btn"}
            onClick={() => toggleMenuTab("tray")}
            title="가공 완료 사진 트레이 (티스토리 복사용)"
          >
            <span className="activity-icon">🖼️</span>
            <span className="activity-label">사진 트레이</span>
            <span className="activity-count">{assets.length}</span>
          </button>

          <button
            className={activeMenu === "studio" ? "activity-btn active" : "activity-btn"}
            onClick={() => toggleMenuTab("studio")}
            title="아이폰 사진 필터 · 폴라로이드 · 확장자 변환"
          >
            <span className="activity-icon">🎞️</span>
            <span className="activity-label">사진 편집</span>
          </button>

          <button
            className={activeMenu === "style" ? "activity-btn active" : "activity-btn"}
            onClick={() => toggleMenuTab("style")}
            title="티스토리 글자 크기 · 줄간격 · 코드 테마 설정"
          >
            <span className="activity-icon">🎨</span>
            <span className="activity-label">서식 설정</span>
          </button>
        </nav>

        {/* UNIFIED LEFT SIDEBAR DRAWER */}
        {activeMenu !== null && (
          <>
            <aside className="left-drawer" style={{ width: `${drawerWidth}px` }}>
              <div className="drawer-header">
                <span className="drawer-title">
                  {activeMenu === "posts" && "📄 내 블로그 글 목록"}
                  {activeMenu === "git" && "🌿 Git 커밋 & 버전 관리"}
                  {activeMenu === "tray" && `🖼️ 사진 트레이 (${assets.length})`}
                  {activeMenu === "studio" && "🎞️ 사진 필터 · 변환 스튜디오"}
                  {activeMenu === "style" && "🎨 티스토리 서식 설정"}
                </span>
                <button
                  className="drawer-close-btn"
                  onClick={() => setActiveMenu(null)}
                  title="패널 닫기"
                >
                  ✕
                </button>
              </div>

              {/* TAB 1: POSTS */}
              {activeMenu === "posts" && (
                <div className="drawer-body">
                  <div className="section-header">
                    <span>저장된 글 ({posts.length})</span>
                    <button
                      className="btn-mini"
                      onClick={() => setShowNewPostInput((prev) => !prev)}
                    >
                      + 새 글 작성
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
              )}

              {/* TAB 2: GIT COMMIT & TIMELINE */}
              {activeMenu === "git" && (
                <div className="drawer-body">
                  <div className="section-header">
                    <span>작업 상태</span>
                    <span className={hasChanges ? "git-status-dirty" : "git-status-clean"}>
                      {hasChanges ? "● 수정됨 (커밋 가능)" : "✓ 변경사항 없음"}
                    </span>
                  </div>

                  <div className="git-commit-box">
                    <input
                      type="text"
                      disabled={!hasChanges}
                      placeholder={
                        hasChanges
                          ? "커밋 메모 입력 (예: 사진 추가 및 초안 작성)"
                          : "수정된 내용이 없습니다"
                      }
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateSnapshot()}
                    />
                    <button
                      className={hasChanges ? "btn-git-commit" : "btn-git-commit disabled"}
                      disabled={!hasChanges}
                      onClick={handleCreateSnapshot}
                    >
                      {hasChanges
                        ? "📌 변경사항 커밋 (스냅샷 저장)"
                        : "✓ 변경사항 없음 (최신 상태)"}
                    </button>
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
                          placeholder="(선택) GitHub 토큰 ghp_..."
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
                          ⬆️ Push (백업)
                        </button>
                        <button disabled={isBusy} onClick={handlePullRemote}>
                          ⬇️ Pull (가져오기)
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="section-header" style={{ marginTop: "6px" }}>
                    <span>커밋 히스토리 ({snapshots.length})</span>
                  </div>

                  <div className="snapshot-list">
                    {snapshots.map((snap, idx) => {
                      const isCurrentHead = idx === 0 && !hasChanges;
                      return (
                        <div key={snap.id} className="snapshot-card">
                          <div className="snapshot-top">
                            <span className="snapshot-hash">{snap.short_id}</span>
                            {isCurrentHead && (
                              <span className="current-head-badge">현재 버전</span>
                            )}
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
                            <button onClick={() => handleViewDiff(snap)}>
                              🔍 변경점 비교
                            </button>
                            <button
                              disabled={isCurrentHead}
                              onClick={() => handleRollbackSnapshot(snap)}
                            >
                              {isCurrentHead ? "현재 적용됨" : "⏪ 이 버전으로 복원"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 3: PHOTO TRAY */}
              {activeMenu === "tray" && (
                <div className="drawer-body">
                  <div
                    className="photo-dropzone"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleFileUpload(e.dataTransfer.files);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <div className="dropzone-title">
                      📸 아이폰 사진(HEIC/JPG/PNG) 추가·드래그
                    </div>
                    <div className="dropzone-sub">
                      GPS 자동 삭제 · EXIF 추출 · 필터 · 확장자 변환
                    </div>
                  </div>

                  <div className="tray-guide">
                    <strong>티스토리 사진 넣기:</strong>
                    <p>
                      1) 상단 <b>[티스토리용 서식 복사]</b> 후 티스토리에 <code>Cmd+V</code>
                      <br />
                      2) 아래 카드에서 <b>[이미지 복사]</b> 클릭 후 사진 자리에 <code>Cmd+V</code>!
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
                          <span className="tray-badge">#{idx + 1}</span>
                          <span className="format-pill">
                            {asset.recipe.output_format.toUpperCase()} · {asset.width}×{asset.height}
                          </span>
                          {asset.gps_removed_verified && (
                            <span className="privacy-pill">🛡️ GPS 삭제됨</span>
                          )}
                        </div>

                        <div className="tray-thumb-wrap">
                          <img src={asset.preview_data_url} alt={asset.original_filename} />
                        </div>

                        {asset.exif_summary && (
                          <div className="tray-exif">📷 {asset.exif_summary}</div>
                        )}

                        <div className="tray-size-info">
                          {formatBytes(asset.original_size_bytes)} →{" "}
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
                              🎞️ 필터/확장자 편집
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInsertAssetIntoPost(asset);
                              }}
                            >
                              ➕ 본문에 넣기
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 4: PHOTO STUDIO */}
              {activeMenu === "studio" && (
                <div className="drawer-body">
                  <div
                    className="photo-dropzone"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleFileUpload(e.dataTransfer.files);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <div className="dropzone-title">
                      📸 새 아이폰 사진(HEIC/JPG/PNG) 불러오기
                    </div>
                  </div>

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
                            <span className="privacy-pill">🛡️ GPS 삭제됨</span>
                          )}
                        </div>
                        {selectedAsset.exif_summary && (
                          <div className="studio-exif-line">
                            📷 {selectedAsset.exif_summary}
                          </div>
                        )}
                      </div>

                      <div className="studio-controls">
                        <div className="control-group">
                          <label>1. 감성 필터 프리셋</label>
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
                          <label>2. 밝기 / 대비 / 채도 보정</label>
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
                          <label>3. 테두리 & 폴라로이드 프레임</label>
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
                          <label>4. 워터마크 / 하단 각인 (영문/숫자)</label>
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
                          <label>5. 이미지 확장자 변환 & 크기</label>
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
                              <option value="webp">WebP (고압축 권장)</option>
                              <option value="jpeg">JPEG (.jpg 호환)</option>
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
                              <option value={800}>800px</option>
                              <option value={1080}>1080px</option>
                              <option value={1280}>1280px</option>
                              <option value={1600}>1600px</option>
                            </select>
                          </div>
                        </div>

                        <div className="control-group">
                          <label>6. 사진 캡션 설명</label>
                          <input
                            type="text"
                            placeholder="사진 하단 설명 입력..."
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
                            ? "렌더링 중..."
                            : "✨ 필터·프레임·확장자 변환 적용"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="empty-studio">사진을 먼저 선택하거나 업로드해 주세요.</div>
                  )}
                </div>
              )}

              {/* TAB 5: TISTORY STYLE SETTINGS */}
              {activeMenu === "style" && (
                <div className="drawer-body">
                  <div className="studio-controls">
                    <div className="control-group">
                      <label>대제목 (H1) 글자 크기 (px)</label>
                      <input
                        type="number"
                        value={preset.h1_size_px}
                        min={20}
                        max={42}
                        onChange={(e) =>
                          handlePresetChange({
                            ...preset,
                            h1_size_px: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="control-group">
                      <label>중제목 (H2) 글자 크기 (px)</label>
                      <input
                        type="number"
                        value={preset.h2_size_px}
                        min={18}
                        max={34}
                        onChange={(e) =>
                          handlePresetChange({
                            ...preset,
                            h2_size_px: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="control-group">
                      <label>소제목 (H3) 글자 크기 (px)</label>
                      <input
                        type="number"
                        value={preset.h3_size_px}
                        min={15}
                        max={28}
                        onChange={(e) =>
                          handlePresetChange({
                            ...preset,
                            h3_size_px: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="control-group">
                      <label>본문 기본 글자 크기 (px)</label>
                      <input
                        type="number"
                        value={preset.body_font_size_px}
                        min={13}
                        max={24}
                        onChange={(e) =>
                          handlePresetChange({
                            ...preset,
                            body_font_size_px: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="control-group">
                      <label>본문 줄간격 (Line Height)</label>
                      <input
                        type="number"
                        step="0.05"
                        value={preset.line_height}
                        min={1.4}
                        max={2.4}
                        onChange={(e) =>
                          handlePresetChange({
                            ...preset,
                            line_height: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="control-group">
                      <label>강조 포인트 색상</label>
                      <input
                        type="color"
                        value={preset.accent_color}
                        onChange={(e) =>
                          handlePresetChange({ ...preset, accent_color: e.target.value })
                        }
                      />
                    </div>
                    <div className="control-group">
                      <label>코드 블록 구문 강조 테마</label>
                      <select
                        value={preset.code_theme}
                        onChange={(e) =>
                          handlePresetChange({ ...preset, code_theme: e.target.value })
                        }
                      >
                        <option value="base16-ocean.dark">Ocean Dark (다크)</option>
                        <option value="InspiredGitHub">GitHub Light (라이트)</option>
                        <option value="Solarized (dark)">Solarized Dark</option>
                        <option value="Solarized (light)">Solarized Light</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </aside>
            <div
              className="resizer-vertical"
              onMouseDown={startResizeDrawer}
              title="드래그하여 좌측 메뉴 패널 너비 조절"
            />
          </>
        )}

        {/* CENTER PANE: Full-Width Editor Area */}
        <main className="center-editor-area" ref={centerAreaRef}>
          {viewMode === "visual" && (
            <div className="single-pane">
              {renderVisualToolbar()}
              <div className="visual-editor-scroll wide">
                {renderVisualDocumentCanvas()}
              </div>
            </div>
          )}

          {viewMode === "code" && (
            <div className="single-pane">
              <div className="pane-toolbar">
                <span className="pane-title">💻 마크다운 직접 편집</span>
                <span className="pane-hint">
                  작성한 마크다운은 일반 편집 모드 및 티스토리 서식과 실시간 동기화됩니다.
                </span>
              </div>
              <textarea
                className="markdown-textarea full"
                value={markdownText}
                onChange={(e) => syncFromMarkdown(e.target.value)}
              />
            </div>
          )}

          {viewMode === "split" && (
            <div className="split-flex-container">
              <div
                className="split-pane"
                style={{ width: `${splitPercent}%`, flex: "none" }}
              >
                {renderVisualToolbar()}
                <div className="visual-editor-scroll">
                  {renderVisualDocumentCanvas()}
                </div>
              </div>

              <div
                className="resizer-vertical"
                onMouseDown={startResizeSplit}
                title="드래그하여 분할 화면 비율 조절"
              />

              <div className="split-pane" style={{ flex: 1 }}>
                <div className="pane-toolbar">
                  <span className="pane-title">💻 마크다운 원문 & 실시간 미리보기</span>
                </div>
                <div className="split-right-vertical">
                  <textarea
                    className="markdown-textarea compact"
                    value={markdownText}
                    onChange={(e) => syncFromMarkdown(e.target.value)}
                    placeholder="마크다운을 직접 입력하면 좌측 일반 에디터와 실시간 동기화됩니다..."
                  />
                  <div className="tistory-live-preview-wrapper">
                    <div className="preview-sticky-label">
                      티스토리 붙여넣기 미리보기
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

          {viewMode === "tistory" && (
            <div className="split-flex-container">
              <div
                className="split-pane"
                style={{ width: `${splitPercent}%`, flex: "none" }}
              >
                <div className="pane-toolbar">
                  <span className="pane-title">👀 티스토리 붙여넣기 실제 결과 미리보기</span>
                </div>
                <div className="visual-editor-scroll">
                  <div
                    className="tistory-preview-canvas"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              </div>

              <div
                className="resizer-vertical"
                onMouseDown={startResizeSplit}
                title="드래그하여 분할 화면 비율 조절"
              />

              <div className="split-pane" style={{ flex: 1 }}>
                <div className="pane-toolbar">
                  <span className="pane-title">🔍 티스토리용 인라인 CSS HTML 코드</span>
                  <button className="btn-mini" onClick={handleCopyTistoryHtml}>
                    HTML 복사
                  </button>
                </div>
                <textarea className="markdown-textarea full" readOnly value={copyHtml} />
              </div>
            </div>
          )}
        </main>
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
                ⏪ 이 스냅샷 버전으로 복원하기
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

  function renderVisualToolbar() {
    const currentType = focusedBlock?.type ?? "paragraph";
    const currentHeadingLevel =
      focusedBlock?.type === "heading" ? focusedBlock.level : 0;
    const currentFontSize =
      focusedBlock?.type === "paragraph"
        ? focusedBlock.font_size_px ?? preset.body_font_size_px
        : focusedBlock?.type === "heading"
        ? focusedBlock.level === 1
          ? preset.h1_size_px
          : focusedBlock.level === 2
          ? preset.h2_size_px
          : preset.h3_size_px
        : preset.body_font_size_px;

    const handleChangeBlockStyle = (val: string) => {
      if (!focusedBlock) return;
      const textContent =
        "text" in focusedBlock
          ? focusedBlock.text
          : focusedBlock.type === "code_block"
          ? focusedBlock.code
          : focusedBlock.type === "bullet_list"
          ? focusedBlock.items.join("\n")
          : "";

      if (val === "p") {
        updateBlockAt(focusedBlockIdx, {
          type: "paragraph",
          text: textContent,
        });
      } else if (val === "h1" || val === "h2" || val === "h3") {
        const lvl = Number(val.replace("h", ""));
        updateBlockAt(focusedBlockIdx, {
          type: "heading",
          level: lvl,
          text: textContent.replace(/\n/g, " "),
        });
      } else if (val === "quote") {
        updateBlockAt(focusedBlockIdx, {
          type: "quote",
          text: textContent,
        });
      } else if (val === "code") {
        updateBlockAt(focusedBlockIdx, {
          type: "code_block",
          language: "rust",
          code: textContent,
        });
      } else if (val === "list") {
        updateBlockAt(focusedBlockIdx, {
          type: "bullet_list",
          items: textContent.split("\n").filter(Boolean),
        });
      }
    };

    const handleFontSizeChange = (newSize: number) => {
      if (!focusedBlock) return;
      if (focusedBlock.type === "paragraph") {
        updateBlockAt(focusedBlockIdx, {
          ...focusedBlock,
          font_size_px: newSize === preset.body_font_size_px ? undefined : newSize,
        });
      } else if (focusedBlock.type === "heading") {
        updateBlockAt(focusedBlockIdx, {
          type: "paragraph",
          text: focusedBlock.text,
          font_size_px: newSize,
        });
      }
    };

    return (
      <div className="pane-toolbar rich-toolbar">
        <div className="toolbar-group">
          <label className="toolbar-label">스타일</label>
          <select
            className="toolbar-select"
            value={
              currentType === "heading"
                ? `h${currentHeadingLevel}`
                : currentType === "code_block"
                ? "code"
                : currentType === "bullet_list"
                ? "list"
                : currentType === "quote"
                ? "quote"
                : "p"
            }
            onChange={(e) => handleChangeBlockStyle(e.target.value)}
          >
            <option value="p">본문 단락</option>
            <option value="h1">대제목 1 ({preset.h1_size_px}px)</option>
            <option value="h2">중제목 2 ({preset.h2_size_px}px)</option>
            <option value="h3">소제목 3 ({preset.h3_size_px}px)</option>
            <option value="quote">인용구 블록</option>
            <option value="list">글머리 목록</option>
            <option value="code">코드 블록</option>
          </select>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <label className="toolbar-label">글자 크기</label>
          <button
            className="size-step-btn"
            onClick={() => handleFontSizeChange(Math.max(12, currentFontSize - 2))}
            title="글자 작게"
          >
            A-
          </button>
          <select
            className="toolbar-select size-select"
            value={currentFontSize}
            onChange={(e) => handleFontSizeChange(Number(e.target.value))}
          >
            {[13, 14, 15, 16, 18, 20, 22, 24, 28, 32].map((sz) => (
              <option key={sz} value={sz}>
                {sz}px {sz === preset.body_font_size_px ? "(기본)" : ""}
              </option>
            ))}
          </select>
          <button
            className="size-step-btn"
            onClick={() => handleFontSizeChange(Math.min(36, currentFontSize + 2))}
            title="글자 크게"
          >
            A+
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group add-block-bar">
          <button onClick={() => fileInputRef.current?.click()}>
            📸 사진 추가
          </button>
          <button
            onClick={() =>
              addBlock({ type: "heading", level: 2, text: "소제목을 입력하세요" })
            }
          >
            + 소제목
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
            + 코드
          </button>
          <button onClick={() => addBlock({ type: "divider" })}>+ 구분선</button>
        </div>
      </div>
    );
  }

  function renderVisualDocumentCanvas() {
    return (
      <div className="document-paper">
        {visualBlocks.map((block, idx) => {
          const isFocused = focusedBlockIdx === idx;
          return (
            <div
              key={idx}
              className={
                isFocused ? "doc-block-row focused" : "doc-block-row"
              }
              onClick={() => setFocusedBlockIdx(idx)}
            >
              <div className="doc-row-gutter">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveBlock(idx, -1);
                  }}
                  title="위로 이동"
                >
                  ↑
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveBlock(idx, 1);
                  }}
                  title="아래로 이동"
                >
                  ↓
                </button>
                <button
                  className="btn-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBlockAt(idx);
                  }}
                  title="삭제"
                >
                  ✕
                </button>
              </div>

              <div className="doc-row-content">
                {block.type === "heading" && (
                  <input
                    className={`doc-heading-input h${block.level}`}
                    style={{
                      fontSize:
                        block.level === 1
                          ? preset.h1_size_px
                          : block.level === 2
                          ? preset.h2_size_px
                          : preset.h3_size_px,
                    }}
                    placeholder="제목을 입력하세요..."
                    value={block.text}
                    onFocus={() => setFocusedBlockIdx(idx)}
                    onChange={(e) =>
                      updateBlockAt(idx, { ...block, text: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        insertBlockAfter(idx, { type: "paragraph", text: "" });
                      }
                    }}
                  />
                )}

                {block.type === "paragraph" && (
                  <textarea
                    className="doc-paragraph-input"
                    style={{
                      fontSize: `${block.font_size_px ?? preset.body_font_size_px}px`,
                      lineHeight: preset.line_height,
                    }}
                    placeholder="내용을 타이핑하세요... (상단 툴바에서 글자 크기를 바꿀 수 있습니다)"
                    rows={Math.max(1, block.text.split("\n").length)}
                    value={block.text}
                    onFocus={() => setFocusedBlockIdx(idx)}
                    onChange={(e) =>
                      updateBlockAt(idx, { ...block, text: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        insertBlockAfter(idx, {
                          type: "paragraph",
                          text: "",
                          font_size_px: block.font_size_px,
                        });
                      } else if (
                        e.key === "Backspace" &&
                        block.text === "" &&
                        visualBlocks.length > 1
                      ) {
                        e.preventDefault();
                        removeBlockAt(idx);
                      }
                    }}
                  />
                )}

                {block.type === "quote" && (
                  <textarea
                    className="doc-quote-input"
                    style={{
                      fontSize: `${preset.body_font_size_px}px`,
                      lineHeight: preset.line_height,
                      borderLeftColor: preset.accent_color,
                    }}
                    placeholder="강조할 인용구를 입력하세요..."
                    rows={Math.max(1, block.text.split("\n").length)}
                    value={block.text}
                    onFocus={() => setFocusedBlockIdx(idx)}
                    onChange={(e) =>
                      updateBlockAt(idx, { ...block, text: e.target.value })
                    }
                  />
                )}

                {block.type === "code_block" && (
                  <div className="doc-code-wrap">
                    <div className="doc-code-header">
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
                        <option value="bash">Shell</option>
                        <option value="json">JSON</option>
                        <option value="sql">SQL</option>
                      </select>
                    </div>
                    <textarea
                      className="visual-code-input"
                      rows={Math.max(3, block.code.split("\n").length)}
                      value={block.code}
                      onFocus={() => setFocusedBlockIdx(idx)}
                      onChange={(e) =>
                        updateBlockAt(idx, { ...block, code: e.target.value })
                      }
                    />
                  </div>
                )}

                {block.type === "bullet_list" && (
                  <textarea
                    className="doc-paragraph-input doc-list-input"
                    rows={Math.max(2, block.items.length)}
                    value={block.items.join("\n")}
                    placeholder="한 줄에 하나씩 목록을 입력하세요..."
                    onFocus={() => setFocusedBlockIdx(idx)}
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
                        (a) =>
                          a.asset_id === block.asset_id ||
                          a.dist_rel_path === block.src
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
                              <label>📷 촬영 정보:</label>
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
                              <label>💬 사진 설명:</label>
                              <input
                                type="text"
                                value={block.custom_caption ?? ""}
                                placeholder="사진 하단 설명 캡션..."
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
                                🎞️ 좌측 사진 편집 메뉴에서 필터·폴라로이드·확장자 변경하기
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
            </div>
          );
        })}

        <div
          className="doc-bottom-click-zone"
          onClick={() => addBlock({ type: "paragraph", text: "" })}
        >
          + 여기를 클릭해 이어서 글쓰기
        </div>
      </div>
    );
  }
}
