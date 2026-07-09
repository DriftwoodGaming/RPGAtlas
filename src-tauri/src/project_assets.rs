/* RPGAtlas — src-tauri/src/project_assets.rs
   Per-project asset filesystem (Project Harbor, Phase H4·A). The desktop half of
   "a game is a folder" for assets: the asset library now lives INSIDE the open
   project instead of the global <app-data>/library. Files the child drops into
   assets/<type>/ are referenced IN PLACE (never moved or deleted — contract §7);
   the index is .atlas/library.json; derived/sliced tiles are cached, content-
   addressed, under .atlas/cache/.

   Every command flows through the H1 `project_paths` guard (canonicalize +
   contained_join), so IPC-supplied `type` / `fileName` / `relPath` are validated
   path components — no path can escape the project root. Uses std::fs directly,
   like the `library_*` commands, so no new Tauri capability is required. The
   frontend counterpart is src/platform/project-asset-store.ts over the ManagerHost.
   Normative contract: docs/harbor-4-spec.md §1–§2. GPL-3.0-or-later (see ../LICENSE). */

use std::path::{Path, PathBuf};

use base64::Engine as _;

use crate::project_paths::{canonical_root, contained_join, map_io, ProjectError, ProjectErrorCode};

// On-disk layout constants (mirror project.rs §1).
const ASSETS_DIR: &str = "assets";
const ATLAS_DIR: &str = ".atlas";
const CACHE_DIR: &str = "cache";
const LIBRARY_FILE: &str = "library.json";
const ASSET_SUBDIRS: [&str; 5] = ["characters", "facesets", "enemies", "tilesets", "audio"];

fn b64_decode(data: &str) -> Result<Vec<u8>, ProjectError> {
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| ProjectError::detailed(ProjectErrorCode::Io, e.to_string()))
}

fn b64_encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Split a project-relative path ("assets/tilesets/dungeon.png", either separator)
/// into validated segments the guard can join onto the root. Empty → UNSAFE_PATH.
fn rel_segments(rel: &str) -> Result<Vec<&str>, ProjectError> {
    let segs: Vec<&str> = rel.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
    if segs.is_empty() {
        return Err(ProjectError::detailed(
            ProjectErrorCode::UnsafePath,
            "empty relative path",
        ));
    }
    Ok(segs)
}

/// Resolve a project-relative path to an absolute, contained path under `croot`.
fn rel_to_path(croot: &Path, rel: &str) -> Result<PathBuf, ProjectError> {
    let segs = rel_segments(rel)?;
    contained_join(croot, &segs)
}

/// Read `.atlas/library.json` as a JSON string. Absent → `[]` (never brick; the
/// frontend re-derives the index by re-scanning assets/). A corrupt file is returned
/// verbatim — the frontend's parser already degrades a non-array to `[]`.
#[tauri::command]
pub fn project_asset_index_read(root: String) -> Result<String, ProjectError> {
    let croot = canonical_root(&root)?;
    let path = contained_join(&croot, &[ATLAS_DIR, LIBRARY_FILE])?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("[]".into()),
        Err(e) => Err(map_io(e)),
    }
}

/// Atomically write `.atlas/library.json` (tmp-then-rename via project::atomic_write).
#[tauri::command]
pub fn project_asset_index_write(root: String, json: String) -> Result<(), ProjectError> {
    let croot = canonical_root(&root)?;
    let atlas = contained_join(&croot, &[ATLAS_DIR])?;
    std::fs::create_dir_all(&atlas).map_err(map_io)?;
    let path = contained_join(&croot, &[ATLAS_DIR, LIBRARY_FILE])?;
    crate::project::atomic_write(&path, json.as_bytes())
}

#[derive(Debug, serde::Serialize)]
pub struct AssetBlob {
    data: String,
    mime: Option<String>,
}

/// Read one asset's bytes (base64). `rel_path` (an in-place assets/ file) takes
/// precedence; otherwise `hash` reads the cache blob `.atlas/cache/<hash>`. A missing
/// file → `None` (the store surfaces it as the MISSING_ASSET state, never a crash).
#[tauri::command]
pub fn project_asset_read(
    root: String,
    rel_path: Option<String>,
    hash: Option<String>,
) -> Result<Option<AssetBlob>, ProjectError> {
    let croot = canonical_root(&root)?;
    let (path, mime) = match rel_path.as_deref().filter(|s| !s.is_empty()) {
        Some(rel) => {
            let path = rel_to_path(&croot, rel)?;
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .unwrap_or_default();
            (path, crate::mime_for_ext(&ext).map(String::from))
        }
        None => {
            let hash = hash
                .filter(|h| !h.is_empty())
                .ok_or_else(|| ProjectError::detailed(ProjectErrorCode::Io, "no relPath or hash"))?;
            let name = crate::blob_file_name(&hash)
                .map_err(|e| ProjectError::detailed(ProjectErrorCode::UnsafePath, e))?;
            (contained_join(&croot, &[ATLAS_DIR, CACHE_DIR, &name])?, None)
        }
    };
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(AssetBlob {
            data: b64_encode(&bytes),
            mime,
        })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(map_io(e)),
    }
}

/// Write a whole-file asset **in place** into `assets/<type>/<fileName>`, suffixing
/// `-2`, `-3`, … on a name collision so an existing user file is never clobbered.
/// Returns the actual project-relative path used (forward-slashed). `type` must be a
/// known asset subfolder; `fileName` is a validated single component.
#[tauri::command]
pub fn project_asset_write_inplace(
    root: String,
    asset_type: String,
    file_name: String,
    data_base64: String,
) -> Result<String, ProjectError> {
    let croot = canonical_root(&root)?;
    if !ASSET_SUBDIRS.contains(&asset_type.as_str()) {
        return Err(ProjectError::detailed(
            ProjectErrorCode::UnsafePath,
            "unknown asset type",
        ));
    }
    // Validate `asset_type` + `file_name` as path components up front (contained_join
    // runs validate_component on each), rejecting any traversal before we touch disk.
    let dir = contained_join(&croot, &[ASSETS_DIR, &asset_type])?;
    contained_join(&croot, &[ASSETS_DIR, &asset_type, &file_name])?;
    std::fs::create_dir_all(&dir).map_err(map_io)?;
    // free_path only appends a `-N` suffix on collision, so the chosen leaf is still a
    // valid component; re-validate it through the guard before writing, to be sure.
    let chosen = crate::free_path(&dir, &file_name);
    let leaf = chosen
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&file_name)
        .to_string();
    let final_path = contained_join(&croot, &[ASSETS_DIR, &asset_type, &leaf])?;
    let bytes = b64_decode(&data_base64)?;
    std::fs::write(&final_path, bytes).map_err(map_io)?;
    Ok(format!("{ASSETS_DIR}/{asset_type}/{leaf}"))
}

/// Write a derived/sliced blob to the content-addressed cache `.atlas/cache/<hash>`.
#[tauri::command]
pub fn project_asset_write_cache(
    root: String,
    hash: String,
    data_base64: String,
) -> Result<(), ProjectError> {
    let croot = canonical_root(&root)?;
    let name =
        crate::blob_file_name(&hash).map_err(|e| ProjectError::detailed(ProjectErrorCode::UnsafePath, e))?;
    let dir = contained_join(&croot, &[ATLAS_DIR, CACHE_DIR])?;
    std::fs::create_dir_all(&dir).map_err(map_io)?;
    let path = contained_join(&croot, &[ATLAS_DIR, CACHE_DIR, &name])?;
    let bytes = b64_decode(&data_base64)?;
    std::fs::write(&path, bytes).map_err(map_io)
}

/// Delete a cache blob (best-effort — a missing file is not an error). NEVER touches
/// an in-place assets/ file; the store only ever calls this for `.atlas/cache/` blobs.
#[tauri::command]
pub fn project_asset_delete_cache(root: String, hash: String) -> Result<(), ProjectError> {
    let croot = canonical_root(&root)?;
    let name =
        crate::blob_file_name(&hash).map_err(|e| ProjectError::detailed(ProjectErrorCode::UnsafePath, e))?;
    let path = contained_join(&croot, &[ATLAS_DIR, CACHE_DIR, &name])?;
    let _ = std::fs::remove_file(&path);
    Ok(())
}

/// Re-create the in-place `assets/` README if the child deleted it (H4·C), reusing the
/// H1 scaffold text (project.rs). Present → left untouched. Best-effort by nature; a
/// failure is returned but the caller treats it as non-fatal.
#[tauri::command]
pub fn project_ensure_assets_readme(root: String) -> Result<(), ProjectError> {
    let croot = canonical_root(&root)?;
    let assets = contained_join(&croot, &[ASSETS_DIR])?;
    std::fs::create_dir_all(&assets).map_err(map_io)?;
    let readme = contained_join(&croot, &[ASSETS_DIR, crate::project::ASSETS_README_NAME])?;
    if !readme.exists() {
        std::fs::write(&readme, crate::project::ASSETS_README).map_err(map_io)?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct ScannedFile {
    #[serde(rename = "type")]
    asset_type: String,
    #[serde(rename = "relPath")]
    rel_path: String,
    size: u64,
    #[serde(rename = "mtimeMs")]
    mtime_ms: u64,
}

/// Scan every `assets/<type>/` folder (non-recursive) for known image/audio files and
/// return a cheap snapshot `[{type, relPath, size, mtimeMs}]` (no bytes). The frontend
/// planner (src/shared/asset-scan.ts) diffs this against the index and only reads bytes
/// for genuinely new/changed files, so a focus-scan never floods the IPC channel. The
/// per-project README and any unknown extension are skipped.
#[tauri::command]
pub fn project_assets_scan(root: String) -> Result<String, ProjectError> {
    let croot = canonical_root(&root)?;
    let mut out: Vec<ScannedFile> = Vec::new();
    for ty in ASSET_SUBDIRS {
        let exts: &[&str] = if ty == "audio" { &crate::AUDIO_EXTS } else { &crate::IMAGE_EXTS };
        let dir = match contained_join(&croot, &[ASSETS_DIR, ty]) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .unwrap_or_default();
            if !exts.contains(&ext.as_str()) {
                continue;
            }
            let Some(leaf) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(ScannedFile {
                asset_type: ty.to_string(),
                rel_path: format!("{ASSETS_DIR}/{ty}/{leaf}"),
                size: meta.len(),
                mtime_ms,
            });
        }
    }
    serde_json::to_string(&out).map_err(|e| ProjectError::detailed(ProjectErrorCode::Io, e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp(tag: &str) -> PathBuf {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("rpgatlas-assets-{tag}-{n}"))
    }

    /// A scaffolded-enough project root (assets/<type>/ + .atlas/ present).
    fn make_root(tag: &str) -> (PathBuf, String) {
        let root = unique_temp(tag);
        for sub in ASSET_SUBDIRS {
            std::fs::create_dir_all(root.join(ASSETS_DIR).join(sub)).unwrap();
        }
        std::fs::create_dir_all(root.join(ATLAS_DIR).join(CACHE_DIR)).unwrap();
        let s = canonical_root(&root.to_string_lossy()).unwrap().to_string_lossy().into_owned();
        (root, s)
    }

    #[test]
    fn write_inplace_returns_relpath_and_suffixes_on_collision() {
        let (root, croot) = make_root("inplace");
        let a = project_asset_write_inplace(
            croot.clone(),
            "characters".into(),
            "hero.png".into(),
            b64_encode(b"AAA"),
        )
        .unwrap();
        assert_eq!(a, "assets/characters/hero.png");
        assert!(root.join("assets/characters/hero.png").is_file());

        // A different file with the same name suffixes rather than clobbering.
        let b = project_asset_write_inplace(
            croot.clone(),
            "characters".into(),
            "hero.png".into(),
            b64_encode(b"BBB"),
        )
        .unwrap();
        assert_eq!(b, "assets/characters/hero-2.png");
        assert_eq!(std::fs::read(root.join("assets/characters/hero.png")).unwrap(), b"AAA");
        assert_eq!(std::fs::read(root.join("assets/characters/hero-2.png")).unwrap(), b"BBB");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_inplace_rejects_unknown_type() {
        let (root, croot) = make_root("badtype");
        let err = project_asset_write_inplace(croot, "system".into(), "x.png".into(), b64_encode(b"Z"))
            .unwrap_err();
        assert_eq!(err.code, ProjectErrorCode::UnsafePath);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_roundtrips_inplace_and_cache_and_missing_is_none() {
        let (root, croot) = make_root("read");
        project_asset_write_inplace(croot.clone(), "audio".into(), "song.ogg".into(), b64_encode(b"OGG"))
            .unwrap();
        let got = project_asset_read(croot.clone(), Some("assets/audio/song.ogg".into()), None)
            .unwrap()
            .unwrap();
        assert_eq!(b64_decode(&got.data).unwrap(), b"OGG");
        assert_eq!(got.mime.as_deref(), Some("audio/ogg"));

        let hash = "a".repeat(64);
        project_asset_write_cache(croot.clone(), hash.clone(), b64_encode(b"TILE")).unwrap();
        let cached = project_asset_read(croot.clone(), None, Some(hash.clone())).unwrap().unwrap();
        assert_eq!(b64_decode(&cached.data).unwrap(), b"TILE");

        // A vanished file → None (the store maps this to MISSING_ASSET, not a crash).
        let gone = project_asset_read(croot.clone(), Some("assets/audio/nope.ogg".into()), None).unwrap();
        assert!(gone.is_none());

        project_asset_delete_cache(croot.clone(), hash.clone()).unwrap();
        assert!(project_asset_read(croot, None, Some(hash)).unwrap().is_none());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn index_read_write_roundtrips_and_absent_is_empty_array() {
        let (root, croot) = make_root("index");
        // .atlas/library.json isn't scaffolded by make_root → absent reads as [].
        assert_eq!(project_asset_index_read(croot.clone()).unwrap(), "[]");
        project_asset_index_write(croot.clone(), "[{\"key\":\"asset:audio/x\"}]".into()).unwrap();
        assert_eq!(
            project_asset_index_read(croot).unwrap(),
            "[{\"key\":\"asset:audio/x\"}]"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn scan_lists_known_files_by_type_and_skips_others() {
        let (root, croot) = make_root("scan");
        std::fs::write(root.join("assets/characters/hero.png"), b"P").unwrap();
        std::fs::write(root.join("assets/audio/theme.ogg"), b"O").unwrap();
        // Skipped: unknown extension and the README.
        std::fs::write(root.join("assets/characters/notes.txt"), b"x").unwrap();
        std::fs::write(root.join("assets").join("READ ME — how to add assets.txt"), b"x").unwrap();

        let json = project_assets_scan(croot).unwrap();
        let list: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(list.len(), 2);
        let rels: Vec<&str> = list.iter().map(|v| v["relPath"].as_str().unwrap()).collect();
        assert!(rels.contains(&"assets/characters/hero.png"));
        assert!(rels.contains(&"assets/audio/theme.ogg"));
        for v in &list {
            assert!(v["size"].as_u64().unwrap() >= 1);
            assert!(v.get("mtimeMs").is_some());
        }
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn ensure_readme_recreates_when_missing_but_never_clobbers() {
        let (root, croot) = make_root("readme");
        // make_root leaves assets/ without the README → ensure creates it.
        project_ensure_assets_readme(croot.clone()).unwrap();
        let path = root.join("assets").join(crate::project::ASSETS_README_NAME);
        assert!(path.is_file());
        assert!(std::fs::read_to_string(&path).unwrap().contains("STAY right here"));
        // An existing (even child-edited) README is left exactly as-is.
        std::fs::write(&path, "my own notes").unwrap();
        project_ensure_assets_readme(croot).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "my own notes");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn traversal_in_relpath_is_rejected() {
        let (root, croot) = make_root("traversal");
        let err = project_asset_read(croot, Some("../secrets.txt".into()), None).unwrap_err();
        assert_eq!(err.code, ProjectErrorCode::UnsafePath);
        std::fs::remove_dir_all(&root).ok();
    }
}
