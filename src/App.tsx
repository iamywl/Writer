import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  Code2,
  Columns,
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  GitCommit,
  Image as ImageIcon,
  Link2,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  CiteEntry,
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

type EditorViewMode = "visual" | "code" | "split";
type LeftMenuTab = "posts" | "git" | "cite" | "tray" | "studio" | "style";

const FILTER_LABELS: { value: FilterPreset; label: string; desc: string }[] = [
  { value: "original", label: "Original", desc: "원본" },
  { value: "film_warm", label: "Portra 400", desc: "웜 필름" },
  { value: "vintage_fade", label: "Gold 200", desc: "매트 빈티지" },
  { value: "fuji_pro400h", label: "Pro 400H", desc: "파스텔 시안" },
  { value: "kodak_ektar100", label: "Ektar 100", desc: "선명한 풍경" },
  { value: "cool_cinema", label: "CineStill", desc: "시네마틱 쿨" },
  { value: "agfa_vista", label: "Vista 400", desc: "레트로 레드" },
  { value: "vivid_pop", label: "Velvia 50", desc: "고채도" },
  { value: "monochrome", label: "Tri-X 400", desc: "고대비 흑백" },
  { value: "ilford_hp5", label: "Ilford HP5", desc: "부드러운 흑백" },
];

const FRAME_LABELS: { value: FrameStyle; label: string }[] = [
  { value: "none", label: "프레임 없음" },
  { value: "polaroid", label: "폴라로이드 프레임 (하단 각인)" },
  { value: "minimal_white", label: "미니멀 화이트 여백" },
  { value: "rounded_shadow", label: "라운드 코너 + 배경" },
];

function AutoResizeTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value, props.style?.fontSize]);

  return (
    <textarea
      {...props}
      ref={ref}
      rows={1}
      style={{ ...props.style, overflow: "hidden" }}
      onInput={(e) => {
        const el = e.currentTarget;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
        props.onInput?.(e);
      }}
    />
  );
}

export function App() {
  const isCopyCompanionWindow =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("window") === "copy";

  if (isCopyCompanionWindow) {
    return <CopyCompanionWindow />;
  }

  return <MainEditorWindow />;
}

// ============================================================================
// SEPARATE WINDOW: Dedicated Copy & Paste Companion Window (복붙 전용 윈도우)
// ============================================================================
function CopyCompanionWindow() {
  const [posts, setPosts] = useState<PostDocument[]>([]);
  const [activePost, setActivePost] = useState<PostDocument | null>(null);
  const [assets, setAssets] = useState<ImageAssetRecord[]>([]);
  const [preset, setPreset] = useState<TistoryStylePreset | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [copyHtml, setCopyHtml] = useState<string>("");
  const [tab, setTab] = useState<"workflow" | "preview" | "html">("workflow");
  const [copiedPost, setCopiedPost] = useState<boolean>(false);
  const [copiedAssetIds, setCopiedAssetIds] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((prev) => (prev === msg ? null : prev)), 2800);
  };

  const loadWorkspaceData = async (preferredSlug?: string) => {
    try {
      const boot = await api.getBootstrap();
      setPosts(boot.posts);
      setAssets(boot.assets);
      setPreset(boot.default_preset);

      const targetSlug =
        preferredSlug ||
        new URLSearchParams(window.location.search).get("slug") ||
        boot.active_post.slug;

      if (targetSlug && targetSlug !== boot.active_post.slug) {
        const loaded = await api.loadPost(targetSlug, boot.default_preset);
        setActivePost(loaded.post);
        setPreviewHtml(loaded.preview_html);
        setCopyHtml(loaded.copy_html);
      } else {
        setActivePost(boot.active_post);
        setPreviewHtml(boot.preview_html);
        setCopyHtml(boot.copy_html);
      }
    } catch (err: any) {
      notify(`불러오기 오류: ${err.message}`);
    }
  };

  useEffect(() => {
    loadWorkspaceData();
  }, []);

  const handleSelectSlug = async (slug: string) => {
    if (!preset) return;
    try {
      const loaded = await api.loadPost(slug, preset);
      setActivePost(loaded.post);
      setPreviewHtml(loaded.preview_html);
      setCopyHtml(loaded.copy_html);
      setCopiedPost(false);
    } catch (err: any) {
      notify(`글 전환 실패: ${err.message}`);
    }
  };

  const handleCopyBody = async () => {
    if (!activePost || !preset) return;
    try {
      const res = await api.copyTistoryHtml(activePost.markdown, preset);
      if (navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([res.html], { type: "text/html" }),
              "text/plain": new Blob([activePost.markdown], { type: "text/plain" }),
            }),
          ]);
        } catch {
          // arboard already copied
        }
      }
      setCopiedPost(true);
      notify("본문 인라인 서식이 클립보드에 복사되었습니다. 티스토리에 Cmd+V 하세요.");
    } catch (err: any) {
      notify(`복사 실패: ${err.message}`);
    }
  };

  const handleCopyImage = async (asset: ImageAssetRecord) => {
    try {
      await api.copyTrayImage(asset.asset_id);
      setCopiedAssetIds((prev) => ({ ...prev, [asset.asset_id]: true }));
      notify(`'${asset.original_filename}' 이미지가 클립보드에 복사되었습니다.`);
    } catch (err: any) {
      notify(`이미지 복사 실패: ${err.message}`);
    }
  };

  const formatBytes = (bytes: number) =>
    bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

  return (
    <div className="companion-shell">
      <header className="companion-header">
        <div className="companion-title-row">
          <div className="companion-title-group">
            <span className="companion-badge">COPY WINDOW</span>
            <h1>블로그 복붙 도우미</h1>
          </div>
          <button
            className="icon-btn"
            onClick={() => loadWorkspaceData(activePost?.slug)}
            title="에디터 최신 내용 새로고침"
          >
            <RefreshCw size={14} strokeWidth={1.7} />
            <span>새로고침</span>
          </button>
        </div>

        <div className="companion-post-bar">
          <select
            className="companion-select"
            value={activePost?.slug ?? ""}
            onChange={(e) => handleSelectSlug(e.target.value)}
          >
            {posts.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title} ({p.slug}.md)
              </option>
            ))}
          </select>

          <div className="companion-tabs">
            <button
              className={tab === "workflow" ? "comp-tab active" : "comp-tab"}
              onClick={() => setTab("workflow")}
            >
              복붙 단계
            </button>
            <button
              className={tab === "preview" ? "comp-tab active" : "comp-tab"}
              onClick={() => setTab("preview")}
            >
              미리보기
            </button>
            <button
              className={tab === "html" ? "comp-tab active" : "comp-tab"}
              onClick={() => setTab("html")}
            >
              HTML 코드
            </button>
          </div>
        </div>
      </header>

      <main className="companion-body">
        {tab === "workflow" && (
          <div className="companion-workflow">
            <section className="comp-step-card">
              <div className="comp-step-head">
                <span className="step-num">STEP 1</span>
                <span className="step-title">본문 서식 전체 복사</span>
              </div>
              <p className="step-desc">
                제목 크기, 본문 줄간격, 인용구, 코드 하이라이팅이 모두 인라인 스타일로 복사됩니다.
              </p>
              <button
                className={copiedPost ? "btn-comp-primary copied" : "btn-comp-primary"}
                onClick={handleCopyBody}
              >
                {copiedPost ? (
                  <>
                    <Check size={15} strokeWidth={2} />
                    <span>본문 서식 복사 완료 (다시 복사하려면 클릭)</span>
                  </>
                ) : (
                  <>
                    <Copy size={15} strokeWidth={1.7} />
                    <span>본문 서식 전체 복사 (Cmd+V용)</span>
                  </>
                )}
              </button>
            </section>

            <section className="comp-step-card">
              <div className="comp-step-head">
                <span className="step-num">STEP 2</span>
                <span className="step-title">
                  가공 완료 사진 순서대로 복사 ({assets.length})
                </span>
              </div>
              <p className="step-desc">
                본문 붙여넣기 후 각 사진 위치에 아래 이미지를 순서대로 복사해 붙여넣으세요.
              </p>

              <div className="comp-photo-list">
                {assets.map((asset, idx) => {
                  const isDone = !!copiedAssetIds[asset.asset_id];
                  return (
                    <div
                      key={asset.asset_id}
                      className={isDone ? "comp-photo-row done" : "comp-photo-row"}
                    >
                      <img
                        src={asset.preview_data_url}
                        alt={asset.original_filename}
                        className="comp-photo-thumb"
                      />
                      <div className="comp-photo-meta">
                        <div className="comp-photo-top">
                          <span className="comp-photo-idx">사진 #{idx + 1}</span>
                          <span className="comp-photo-fmt">
                            {asset.recipe.output_format.toUpperCase()} · {asset.width}×{asset.height}
                          </span>
                          <span className="comp-photo-size">
                            {formatBytes(asset.processed_size_bytes)}
                          </span>
                        </div>
                        {asset.exif_summary && (
                          <div className="comp-photo-exif">{asset.exif_summary}</div>
                        )}
                      </div>
                      <button
                        className={isDone ? "btn-comp-img done" : "btn-comp-img"}
                        onClick={() => handleCopyImage(asset)}
                      >
                        {isDone ? (
                          <>
                            <Check size={14} strokeWidth={2} />
                            <span>복사됨</span>
                          </>
                        ) : (
                          <>
                            <Copy size={14} strokeWidth={1.7} />
                            <span>이미지 복사</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {tab === "preview" && (
          <div className="companion-preview-box">
            <div
              className="tistory-preview-canvas"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        )}

        {tab === "html" && (
          <div className="companion-html-box">
            <textarea className="markdown-textarea full" readOnly value={copyHtml} />
          </div>
        )}
      </main>

      {toast && <div className="toast-banner">{toast}</div>}
    </div>
  );
}

// ============================================================================
// MAIN WINDOW: Clean Editorial Workspace
// ============================================================================
function MainEditorWindow() {
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

  const [cites, setCites] = useState<CiteEntry[]>([]);
  const [bibtexInput, setBibtexInput] = useState<string>("");
  const [citeForm, setCiteForm] = useState<CiteEntry>({
    key: "",
    authors: "",
    title: "",
    year: "",
    venue: "",
    url: "",
  });

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
    name: "Editorial Clean",
    font_family:
      "'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
    body_font_size_px: 16,
    line_height: 1.85,
    h1_size_px: 28,
    h2_size_px: 23,
    h3_size_px: 19,
    h4_size_px: 17,
    accent_color: "#18181b",
    quote_bg_color: "#fafafa",
    code_theme: "base16-ocean.dark",
  });

  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [viewMode, setViewMode] = useState<EditorViewMode>(() => {
    const m = new URLSearchParams(window.location.search).get("mode");
    return m === "code" || m === "split" ? m : "visual";
  });

  const [activeMenu, setActiveMenu] = useState<LeftMenuTab | null>(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as LeftMenuTab | null;
    return t || "posts";
  });
  const [drawerWidth, setDrawerWidth] = useState<number>(296);
  const [splitPercent, setSplitPercent] = useState<number>(50);

  const [toast, setToast] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [newPostTitle, setNewPostTitle] = useState<string>("");
  const [showNewPostInput, setShowNewPostInput] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const centerAreaRef = useRef<HTMLElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const saveSeqRef = useRef<number>(0);

  const showToastMessage = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3200);
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
        setCites(boot.cites ?? []);
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
      const next = Math.min(460, Math.max(220, startW + (ev.clientX - startX)));
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
      setHasChanges(res.has_changes);
      setNewPostTitle("");
      setShowNewPostInput(false);
      showToastMessage(`새 글 '${res.post.title}' 생성 완료`);
    } catch (err: any) {
      showToastMessage(`새 글 생성 실패: ${err.message}`);
    }
  };

  const syncFromMarkdown = (newMd: string, customPreset = preset) => {
    setMarkdownText(newMd);
    if (!activePost) return;
    const slug = activePost.slug;
    const seq = ++saveSeqRef.current;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await api.saveMarkdown(slug, newMd, customPreset);
        if (seq !== saveSeqRef.current) return;
        setActivePost(res.post);
        setPosts(res.posts);
        setVisualBlocks(res.post.blocks);
        setPreviewHtml(res.preview_html);
        setHasChanges(res.has_changes);
      } catch (err: any) {
        showToastMessage(`동기화 오류: ${err.message}`);
      }
    }, 250);
  };

  const syncFromVisualBlocks = (newBlocks: VisualBlock[], customPreset = preset) => {
    setVisualBlocks(newBlocks);
    if (!activePost) return;
    const slug = activePost.slug;
    const seq = ++saveSeqRef.current;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await api.saveVisualBlocks(slug, newBlocks, customPreset);
        if (seq !== saveSeqRef.current) return;
        setActivePost(res.post);
        setPosts(res.posts);
        setMarkdownText(res.post.markdown);
        setPreviewHtml(res.preview_html);
        setHasChanges(res.has_changes);
      } catch (err: any) {
        showToastMessage(`저장 오류: ${err.message}`);
      }
    }, 250);
  };

  const handlePresetChange = (updated: TistoryStylePreset) => {
    setPreset(updated);
    if (activePost) {
      syncFromMarkdown(markdownText, updated);
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

  const handleFileUpload = async (
    files: FileList | File[] | null,
    insertIntoPost = false
  ) => {
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
      const fname = file.name || `clipboard_${Date.now()}.png`;
      const res = await api.uploadImage(fname, base64Data);
      setAssets(res.assets);
      setHasChanges(res.has_changes);
      handleSelectAsset(res.asset, !insertIntoPost);
      if (insertIntoPost) {
        handleInsertAssetIntoPost(res.asset);
        showToastMessage(
          `클립보드 이미지가 본문에 삽입되었습니다 (${res.asset.recipe.output_format.toUpperCase()} 변환 완료)`
        );
      } else {
        showToastMessage(
          `'${fname}' 추가 및 GPS 메타데이터 제거 완료 (${res.asset.recipe.output_format.toUpperCase()})`
        );
      }
    } catch (err: any) {
      showToastMessage(`이미지 처리 실패: ${err.message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleEditorPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleFileUpload([file], true);
          return;
        }
      }
    }
  };

  const handleSaveCite = async () => {
    if (!citeForm.key.trim() || !citeForm.title.trim()) {
      showToastMessage("인용 키(key)와 제목은 필수입니다.");
      return;
    }
    try {
      const res = await api.upsertCite(citeForm, markdownText, preset);
      setCites(res.cites);
      setPreviewHtml(res.preview_html);
      setHasChanges(res.has_changes);
      setCiteForm({ key: "", authors: "", title: "", year: "", venue: "", url: "" });
      showToastMessage(`참고문헌 [@${citeForm.key.trim()}] 저장 완료`);
    } catch (err: any) {
      showToastMessage(`참고문헌 저장 실패: ${err.message}`);
    }
  };

  const handleDeleteCite = async (key: string) => {
    try {
      const res = await api.deleteCite(key, markdownText, preset);
      setCites(res.cites);
      setPreviewHtml(res.preview_html);
      setHasChanges(res.has_changes);
      showToastMessage(`참고문헌 [@${key}] 삭제됨`);
    } catch (err: any) {
      showToastMessage(`삭제 실패: ${err.message}`);
    }
  };

  const handleImportBibtex = async () => {
    if (!bibtexInput.trim()) return;
    try {
      const res = await api.importBibtex(bibtexInput, markdownText, preset);
      setCites(res.cites);
      setPreviewHtml(res.preview_html);
      setHasChanges(res.has_changes);
      setBibtexInput("");
      showToastMessage("BibTeX 참고문헌 가져오기 완료");
    } catch (err: any) {
      showToastMessage(`BibTeX 파싱 실패: ${err.message}`);
    }
  };

  const handleInsertCiteIntoPost = (key: string) => {
    const token = `[@${key}]`;
    const target = visualBlocks[focusedBlockIdx];
    if (target && "text" in target) {
      const sep = target.text.endsWith(" ") || target.text === "" ? "" : " ";
      updateBlockAt(focusedBlockIdx, {
        ...target,
        text: `${target.text}${sep}${token}`,
      });
      showToastMessage(`현재 문단에 ${token} 인용이 삽입되었습니다.`);
    } else {
      addBlock({ type: "paragraph", text: token });
      showToastMessage(`새 문단에 ${token} 인용이 삽입되었습니다.`);
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
      setHasChanges(res.has_changes);
      showToastMessage(
        `필터·프레임·확장자(${res.asset.recipe.output_format.toUpperCase()}) 렌더링 완료`
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
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([res.html], { type: "text/html" }),
              "text/plain": new Blob([markdownText], { type: "text/plain" }),
            }),
          ]);
        } catch {
          // OS native arboard clipboard already succeeded
        }
      }
      showToastMessage("인라인 서식이 클립보드에 복사되었습니다. 블로그 에디터에 Cmd+V 하세요.");
    } catch (err: any) {
      showToastMessage(`클립보드 복사 실패: ${err.message}`);
    }
  };

  const handleCopyTrayImage = async (asset: ImageAssetRecord) => {
    try {
      const res = await api.copyTrayImage(asset.asset_id);
      showToastMessage(
        `가공된 사진(${res.width}×${res.height})이 클립보드에 복사되었습니다.`
      );
    } catch (err: any) {
      showToastMessage(`이미지 복사 실패: ${err.message}`);
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    try {
      const res = await api.deleteAsset(assetId);
      setAssets(res.assets);
      setHasChanges(res.has_changes);
      if (selectedAssetId === assetId) {
        if (res.assets.length > 0) {
          handleSelectAsset(res.assets[0], false);
        } else {
          setSelectedAssetId(null);
          setEditingRecipe(null);
        }
      }
      showToastMessage("사진이 보관함에서 삭제되었습니다.");
    } catch (err: any) {
      showToastMessage(`사진 삭제 실패: ${err.message}`);
    }
  };

  const handleOpenCopyWindow = async () => {
    try {
      await api.openCopyWindow(activePost?.slug);
    } catch (err: any) {
      showToastMessage(`복붙 창 열기 실패: ${err.message}`);
    }
  };

  const handleCreateSnapshot = async () => {
    if (!hasChanges) {
      showToastMessage("변경된 내용이 없습니다.");
      return;
    }
    const msg = commitMessage.trim() || `버전 스냅샷 (${new Date().toLocaleTimeString()})`;
    try {
      const res = await api.createGitSnapshot(msg);
      setSnapshots(res.snapshots);
      setHasChanges(false);
      setCommitMessage("");
      showToastMessage(`스냅샷 저장 완료: [${res.snapshot.short_id}] ${res.snapshot.message}`);
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
      setDiffModal(null);
      showToastMessage(`스냅샷 [${snap.short_id}] 상태로 복원되었습니다.`);
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
        showToastMessage(`원격 저장소 연결 완료: ${res.git_remote.remote_url}`);
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
      showToastMessage(res.message);
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
      showToastMessage("원격 저장소에서 최신 변경사항을 가져왔습니다.");
    } catch (err: any) {
      showToastMessage(`Pull 오류: ${err.message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const formatBytes = (bytes: number) =>
    bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

  const focusedBlock = visualBlocks[focusedBlockIdx] ?? null;

  return (
    <div className="app-shell">
      <input
        ref={fileInputRef}
        type="file"
        accept=".heic,.heif,image/*"
        style={{ display: "none" }}
        onChange={(e) => handleFileUpload(e.target.files)}
      />

      {/* Minimalist Editorial Top Bar */}
      <header className="top-bar">
        <div className="brand-group">
          <div className="brand-mark">W</div>
          <div className="brand-text-wrap">
            <span className="brand-title">Writer</span>
            <span className="brand-divider">/</span>
            <span className="workspace-path" title={workspacePath}>
              {activePost ? activePost.title : "Workspace"}
            </span>
          </div>
        </div>

        <div className="mode-switcher" role="tablist">
          <button
            className={viewMode === "visual" ? "mode-btn active" : "mode-btn"}
            onClick={() => setViewMode("visual")}
          >
            <PenLine size={13} strokeWidth={1.7} />
            <span>일반 편집</span>
          </button>
          <button
            className={viewMode === "code" ? "mode-btn active" : "mode-btn"}
            onClick={() => setViewMode("code")}
          >
            <Code2 size={13} strokeWidth={1.7} />
            <span>마크다운</span>
          </button>
          <button
            className={viewMode === "split" ? "mode-btn active" : "mode-btn"}
            onClick={() => setViewMode("split")}
          >
            <Columns size={13} strokeWidth={1.7} />
            <span>분할 보기</span>
          </button>
        </div>

        <div className="top-actions">
          <button className="btn-ghost" onClick={handleCopyTistoryHtml}>
            <Copy size={13} strokeWidth={1.7} />
            <span>본문 빠른 복사</span>
          </button>
          <button className="btn-primary-copy" onClick={handleOpenCopyWindow}>
            <ExternalLink size={13} strokeWidth={1.8} />
            <span>복붙 전용 창 열기</span>
          </button>
        </div>
      </header>

      <div className="workspace-flex">
        {/* LEFT ACTIVITY MENU BAR (Monochrome SVG Icons) */}
        <nav className="left-activity-bar" aria-label="좌측 기능 메뉴바">
          <button
            className={activeMenu === "posts" ? "activity-btn active" : "activity-btn"}
            onClick={() => toggleMenuTab("posts")}
            title="글 목록"
          >
            <FileText size={17} strokeWidth={1.6} />
            <span className="activity-label">글 목록</span>
          </button>

          <button
            className={activeMenu === "git" ? "activity-btn active" : "activity-btn"}
            onClick={() => toggleMenuTab("git")}
            title="Git 커밋 및 버전 히스토리"
          >
            <GitBranch size={17} strokeWidth={1.6} />
            <span className="activity-label">커밋·Git</span>
            {hasChanges && <span className="activity-dot dirty" />}
          </button>

          <button
            className={activeMenu === "cite" ? "activity-btn active" : "activity-btn"}
            onClick={() => toggleMenuTab("cite")}
            title="Overleaf 스타일 참고문헌(Cite) & BibTeX 관리"
          >
            <BookOpen size={17} strokeWidth={1.6} />
            <span className="activity-label">인용·Cite</span>
            {cites.length > 0 && <span className="activity-count">{cites.length}</span>}
          </button>

          <button
            className={activeMenu === "tray" ? "activity-btn active" : "activity-btn"}
            onClick={() => toggleMenuTab("tray")}
            title="사진 보관함 및 트레이"
          >
            <ImageIcon size={17} strokeWidth={1.6} />
            <span className="activity-label">사진함</span>
            {assets.length > 0 && <span className="activity-count">{assets.length}</span>}
          </button>

          <button
            className={activeMenu === "studio" ? "activity-btn active" : "activity-btn"}
            onClick={() => toggleMenuTab("studio")}
            title="사진 필터 · 폴라로이드 · 확장자 변환"
          >
            <Sliders size={17} strokeWidth={1.6} />
            <span className="activity-label">사진 편집</span>
          </button>

          <button
            className={activeMenu === "style" ? "activity-btn active" : "activity-btn"}
            onClick={() => toggleMenuTab("style")}
            title="블로그 서식 및 타이포그래피 설정"
          >
            <Type size={17} strokeWidth={1.6} />
            <span className="activity-label">서식 설정</span>
          </button>
        </nav>

        {/* UNIFIED LEFT SIDEBAR DRAWER */}
        {activeMenu !== null && (
          <>
            <aside className="left-drawer" style={{ width: `${drawerWidth}px` }}>
              <div className="drawer-header">
                <span className="drawer-title">
                  {activeMenu === "posts" && "문서 목록"}
                  {activeMenu === "git" && "버전 관리 (Git)"}
                  {activeMenu === "cite" && `참고문헌 · Cite (${cites.length})`}
                  {activeMenu === "tray" && `사진 보관함 (${assets.length})`}
                  {activeMenu === "studio" && "사진 현상 · 변환"}
                  {activeMenu === "style" && "서식 · 타이포그래피"}
                </span>
                <button
                  className="drawer-close-btn"
                  onClick={() => setActiveMenu(null)}
                  title="패널 접기"
                >
                  <X size={14} strokeWidth={1.7} />
                </button>
              </div>

              {/* TAB 1: POSTS */}
              {activeMenu === "posts" && (
                <div className="drawer-body">
                  <div className="section-header">
                    <span>전체 문서 ({posts.length})</span>
                    <button
                      className="btn-mini"
                      onClick={() => setShowNewPostInput((prev) => !prev)}
                    >
                      <Plus size={12} strokeWidth={1.8} />
                      <span>새 문서</span>
                    </button>
                  </div>
                  {showNewPostInput && (
                    <div className="new-post-box">
                      <input
                        type="text"
                        placeholder="새 글 제목..."
                        value={newPostTitle}
                        onChange={(e) => setNewPostTitle(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleCreatePost()}
                      />
                      <button onClick={handleCreatePost}>만들기</button>
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
                    <span>작업 트리 상태</span>
                    <span className={hasChanges ? "git-status-dirty" : "git-status-clean"}>
                      {hasChanges ? "수정됨" : "변경 없음"}
                    </span>
                  </div>

                  <div className="git-commit-box">
                    <input
                      type="text"
                      disabled={!hasChanges}
                      placeholder={
                        hasChanges ? "스냅샷 커밋 메시지 입력..." : "변경된 사항이 없습니다"
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
                      <GitCommit size={13} strokeWidth={1.8} />
                      <span>{hasChanges ? "변경사항 스냅샷 저장" : "최신 스냅샷 상태"}</span>
                    </button>
                  </div>

                  <div className="git-remote-card">
                    <div className="git-remote-top">
                      <span className="git-remote-label">
                        <Link2 size={12} strokeWidth={1.7} />
                        <span>원격 저장소 ({gitRemote.branch})</span>
                      </span>
                      <button
                        className="btn-mini"
                        onClick={() => setShowRemoteInput((prev) => !prev)}
                      >
                        {gitRemote.remote_url ? "변경" : "연결"}
                      </button>
                    </div>
                    <div className="git-remote-url" title={gitRemote.remote_url ?? ""}>
                      {gitRemote.remote_url
                        ? gitRemote.remote_url
                        : "연결된 원격 저장소 없음"}
                    </div>

                    {showRemoteInput && (
                      <div className="git-remote-form">
                        <input
                          type="text"
                          placeholder="https://github.com/user/repo.git"
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
                          저장
                        </button>
                      </div>
                    )}

                    {gitRemote.remote_url && (
                      <div className="git-sync-btns">
                        <button disabled={isBusy} onClick={handlePushRemote}>
                          <ArrowUpRight size={12} strokeWidth={1.8} />
                          <span>Push</span>
                        </button>
                        <button disabled={isBusy} onClick={handlePullRemote}>
                          <ArrowDownLeft size={12} strokeWidth={1.8} />
                          <span>Pull</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="section-header" style={{ marginTop: "6px" }}>
                    <span>히스토리 ({snapshots.length})</span>
                  </div>

                  <div className="snapshot-list">
                    {snapshots.map((snap, idx) => {
                      const isCurrentHead = idx === 0 && !hasChanges;
                      return (
                        <div key={snap.id} className="snapshot-card">
                          <div className="snapshot-top">
                            <span className="snapshot-hash">{snap.short_id}</span>
                            {isCurrentHead && (
                              <span className="current-head-badge">HEAD</span>
                            )}
                            <span className="snapshot-time">
                              {new Date(snap.timestamp_iso).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <div className="snapshot-msg">{snap.message}</div>
                          <div className="snapshot-actions">
                            <button onClick={() => handleViewDiff(snap)}>
                              변경점 보기
                            </button>
                            <button
                              disabled={isCurrentHead}
                              onClick={() => handleRollbackSnapshot(snap)}
                            >
                              <RotateCcw size={11} strokeWidth={1.7} />
                              <span>{isCurrentHead ? "현재 상태" : "복원"}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB: CITE / REFERENCES (Overleaf BibTeX Style) */}
              {activeMenu === "cite" && (
                <div className="drawer-body">
                  <div className="section-header">
                    <span>BibTeX 빠른 가져오기</span>
                  </div>
                  <div className="control-group">
                    <textarea
                      rows={4}
                      placeholder="@inproceedings{hewitt1973, author={Carl Hewitt}, title={Actor Model}, year={1973}}"
                      value={bibtexInput}
                      onChange={(e) => setBibtexInput(e.target.value)}
                      style={{
                        width: "100%",
                        fontSize: "11px",
                        fontFamily: "monospace",
                        padding: "6px",
                        border: "1px solid #d4d4d8",
                        borderRadius: "4px",
                        resize: "vertical",
                      }}
                    />
                    <button className="btn-git-commit" onClick={handleImportBibtex}>
                      BibTeX 파싱 및 추가
                    </button>
                  </div>

                  <div className="section-header" style={{ marginTop: "4px" }}>
                    <span>직접 참고문헌 등록</span>
                  </div>
                  <div className="control-group">
                    <input
                      type="text"
                      placeholder="인용 키 (예: hewitt1973)"
                      value={citeForm.key}
                      onChange={(e) => setCiteForm({ ...citeForm, key: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="저자 (예: Carl Hewitt et al.)"
                      value={citeForm.authors}
                      onChange={(e) => setCiteForm({ ...citeForm, authors: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="논문/자료 제목"
                      value={citeForm.title}
                      onChange={(e) => setCiteForm({ ...citeForm, title: e.target.value })}
                    />
                    <div className="format-row">
                      <input
                        type="text"
                        placeholder="연도 (1973)"
                        value={citeForm.year}
                        onChange={(e) => setCiteForm({ ...citeForm, year: e.target.value })}
                      />
                      <input
                        type="text"
                        placeholder="학회/출처 (IJCAI)"
                        value={citeForm.venue}
                        onChange={(e) => setCiteForm({ ...citeForm, venue: e.target.value })}
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="링크 URL (선택)"
                      value={citeForm.url}
                      onChange={(e) => setCiteForm({ ...citeForm, url: e.target.value })}
                    />
                    <button className="btn-apply-recipe" onClick={handleSaveCite}>
                      참고문헌 저장
                    </button>
                  </div>

                  <div className="section-header" style={{ marginTop: "4px" }}>
                    <span>등록된 참고문헌 ({cites.length})</span>
                  </div>
                  <div className="snapshot-list">
                    {cites.map((c, idx) => (
                      <div key={c.key} className="snapshot-card">
                        <div className="snapshot-top">
                          <span className="tray-badge">[{idx + 1}]</span>
                          <span className="snapshot-hash">@{c.key}</span>
                          <span className="snapshot-time">{c.year}</span>
                        </div>
                        <div className="snapshot-msg">{c.title}</div>
                        {c.authors && (
                          <div style={{ fontSize: "10.5px", color: "#52525b", marginBottom: "6px" }}>
                            {c.authors}
                          </div>
                        )}
                        <div className="snapshot-actions">
                          <button onClick={() => handleInsertCiteIntoPost(c.key)}>
                            본문에 인용 삽입
                          </button>
                          <button onClick={() => handleDeleteCite(c.key)}>삭제</button>
                        </div>
                      </div>
                    ))}
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
                    <Upload size={16} strokeWidth={1.6} />
                    <div className="dropzone-title">사진 불러오기 (HEIC · JPG · PNG)</div>
                    <div className="dropzone-sub">
                      클릭하거나 파일을 드래그하세요 (GPS 자동 제거)
                    </div>
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
                            <span className="privacy-pill" title="GPS 메타데이터 제거됨">
                              <ShieldCheck size={11} strokeWidth={1.8} />
                              <span>GPS 제거</span>
                            </span>
                          )}
                          <button
                            className="drawer-close-btn"
                            title="사진 삭제"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteAsset(asset.asset_id);
                            }}
                          >
                            <Trash2 size={12} strokeWidth={1.7} />
                          </button>
                        </div>

                        <div className="tray-thumb-wrap">
                          <img src={asset.preview_data_url} alt={asset.original_filename} />
                        </div>

                        {asset.exif_summary && (
                          <div className="tray-exif">{asset.exif_summary}</div>
                        )}

                        <div className="tray-size-info">
                          {formatBytes(asset.original_size_bytes)} →{" "}
                          <strong>{formatBytes(asset.processed_size_bytes)}</strong>
                        </div>

                        <div className="tray-card-actions">
                          <button
                            className="btn-copy-img"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyTrayImage(asset);
                            }}
                          >
                            <Copy size={12} strokeWidth={1.8} />
                            <span>클립보드에 이미지 복사</span>
                          </button>
                          <div className="tray-sub-actions">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectAsset(asset, true);
                              }}
                            >
                              필터·포맷 편집
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInsertAssetIntoPost(asset);
                              }}
                            >
                              본문에 삽입
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
                    className="photo-dropzone compact"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleFileUpload(e.dataTransfer.files);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={14} strokeWidth={1.6} />
                    <span className="dropzone-title">새 사진 파일 추가 (HEIC/JPG/PNG)</span>
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
                            <span className="privacy-pill">
                              <ShieldCheck size={11} strokeWidth={1.8} />
                              <span>GPS 제거됨</span>
                            </span>
                          )}
                        </div>
                        {selectedAsset.exif_summary && (
                          <div className="studio-exif-line">{selectedAsset.exif_summary}</div>
                        )}
                      </div>

                      <div className="studio-controls">
                        <div className="control-group">
                          <label>컬러 프로파일 (Filter)</label>
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
                          <label>노출 · 대비 · 채도</label>
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
                          <label>프레임 스타일</label>
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
                          <label>워터마크 / 하단 스탬프 (영문·숫자)</label>
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
                          <label>포맷(확장자) 변환 및 해상도</label>
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
                              <option value="webp">WebP (권장)</option>
                              <option value="jpeg">JPEG (.jpg)</option>
                              <option value="png">PNG (.png)</option>
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
                          <label>사진 캡션</label>
                          <input
                            type="text"
                            placeholder="사진 하단 설명..."
                            value={editingCaption}
                            onChange={(e) => setEditingCaption(e.target.value)}
                          />
                        </div>

                        <button
                          className="btn-apply-recipe"
                          disabled={isBusy}
                          onClick={handleApplyImageRecipe}
                        >
                          {isBusy ? "렌더링 중..." : "변경사항 이미지에 적용"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="empty-studio">편집할 사진을 선택해 주세요.</div>
                  )}
                </div>
              )}

              {/* TAB 5: TISTORY STYLE SETTINGS */}
              {activeMenu === "style" && (
                <div className="drawer-body">
                  <div className="studio-controls">
                    <div className="control-group">
                      <label>대제목 (H1) 크기 (px)</label>
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
                      <label>중제목 (H2) 크기 (px)</label>
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
                      <label>소제목 (H3) 크기 (px)</label>
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
                      <label>본문 기본 크기 (px)</label>
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
                      <label>포인트 색상</label>
                      <input
                        type="color"
                        value={preset.accent_color}
                        onChange={(e) =>
                          handlePresetChange({ ...preset, accent_color: e.target.value })
                        }
                      />
                    </div>
                    <div className="control-group">
                      <label>코드 블록 테마</label>
                      <select
                        value={preset.code_theme}
                        onChange={(e) =>
                          handlePresetChange({ ...preset, code_theme: e.target.value })
                        }
                      >
                        <option value="base16-ocean.dark">Ocean Dark</option>
                        <option value="InspiredGitHub">GitHub Light</option>
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
              title="드래그하여 패널 너비 조절"
            />
          </>
        )}

        {/* CENTER PANE: Editor Area (supports dropping photos & pasting clipboard images) */}
        <main
          className="center-editor-area"
          ref={centerAreaRef}
          onPaste={handleEditorPaste}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              e.preventDefault();
              handleFileUpload(e.dataTransfer.files);
            }
          }}
        >
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
                <span className="pane-title">Markdown Source</span>
                <span className="pane-hint">
                  일반 편집 모드 및 복붙 창과 실시간으로 동기화됩니다.
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
                title="드래그하여 분할 비율 조절"
              />

              <div className="split-pane" style={{ flex: 1 }}>
                <div className="pane-toolbar">
                  <span className="pane-title">Markdown & Live Preview</span>
                </div>
                <div className="split-right-vertical">
                  <textarea
                    className="markdown-textarea compact"
                    value={markdownText}
                    onChange={(e) => syncFromMarkdown(e.target.value)}
                  />
                  <div className="tistory-live-preview-wrapper">
                    <div className="preview-sticky-label">Preview</div>
                    <div
                      className="tistory-preview-canvas"
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  </div>
                </div>
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
                <strong>스냅샷 [{diffModal.snapshot.short_id}] 변경점 비교</strong>
                <div className="modal-sub">{diffModal.snapshot.message}</div>
              </div>
              <button className="btn-close" onClick={() => setDiffModal(null)}>
                <X size={16} />
              </button>
            </div>
            <pre className="diff-pre">{diffModal.diff}</pre>
            <div className="modal-footer">
              <button
                className="btn-rollback"
                onClick={() => handleRollbackSnapshot(diffModal.snapshot)}
              >
                이 스냅샷 버전으로 복원
              </button>
              <button className="btn-secondary" onClick={() => setDiffModal(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

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
            <option value="h1">제목 1 ({preset.h1_size_px}px)</option>
            <option value="h2">제목 2 ({preset.h2_size_px}px)</option>
            <option value="h3">제목 3 ({preset.h3_size_px}px)</option>
            <option value="quote">인용구</option>
            <option value="list">목록</option>
            <option value="code">코드 블록</option>
          </select>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
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
                {sz}px
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
            <Plus size={12} strokeWidth={1.8} />
            <span>사진 추가</span>
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
                  <ArrowUp size={12} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveBlock(idx, 1);
                  }}
                  title="아래로 이동"
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  className="btn-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBlockAt(idx);
                  }}
                  title="삭제"
                >
                  <Trash2 size={12} />
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
                  <>
                    <AutoResizeTextarea
                      className="doc-paragraph-input"
                      style={{
                        fontSize: `${block.font_size_px ?? preset.body_font_size_px}px`,
                        lineHeight: preset.line_height,
                      }}
                      placeholder="내용을 입력하세요..."
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
                    {(() => {
                      const matches = Array.from(block.text.matchAll(/\[@([^\]]+)\]/g));
                      if (matches.length === 0) return null;
                      return (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
                          {matches.map((m, mi) => {
                            const k = m[1];
                            const cIdx = cites.findIndex((c) => c.key === k);
                            const cObj = cIdx >= 0 ? cites[cIdx] : null;
                            return (
                              <span
                                key={`${k}-${mi}`}
                                style={{
                                  fontSize: "11px",
                                  background: "#f4f4f5",
                                  color: "#3f3f46",
                                  padding: "2px 7px",
                                  borderRadius: "4px",
                                  border: "1px solid #e4e4e7",
                                }}
                              >
                                {cObj
                                  ? `[${cIdx + 1}] ${cObj.title}`
                                  : `[@${k}] (미등록 인용)`}
                              </span>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </>
                )}

                {block.type === "quote" && (
                  <AutoResizeTextarea
                    className="doc-quote-input"
                    style={{
                      fontSize: `${preset.body_font_size_px}px`,
                      lineHeight: preset.line_height,
                      borderLeftColor: preset.accent_color,
                    }}
                    placeholder="인용구를 입력하세요..."
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
                  <AutoResizeTextarea
                    className="doc-paragraph-input doc-list-input"
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
                              <label>촬영 정보</label>
                              <input
                                type="text"
                                value={block.exif_caption ?? ""}
                                placeholder="iPhone 15 Pro · 24mm · f/1.78"
                                onChange={(e) =>
                                  updateBlockAt(idx, {
                                    ...block,
                                    exif_caption: e.target.value || undefined,
                                  })
                                }
                              />
                            </div>
                            <div className="visual-img-row">
                              <label>캡션 설명</label>
                              <input
                                type="text"
                                value={block.custom_caption ?? ""}
                                placeholder="사진 하단 캡션..."
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
                                <Sliders size={12} strokeWidth={1.7} />
                                <span>사진 편집 패널에서 필터 · 확장자 변경</span>
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
          + 새 문단 추가
        </div>
      </div>
    );
  }
}
