/* RPGAtlas — src-tauri/src/project.rs
   Native project-folder commands (Project Harbor, Phase H1·B). The desktop half
   of "a game is a folder": create/open/save a project folder, a recents registry,
   and reveal-in-file-manager. No UI wiring lands this phase — H2 consumes these.

   Every command uses std::fs directly with the `project_paths` guard (canonicalize
   + contain) — exactly like the `library_*` commands — so no new Tauri capability
   is required (`core:default` + `dialog:default` already cover everything). Args
   are camelCase over IPC (Tauri convention); fallible commands return the tagged
   `ProjectError` (never a raw OS string). Normative contract: docs/harbor-1-spec.md
   §1–§7 (Fable-signed, with four binding amendments folded in).
   GPL-3.0-or-later (see ../LICENSE). */

use std::path::{Path, PathBuf};

use crate::project_paths::{
    self, canonical_root, contained_join, map_io, validate_component, ProjectError,
    ProjectErrorCode,
};

// --- On-disk layout constants (docs/harbor-1-spec.md §1) ---------------------
const PROJECT_FILE: &str = "game.rpgatlas";
const ASSETS_DIR: &str = "assets";
const ASSET_SUBDIRS: [&str; 5] = ["characters", "facesets", "enemies", "tilesets", "audio"];
const ASSETS_README_NAME: &str = "READ ME — how to add assets.txt";
const ATLAS_DIR: &str = ".atlas";
const LIBRARY_FILE: &str = "library.json";
const CACHE_DIR: &str = "cache";
const BACKUP_DIR: &str = "backup";
const GITIGNORE_NAME: &str = ".gitignore";
const RECENTS_FILE: &str = "projects.json";
const RECENTS_CAP: usize = 12;
const BACKUPS_KEPT: usize = 5;

/// The per-project `assets/` README (gate amendment 2): an **in-place** rewrite of
/// the app-data inbox README. It must NOT promise "moved into Imported" — per §7 a
/// project's asset files are never moved, renamed, or deleted by the engine.
const ASSETS_README: &str = "\
RPGAtlas — your game's pictures and sounds\r\n\
==========================================\r\n\
\r\n\
This folder holds your game's art and audio. Drop your own files into the\r\n\
matching folder below, then switch back to the editor (or click \"Scan\" in the\r\n\
Asset Browser) and RPGAtlas will find them.\r\n\
\r\n\
Your files STAY right here where you put them. RPGAtlas never moves, renames,\r\n\
or deletes them. This whole folder IS your game, so you can copy it, back it up,\r\n\
or zip it up to share — and everything comes along.\r\n\
\r\n\
  characters\\  Walking sprites (PNG). A standard sheet is 3 columns x 4 rows.\r\n\
  facesets\\    Message-box face pictures (PNG).\r\n\
  enemies\\     Battler / enemy pictures (PNG).\r\n\
  tilesets\\    Map tiles (PNG). Big sheets open the tile slicer so you can cut\r\n\
               them into 48px tiles.\r\n\
  audio\\       Music & sound effects (OGG, MP3, WAV, M4A, FLAC).\r\n\
\r\n\
Tip: adding the same file twice is harmless — RPGAtlas notices it is already\r\n\
here and skips it.\r\n";

/// Scaffolded `.gitignore` (§1.3): a convenience for kids who version-control their
/// game. `.atlas/library.json` is intentionally kept (it carries tags/slicer meta);
/// `assets/` and `game.rpgatlas` are the source of truth.
const GITIGNORE_BODY: &str = "\
# RPGAtlas engine-managed, regenerable data\r\n\
.atlas/cache/\r\n\
.atlas/backup/\r\n";

/// The JSON shape returned to the frontend for a created/opened project (§3).
#[derive(Debug, serde::Serialize)]
pub struct ProjectBundle {
    /// Canonical absolute path of the project folder.
    root: String,
    /// The folder leaf name (the sanitized game name).
    name: String,
    /// The `game.rpgatlas` contents (blob-free FORMAT_VERSION 2 JSON, as a string).
    document: String,
}

/// Write `contents` to `path` atomically: write `<name>.tmp` fully, then rename
/// over the target (the `write_index` pattern from lib.rs), so a crash mid-write
/// never leaves a truncated file behind. `pub(crate)` so the per-project asset
/// store (project_assets.rs) writes `.atlas/library.json` the same way.
pub(crate) fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), ProjectError> {
    let mut tmp_name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    std::fs::write(&tmp, contents).map_err(map_io)?;
    std::fs::rename(&tmp, path).map_err(map_io)?;
    Ok(())
}

fn folder_leaf(root: &Path) -> String {
    root.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string()
}

/// Build the full project tree under an already-created, canonical `root` and write
/// the document atomically (§1). Kept separate from `project_create` so a failure at
/// any step can roll the whole root back (gate amendment 1: create is all-or-nothing).
fn scaffold(croot: &Path, document_json: &str) -> Result<ProjectBundle, ProjectError> {
    // assets/<type>/ (create_dir_all makes the parent assets/ too)
    for sub in ASSET_SUBDIRS {
        let dir = contained_join(croot, &[ASSETS_DIR, sub])?;
        std::fs::create_dir_all(&dir).map_err(map_io)?;
    }
    let readme = contained_join(croot, &[ASSETS_DIR, ASSETS_README_NAME])?;
    std::fs::write(&readme, ASSETS_README).map_err(map_io)?;

    // .atlas/{cache,backup}/ + empty library.json
    let cache = contained_join(croot, &[ATLAS_DIR, CACHE_DIR])?;
    std::fs::create_dir_all(&cache).map_err(map_io)?;
    let backup = contained_join(croot, &[ATLAS_DIR, BACKUP_DIR])?;
    std::fs::create_dir_all(&backup).map_err(map_io)?;
    let library = contained_join(croot, &[ATLAS_DIR, LIBRARY_FILE])?;
    atomic_write(&library, b"[]")?;

    // .gitignore
    let gitignore = contained_join(croot, &[GITIGNORE_NAME])?;
    std::fs::write(&gitignore, GITIGNORE_BODY).map_err(map_io)?;

    // game.rpgatlas (atomic, written last so the folder is never "a project with
    // no document" if an earlier step fails)
    let doc_path = contained_join(croot, &[PROJECT_FILE])?;
    atomic_write(&doc_path, document_json.as_bytes())?;

    Ok(ProjectBundle {
        root: croot.to_string_lossy().into_owned(),
        name: folder_leaf(croot),
        document: document_json.to_string(),
    })
}

/// Create a new project folder under `parentDir` named `name`, scaffold the tree,
/// and write the ready `documentJson` (built frontend-side — `project_create` is
/// template-agnostic, §3.1). Returns the bundle. `FOLDER_EXISTS` if the target
/// folder already exists (never clobbers). All-or-nothing: on any failure after we
/// created the root, best-effort `remove_dir_all` it (gate amendment 1).
#[tauri::command]
pub fn project_create(
    parent_dir: String,
    name: String,
    document_json: String,
) -> Result<ProjectBundle, ProjectError> {
    let parent = canonical_root(&parent_dir)?;
    // The frontend pre-sanitizes with the shared core (§5.1); Rust re-validates the
    // leaf as defense-in-depth before it ever touches the filesystem.
    validate_component(&name)?;
    let root = parent.join(&name);
    if root.exists() {
        return Err(ProjectError::new(ProjectErrorCode::FolderExists));
    }

    std::fs::create_dir(&root).map_err(map_io)?;
    // From here the root is OURS — canonicalize it, then scaffold. Any failure rolls
    // back exactly the folder this call created (never a pre-existing one).
    let built = canonical_root(&root.to_string_lossy()).and_then(|croot| scaffold(&croot, &document_json));
    match built {
        Ok(bundle) => Ok(bundle),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&root);
            Err(e)
        }
    }
}

/// Open a project by folder path or `…/game.rpgatlas` file path. Returns the
/// document + resolved root. Missing folder → `MISSING`; a folder with no
/// `game.rpgatlas` → `NOT_A_PROJECT`. The document is returned verbatim (migration
/// / validation stays frontend-side, as today's import path does).
#[tauri::command]
pub fn project_open(target: String) -> Result<ProjectBundle, ProjectError> {
    let root = project_paths::resolve_target(&target)?;
    let doc_path = contained_join(&root, &[PROJECT_FILE])?;
    if !doc_path.exists() {
        return Err(ProjectError::new(ProjectErrorCode::NotAProject));
    }
    let document = std::fs::read_to_string(&doc_path).map_err(map_io)?;
    Ok(ProjectBundle {
        root: root.to_string_lossy().into_owned(),
        name: folder_leaf(&root),
        document,
    })
}

/// Save `documentJson` into `root/game.rpgatlas`, atomically, after rolling a
/// backup of the current document. `root` must be a project (has `game.rpgatlas`
/// or `.atlas/`). Backups are best-effort and never block the save (§4).
#[tauri::command]
pub fn project_save(root: String, document_json: String) -> Result<(), ProjectError> {
    let croot = canonical_root(&root)?;
    let doc_path = contained_join(&croot, &[PROJECT_FILE])?;
    let atlas_path = contained_join(&croot, &[ATLAS_DIR])?;
    if !doc_path.exists() && !atlas_path.exists() {
        return Err(ProjectError::new(ProjectErrorCode::NotAProject));
    }
    if doc_path.exists() {
        // Best-effort: a backup failure must not block the primary write.
        let _ = roll_backup(&croot, &doc_path);
    }
    atomic_write(&doc_path, document_json.as_bytes())
}

/// Copy the current `game.rpgatlas` into `.atlas/backup/` as
/// `game-<epoch_ms>.rpgatlas.backup` (gate amendment 3: the `.backup` suffix keeps
/// H5's `.rpgatlas` file association off backups), then prune to the newest 5.
fn roll_backup(croot: &Path, doc_path: &Path) -> Result<(), ProjectError> {
    let backup_dir = contained_join(croot, &[ATLAS_DIR, BACKUP_DIR])?;
    std::fs::create_dir_all(&backup_dir).map_err(map_io)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let backup_name = format!("game-{stamp}.rpgatlas.backup");
    let dest = contained_join(croot, &[ATLAS_DIR, BACKUP_DIR, &backup_name])?;
    std::fs::copy(doc_path, &dest).map_err(map_io)?;
    prune_backups(&backup_dir, BACKUPS_KEPT);
    Ok(())
}

/// Keep only the `keep` newest `*.rpgatlas.backup` files in `dir` (by mtime).
/// Best-effort — any error just leaves extra backups (never fatal).
fn prune_backups(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut backups: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|n| n.ends_with(".rpgatlas.backup"))
                .unwrap_or(false)
        })
        .filter_map(|e| {
            let modified = e.metadata().and_then(|m| m.modified()).ok()?;
            Some((modified, e.path()))
        })
        .collect();
    // Newest first, then drop everything past `keep`.
    backups.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in backups.into_iter().skip(keep) {
        let _ = std::fs::remove_file(path);
    }
}

// --- Recents registry (<app-config>/projects.json, §5.2) ---------------------

fn recents_path(app: &tauri::AppHandle) -> Result<PathBuf, ProjectError> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| ProjectError::detailed(ProjectErrorCode::Io, e.to_string()))?;
    Ok(dir.join(RECENTS_FILE))
}

/// Read the recents array. A missing or corrupt file degrades to `[]` (never brick
/// — same posture as `read_index`). Does not prune; pruning of vanished folders is
/// a display-time concern (H2).
fn read_recents(app: &tauri::AppHandle) -> Vec<serde_json::Value> {
    let Ok(path) = recents_path(app) else {
        return Vec::new();
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(serde_json::Value::Array(items)) => items,
        _ => Vec::new(),
    }
}

fn write_recents(app: &tauri::AppHandle, items: &[serde_json::Value]) -> Result<(), ProjectError> {
    let path = recents_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(map_io)?;
    }
    let json = serde_json::to_string(items)
        .map_err(|e| ProjectError::detailed(ProjectErrorCode::Io, e.to_string()))?;
    atomic_write(&path, json.as_bytes())
}

/// The recents registry as a JSON string (`[]` when absent/corrupt).
#[tauri::command]
pub fn recents_list(app: tauri::AppHandle) -> Result<String, ProjectError> {
    let items = read_recents(&app);
    serde_json::to_string(&items)
        .map_err(|e| ProjectError::detailed(ProjectErrorCode::Io, e.to_string()))
}

/// Upsert `{name, path, lastOpened: now}` to the front, dedupe by exact `path`,
/// cap at `RECENTS_CAP` (12). Mirrors the tested TS core `touchRecent` (§5.2).
#[tauri::command]
pub fn recents_touch(app: tauri::AppHandle, path: String, name: String) -> Result<(), ProjectError> {
    let mut items = read_recents(&app);
    items.retain(|e| e.get("path").and_then(|v| v.as_str()) != Some(path.as_str()));
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    items.insert(
        0,
        serde_json::json!({ "name": name, "path": path, "lastOpened": now }),
    );
    items.truncate(RECENTS_CAP);
    write_recents(&app, &items)
}

/// Remove the recents entry with exact `path`.
#[tauri::command]
pub fn recents_remove(app: tauri::AppHandle, path: String) -> Result<(), ProjectError> {
    let mut items = read_recents(&app);
    items.retain(|e| e.get("path").and_then(|v| v.as_str()) != Some(path.as_str()));
    write_recents(&app, &items)
}

/// Open the project folder in the OS file manager (reuses `reveal_path`).
#[tauri::command]
pub fn project_reveal(root: String) -> Result<(), ProjectError> {
    let croot = canonical_root(&root)?;
    crate::reveal_path(&croot).map_err(|e| ProjectError::detailed(ProjectErrorCode::Io, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp(tag: &str) -> PathBuf {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("rpgatlas-project-{tag}-{n}"))
    }

    // Exercises the non-AppHandle scaffold/open/save logic directly against a temp
    // folder (the recents commands need a Tauri AppHandle, so they are covered by
    // the shared TS core `recents.ts` + devtools round-trip, per the spec).

    #[test]
    fn scaffold_creates_the_full_tree_and_document() {
        let parent = unique_temp("scaffold");
        std::fs::create_dir_all(&parent).unwrap();
        let root = parent.join("My Game");
        std::fs::create_dir(&root).unwrap();
        let croot = canonical_root(&root.to_string_lossy()).unwrap();

        let bundle = scaffold(&croot, "{\"formatVersion\":2}").unwrap();
        assert_eq!(bundle.name, "My Game");
        assert_eq!(bundle.document, "{\"formatVersion\":2}");

        assert!(croot.join("game.rpgatlas").is_file());
        assert!(croot.join("assets/characters").is_dir());
        assert!(croot.join("assets/audio").is_dir());
        assert!(croot.join("assets").join(ASSETS_README_NAME).is_file());
        assert!(croot.join(".atlas/library.json").is_file());
        assert!(croot.join(".atlas/cache").is_dir());
        assert!(croot.join(".atlas/backup").is_dir());
        assert!(croot.join(".gitignore").is_file());
        assert!(!croot.join("saves").exists()); // saves/ is deferred (§1)

        let lib = std::fs::read_to_string(croot.join(".atlas/library.json")).unwrap();
        assert_eq!(lib, "[]");
        let readme = std::fs::read_to_string(croot.join("assets").join(ASSETS_README_NAME)).unwrap();
        assert!(readme.contains("STAY right here"));
        assert!(!readme.contains("Imported")); // gate amendment 2: no inbox wording

        std::fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn open_reads_document_or_reports_not_a_project() {
        let parent = unique_temp("open");
        std::fs::create_dir_all(&parent).unwrap();
        let root = parent.join("Game");
        std::fs::create_dir(&root).unwrap();
        let croot = canonical_root(&root.to_string_lossy()).unwrap();

        // Empty folder → NOT_A_PROJECT
        let err = project_open(croot.to_string_lossy().into_owned()).unwrap_err();
        assert_eq!(err.code, ProjectErrorCode::NotAProject);

        // Scaffold it, then open by folder and by game.rpgatlas file path
        scaffold(&croot, "{\"v\":2}").unwrap();
        let by_folder = project_open(croot.to_string_lossy().into_owned()).unwrap();
        assert_eq!(by_folder.document, "{\"v\":2}");
        let file = croot.join("game.rpgatlas");
        let by_file = project_open(file.to_string_lossy().into_owned()).unwrap();
        assert_eq!(by_file.root, by_folder.root);

        std::fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn save_writes_atomically_and_rolls_a_backup() {
        let parent = unique_temp("save");
        std::fs::create_dir_all(&parent).unwrap();
        let root = parent.join("Game");
        std::fs::create_dir(&root).unwrap();
        let croot = canonical_root(&root.to_string_lossy()).unwrap();
        scaffold(&croot, "{\"gen\":0}").unwrap();

        project_save(croot.to_string_lossy().into_owned(), "{\"gen\":1}".into()).unwrap();
        let saved = std::fs::read_to_string(croot.join("game.rpgatlas")).unwrap();
        assert_eq!(saved, "{\"gen\":1}");

        // The pre-save document was backed up under .atlas/backup as *.rpgatlas.backup
        let backups: Vec<_> = std::fs::read_dir(croot.join(".atlas/backup"))
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.ends_with(".rpgatlas.backup"))
                    .unwrap_or(false)
            })
            .collect();
        assert_eq!(backups.len(), 1);
        let backed_up = std::fs::read_to_string(backups[0].path()).unwrap();
        assert_eq!(backed_up, "{\"gen\":0}");

        std::fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn prune_backups_keeps_only_the_newest_five() {
        let dir = unique_temp("prune");
        std::fs::create_dir_all(&dir).unwrap();
        // Create 8 backups with increasing mtime (sleep a hair so mtimes differ).
        for i in 0..8 {
            let p = dir.join(format!("game-{i}.rpgatlas.backup"));
            std::fs::write(&p, format!("{i}")).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        prune_backups(&dir, BACKUPS_KEPT);
        let remaining = std::fs::read_dir(&dir).unwrap().flatten().count();
        assert_eq!(remaining, BACKUPS_KEPT);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn create_reports_folder_exists_without_clobbering() {
        // project_create needs no AppHandle, so exercise it directly.
        let parent = unique_temp("exists");
        std::fs::create_dir_all(&parent).unwrap();
        let cparent = canonical_root(&parent.to_string_lossy()).unwrap();

        let first = project_create(
            cparent.to_string_lossy().into_owned(),
            "Game".into(),
            "{\"v\":2}".into(),
        )
        .unwrap();
        assert!(Path::new(&first.root).join("game.rpgatlas").is_file());

        // Second create with the same name must not clobber the existing folder.
        let err = project_create(
            cparent.to_string_lossy().into_owned(),
            "Game".into(),
            "{\"v\":99}".into(),
        )
        .unwrap_err();
        assert_eq!(err.code, ProjectErrorCode::FolderExists);
        // Original document untouched.
        let doc = std::fs::read_to_string(Path::new(&first.root).join("game.rpgatlas")).unwrap();
        assert_eq!(doc, "{\"v\":2}");

        std::fs::remove_dir_all(&parent).ok();
    }
}
