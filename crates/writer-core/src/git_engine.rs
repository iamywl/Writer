use anyhow::{Context, Result};
use chrono::{DateTime, TimeZone, Utc};
use git2::{
    build::CheckoutBuilder, DiffFormat, DiffOptions, IndexAddOption, Oid, Repository, Signature,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Summary of a Git snapshot (commit) in the blogger's version history timeline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitSnapshotInfo {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub author: String,
    pub timestamp_iso: String,
    pub timestamp_unix: i64,
}

/// Information about the linked remote Git repository (`origin`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitRemoteStatus {
    pub remote_url: Option<String>,
    pub branch: String,
}

/// Manages the local Git repository for a Writer workspace.
pub struct WorkspaceGit {
    repo_path: PathBuf,
    repo: Repository,
}

impl WorkspaceGit {
    /// Opens an existing Git repository at `workspace_dir`, or initializes a new one
    /// with the standard Writer directory layout (`posts/`, `assets/raw/`, `assets/dist/`, `.writer/recipes/`).
    pub fn init_or_open(workspace_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(workspace_dir.join("posts"))?;
        std::fs::create_dir_all(workspace_dir.join("assets/raw"))?;
        std::fs::create_dir_all(workspace_dir.join("assets/dist"))?;
        std::fs::create_dir_all(workspace_dir.join(".writer/recipes"))?;

        let gitignore_path = workspace_dir.join(".gitignore");
        if !gitignore_path.exists() {
            std::fs::write(&gitignore_path, ".DS_Store\nassets/dist/\n")?;
        }

        let repo = if workspace_dir.join(".git").exists() {
            Repository::open(workspace_dir)
                .with_context(|| format!("Failed to open Git repo at {}", workspace_dir.display()))?
        } else {
            Repository::init(workspace_dir)
                .with_context(|| format!("Failed to init Git repo at {}", workspace_dir.display()))?
        };

        let instance = Self {
            repo_path: workspace_dir.to_path_buf(),
            repo,
        };

        Ok(instance)
    }

    pub fn repo_path(&self) -> &Path {
        &self.repo_path
    }

    /// Creates a new version snapshot (commit) of all current files in the workspace.
    pub fn create_snapshot(
        &self,
        message: &str,
        author_name: &str,
        author_email: &str,
    ) -> Result<GitSnapshotInfo> {
        let mut index = self.repo.index()?;
        index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
        index.update_all(["*"].iter(), None)?;
        index.write()?;

        let tree_id = index.write_tree()?;
        let tree = self.repo.find_tree(tree_id)?;
        let sig = Signature::now(author_name, author_email)?;

        let parent_commit = self
            .repo
            .head()
            .ok()
            .and_then(|h| h.target())
            .and_then(|oid| self.repo.find_commit(oid).ok());

        let commit_oid = match parent_commit {
            Some(ref parent) => {
                self.repo
                    .commit(Some("HEAD"), &sig, &sig, message, &tree, &[parent])?
            }
            None => self
                .repo
                .commit(Some("HEAD"), &sig, &sig, message, &tree, &[])?,
        };

        let commit = self.repo.find_commit(commit_oid)?;
        Ok(commit_to_info(&commit))
    }

    /// Lists snapshots from newest to oldest.
    pub fn list_snapshots(&self, max_count: usize) -> Result<Vec<GitSnapshotInfo>> {
        let Ok(head) = self.repo.head() else {
            return Ok(Vec::new());
        };
        let Some(head_oid) = head.target() else {
            return Ok(Vec::new());
        };

        let mut revwalk = self.repo.revwalk()?;
        revwalk.push(head_oid)?;
        revwalk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)?;

        let mut out = Vec::new();
        for oid_res in revwalk.take(max_count) {
            let oid = oid_res?;
            let commit = self.repo.find_commit(oid)?;
            out.push(commit_to_info(&commit));
        }

        Ok(out)
    }

    /// Generates a unified diff comparing a given snapshot to the current working tree.
    pub fn diff_snapshot_to_workdir(&self, snapshot_id: &str) -> Result<String> {
        let oid = Oid::from_str(snapshot_id)
            .with_context(|| format!("Invalid snapshot OID: {}", snapshot_id))?;
        let commit = self.repo.find_commit(oid)?;
        let tree = commit.tree()?;

        let mut diff_opts = DiffOptions::new();
        diff_opts.include_untracked(true);

        let diff = self
            .repo
            .diff_tree_to_workdir_with_index(Some(&tree), Some(&mut diff_opts))?;

        let mut diff_text = String::new();
        diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
            let origin = line.origin();
            if origin == '+' || origin == '-' || origin == ' ' {
                diff_text.push(origin);
            }
            if let Ok(s) = std::str::from_utf8(line.content()) {
                diff_text.push_str(s);
            }
            true
        })?;

        Ok(diff_text)
    }

    /// Safely restores the workspace files to the exact state of `snapshot_id`
    /// and records a new forward snapshot commit (non-destructive rollback).
    pub fn rollback_to_snapshot(
        &self,
        snapshot_id: &str,
        author_name: &str,
        author_email: &str,
    ) -> Result<GitSnapshotInfo> {
        let oid = Oid::from_str(snapshot_id)
            .with_context(|| format!("Invalid snapshot OID: {}", snapshot_id))?;
        let target_commit = self.repo.find_commit(oid)?;
        let target_tree = target_commit.tree()?;

        let mut checkout_opts = CheckoutBuilder::new();
        checkout_opts.force();
        self.repo
            .checkout_tree(target_tree.as_object(), Some(&mut checkout_opts))?;

        let short_id = &snapshot_id[..snapshot_id.len().min(7)];
        let msg = format!("버전 복원 (Rollback to {})", short_id);
        self.create_snapshot(&msg, author_name, author_email)
    }

    /// Returns the currently configured `origin` remote URL and active branch name.
    pub fn get_remote_status(&self) -> Result<GitRemoteStatus> {
        let remote_url = self
            .repo
            .find_remote("origin")
            .ok()
            .and_then(|r| r.url().map(mask_token_in_url));

        let branch = self
            .repo
            .head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()))
            .unwrap_or_else(|| "main".to_string());

        Ok(GitRemoteStatus { remote_url, branch })
    }

    /// Sets or updates the `origin` remote URL (e.g., `https://github.com/user/blog.git` or `git@github.com:user/blog.git`).
    /// Optionally embeds a GitHub Personal Access Token if provided for HTTPS URLs.
    pub fn set_remote_url(&self, raw_url: &str, token: Option<&str>) -> Result<GitRemoteStatus> {
        let trimmed = raw_url.trim();
        if trimmed.is_empty() {
            if self.repo.find_remote("origin").is_ok() {
                self.repo.remote_delete("origin")?;
            }
            return self.get_remote_status();
        }

        let final_url = if let Some(tok) = token.map(str::trim).filter(|t| !t.is_empty()) {
            if let Some(rest) = trimmed.strip_prefix("https://") {
                let clean_rest = rest.split('@').next_back().unwrap_or(rest);
                format!("https://x-access-token:{}@{}", tok, clean_rest)
            } else {
                trimmed.to_string()
            }
        } else {
            trimmed.to_string()
        };

        if self.repo.find_remote("origin").is_ok() {
            self.repo.remote_set_url("origin", &final_url)?;
        } else {
            self.repo.remote("origin", &final_url)?;
        }

        self.get_remote_status()
    }

    /// Pushes the current branch to the `origin` remote repository.
    pub fn push_to_remote(&self) -> Result<String> {
        let status = self.get_remote_status()?;
        if status.remote_url.is_none() {
            anyhow::bail!("연결된 Git 원격 저장소(origin)가 없습니다. 먼저 원격 저장소 주소를 등록해 주세요.");
        }

        let output = std::process::Command::new("git")
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .args(["push", "-u", "origin", &status.branch])
            .output()
            .context("Failed to execute git push")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Git Push 실패: {}", stderr.trim());
        }

        Ok(format!(
            "원격 저장소({})의 '{}' 브랜치로 푸시 완료!",
            status.remote_url.unwrap_or_default(),
            status.branch
        ))
    }

    /// Pulls the latest changes from the `origin` remote repository.
    pub fn pull_from_remote(&self) -> Result<String> {
        let status = self.get_remote_status()?;
        if status.remote_url.is_none() {
            anyhow::bail!("연결된 Git 원격 저장소(origin)가 없습니다. 먼저 원격 저장소 주소를 등록해 주세요.");
        }

        let output = std::process::Command::new("git")
            .current_dir(&self.repo_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .args(["pull", "--rebase", "origin", &status.branch])
            .output()
            .context("Failed to execute git pull")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Git Pull 실패: {}", stderr.trim());
        }

        Ok(format!(
            "원격 저장소({})에서 최신 변경사항을 가져왔습니다!",
            status.remote_url.unwrap_or_default()
        ))
    }
}

fn mask_token_in_url(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("https://") {
        if let Some(at_idx) = rest.find('@') {
            return format!("https://{}", &rest[at_idx + 1..]);
        }
    }
    url.to_string()
}

fn commit_to_info(commit: &git2::Commit<'_>) -> GitSnapshotInfo {
    let id = commit.id().to_string();
    let short_id = id[..id.len().min(7)].to_string();
    let message = commit.message().unwrap_or("").trim().to_string();
    let author = commit.author().name().unwrap_or("Writer User").to_string();
    let secs = commit.time().seconds();
    let dt: DateTime<Utc> = Utc
        .timestamp_opt(secs, 0)
        .single()
        .unwrap_or_else(Utc::now);

    GitSnapshotInfo {
        id,
        short_id,
        message,
        author,
        timestamp_iso: dt.to_rfc3339(),
        timestamp_unix: secs,
    }
}
