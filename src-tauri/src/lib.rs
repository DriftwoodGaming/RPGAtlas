/* RPGAtlas desktop wrapper — native commands.
   GPL-3.0-or-later (see ../LICENSE).

   The editor is the existing static web app, embedded as the frontend. These
   commands give it the few things a browser tab cannot do well: native file
   dialogs for project save/load, and a dedicated window for play-testing. */

use base64::Engine as _;
use std::path::PathBuf;
use tauri::{Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;

// Project Harbor (H1·B): real project folders. `project_paths` owns the
// canonicalize-and-contain path guard + tagged error taxonomy; `project` holds the
// project_create/open/save, recents, and reveal commands built on it. No UI wiring
// lands this phase — H2 consumes these. See docs/harbor-1-spec.md.
mod project;
mod project_assets;
mod project_paths;
// Project Harbor (H5·A/H5·B): launch-from-a-project plumbing — capture the initial
// argv path + the take_launch_path command, plus the single-instance open event.
mod launch;

/// Save the editor's project JSON to a user-chosen file. Returns the chosen
/// path, or `None` if the user cancelled the dialog.
#[tauri::command]
fn save_project(
    app: tauri::AppHandle,
    json: String,
    suggested: String,
) -> Result<Option<String>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("RPGAtlas project", &["json"])
        .set_file_name(format!("{suggested}.json"));
    // Exports default to the user's Downloads folder (honors a relocated known
    // folder on Windows) instead of the dialog's Documents default.
    if let Ok(dir) = app.path().download_dir() {
        dialog = dialog.set_directory(dir);
    }
    let picked = dialog.blocking_save_file();

    match picked {
        Some(file) => {
            let path = file.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, json).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

/// Write the project JSON straight to a known path (no dialog). Used by the
/// Save button once the project is bound to a file. The path originates from a
/// prior Save dialog, so it is already user-authorized.
#[tauri::command]
fn save_project_to_path(path: String, json: String) -> Result<(), String> {
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Open a project file chosen by the user and return its contents. Returns
/// `None` if the user cancelled.
#[tauri::command]
fn open_project(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("RPGAtlas project", &["json"])
        .blocking_pick_file();

    match picked {
        Some(file) => {
            let path = file.into_path().map_err(|e| e.to_string())?;
            let contents = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            Ok(Some(contents))
        }
        None => Ok(None),
    }
}

/// Open (or focus) the play-test window, pointed at the bundled play.html.
/// localStorage is shared across windows of the same origin, so the player
/// reads the project the editor just autosaved.
#[tauri::command]
fn open_playtest(app: tauri::AppHandle) -> Result<(), String> {
    // The play-test window is declared in tauri.conf.json and created at startup
    // (hidden). Building a window on demand from inside a command instead causes
    // a blank/frozen webview, so we reuse the pre-built one: reload it to re-read
    // the project the editor just autosaved, then show and focus it. Closing it
    // only hides it (see the window-event handler in `run`), so it is always
    // here to reuse, no matter how many times the user plays and closes.
    let playtest = app
        .get_webview_window("playtest")
        .ok_or_else(|| "Play-test window was not initialized.".to_string())?;

    playtest.reload().map_err(|e| e.to_string())?;
    playtest.show().map_err(|e| e.to_string())?;
    playtest.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Asset library (Phase 6): the desktop half of the AssetStore abstraction.
// Layout: <app-data>/library/index.json (JSON array of asset metadata) +
// <app-data>/library/blobs/<sha-256-hex> (content-addressed binaries). The
// metadata shape is owned by the frontend (src/shared/services.ts AssetMeta);
// Rust treats it as opaque JSON and only reads the "key", "hash", and "mime"
// fields it needs for file bookkeeping.
// ---------------------------------------------------------------------------

fn library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("library");
    Ok(dir)
}

fn read_index(app: &tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = library_dir(app)?.join("index.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(serde_json::Value::Array(items)) => Ok(items),
        // A corrupt index must not brick the library: surface an empty list
        // (blobs stay on disk; re-imports are hash-deduped by the frontend).
        _ => Ok(Vec::new()),
    }
}

fn write_index(app: &tauri::AppHandle, items: &[serde_json::Value]) -> Result<(), String> {
    let dir = library_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("index.json");
    let tmp = dir.join("index.json.tmp");
    let json = serde_json::to_string(items).map_err(|e| e.to_string())?;
    // Atomic-ish: write the temp file fully, then rename over the index so a
    // crash mid-write never leaves a truncated index behind.
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

fn meta_str(meta: &serde_json::Value, field: &str) -> Option<String> {
    meta.get(field).and_then(|v| v.as_str()).map(String::from)
}

/// A safe blob filename: the content hash is produced by the frontend as
/// SHA-256 hex, but never trust IPC input as a path component. `pub(crate)` so
/// the per-project asset store (project_assets.rs) reuses it for `.atlas/cache/`.
pub(crate) fn blob_file_name(hash: &str) -> Result<String, String> {
    if !hash.is_empty() && hash.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(hash.to_ascii_lowercase())
    } else {
        Err("invalid blob hash".into())
    }
}

/// The library metadata index as a JSON string (empty array when absent).
#[tauri::command]
fn library_list(app: tauri::AppHandle) -> Result<String, String> {
    let items = read_index(&app)?;
    serde_json::to_string(&items).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct LibraryBlob {
    data: String,
    mime: Option<String>,
}

/// Read one asset's blob (base64) by its stable key, or None when absent.
#[tauri::command]
fn library_read(app: tauri::AppHandle, key: String) -> Result<Option<LibraryBlob>, String> {
    let items = read_index(&app)?;
    let Some(meta) = items.iter().find(|m| meta_str(m, "key").as_deref() == Some(&key)) else {
        return Ok(None);
    };
    let hash = meta_str(meta, "hash").ok_or("asset has no hash")?;
    let path = library_dir(&app)?.join("blobs").join(blob_file_name(&hash)?);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Some(LibraryBlob {
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
        mime: meta_str(meta, "mime"),
    }))
}

/// Write (or replace) one asset: blob to blobs/<hash>, metadata upserted into
/// the index by key.
#[tauri::command]
fn library_write(
    app: tauri::AppHandle,
    meta_json: String,
    data_base64: String,
) -> Result<(), String> {
    let meta: serde_json::Value = serde_json::from_str(&meta_json).map_err(|e| e.to_string())?;
    let key = meta_str(&meta, "key").ok_or("asset metadata has no key")?;
    let hash = meta_str(&meta, "hash").ok_or("asset metadata has no hash")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| e.to_string())?;

    let blobs = library_dir(&app)?.join("blobs");
    std::fs::create_dir_all(&blobs).map_err(|e| e.to_string())?;
    std::fs::write(blobs.join(blob_file_name(&hash)?), bytes).map_err(|e| e.to_string())?;

    let mut items = read_index(&app)?;
    items.retain(|m| meta_str(m, "key").as_deref() != Some(&key));
    items.push(meta);
    write_index(&app, &items)
}

/// Remove one asset from the index; its blob file is deleted only when no
/// other asset shares the content hash (imports are content-addressed).
#[tauri::command]
fn library_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let mut items = read_index(&app)?;
    let removed_hash = items
        .iter()
        .find(|m| meta_str(m, "key").as_deref() == Some(&key))
        .and_then(|m| meta_str(m, "hash"));
    items.retain(|m| meta_str(m, "key").as_deref() != Some(&key));
    write_index(&app, &items)?;

    if let Some(hash) = removed_hash {
        let still_used = items.iter().any(|m| meta_str(m, "hash").as_deref() == Some(&hash));
        if !still_used {
            if let Ok(name) = blob_file_name(&hash) {
                let _ = std::fs::remove_file(library_dir(&app)?.join("blobs").join(name));
            }
        }
    }
    Ok(())
}

/// Update an asset's metadata (tags/kind/importer payloads) without touching
/// its blob.
#[tauri::command]
fn library_set_meta(app: tauri::AppHandle, meta_json: String) -> Result<(), String> {
    let meta: serde_json::Value = serde_json::from_str(&meta_json).map_err(|e| e.to_string())?;
    let key = meta_str(&meta, "key").ok_or("asset metadata has no key")?;
    let mut items = read_index(&app)?;
    items.retain(|m| meta_str(m, "key").as_deref() != Some(&key));
    items.push(meta);
    write_index(&app, &items)
}

// ---------------------------------------------------------------------------
// Import drop-folders: a human-friendly inbox so users can copy image/audio
// files straight from their file manager (Explorer/Finder) and have the editor
// pick them up — no in-app file picker required. Layout:
//   <app-data>/library/import/{characters,facesets,enemies,tilesets,audio}/
//   <app-data>/library/import/Imported/   (processed originals move here)
//   <app-data>/library/import/READ ME — how to add assets.txt
// The frontend calls library_scan_import, imports the returned files through
// the same wizard the Asset Browser uses (content-hash dedupe keeps it safe),
// and each scanned original is moved into Imported/ so re-scans stay clean and
// nothing is ever lost. Names from the file system are never trusted as paths.
// ---------------------------------------------------------------------------

/// The asset-type subfolders under import/ (index 0..3 are image types, the
/// last is audio); drives both directory creation and the scan.
const IMPORT_TYPES: [&str; 5] = ["characters", "facesets", "enemies", "tilesets", "audio"];
// `pub(crate)` so the per-project asset store (project_assets.rs) filters a scan of
// the in-place assets/ folders by the same known extensions.
pub(crate) const IMAGE_EXTS: [&str; 4] = ["png", "webp", "jpg", "jpeg"];
pub(crate) const AUDIO_EXTS: [&str; 5] = ["ogg", "mp3", "wav", "m4a", "flac"];

const IMPORT_README: &str = "\
RPGAtlas — how to add your own pictures and sounds\r\n\
==================================================\r\n\
\r\n\
Copy (or drag) your files into the matching folder below. The editor picks\r\n\
them up automatically when you open the Asset Browser, or when you click\r\n\
\"Scan for New Files\" there. Once imported, each file is moved into the\r\n\
\"Imported\" folder so this inbox stays tidy — nothing is deleted.\r\n\
\r\n\
  characters\\  Walking sprites (PNG). A standard sheet is 3 columns x 4 rows.\r\n\
  facesets\\    Message-box face pictures (PNG).\r\n\
  enemies\\     Battler / enemy pictures (PNG).\r\n\
  tilesets\\    Map tiles (PNG). Large sheets open the tile slicer so you can\r\n\
               cut them into 48px tiles.\r\n\
  audio\\       Music & sound effects (OGG, MP3, WAV, M4A, FLAC).\r\n\
\r\n\
Tips\r\n\
----\r\n\
- The file name becomes the asset name (lower-cased; spaces become dashes).\r\n\
- Adding the same file twice is harmless — duplicates are ignored.\r\n\
- A sound's role is guessed from its name: \"music\"/\"theme\" -> BGM,\r\n\
  \"ambience\"/\"loop\" -> BGS, \"victory\"/\"jingle\" -> ME, otherwise a sound\r\n\
  effect (SE). You can change any of this later in the Asset Browser.\r\n";

fn import_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(library_dir(app)?.join("import"))
}

/// Create the import folder tree (per-type subfolders + README) if missing and
/// return its absolute path.
fn ensure_import_dirs(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = import_dir(app)?;
    for ty in IMPORT_TYPES {
        std::fs::create_dir_all(root.join(ty)).map_err(|e| e.to_string())?;
    }
    let readme = root.join("READ ME — how to add assets.txt");
    if !readme.exists() {
        // A missing README must never fail the whole operation.
        let _ = std::fs::write(&readme, IMPORT_README);
    }
    Ok(root)
}

/// `pub(crate)` so project_assets.rs maps an in-place file's extension to a MIME
/// type when it reads bytes back for the import wizard.
pub(crate) fn mime_for_ext(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "png" => "image/png",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        "ogg" => "audio/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        _ => return None,
    })
}

/// A free filename inside `dir` for `name`, suffixing -2, -3, … on collision so
/// archiving a same-named file never clobbers an earlier one. `pub(crate)` so the
/// per-project asset store (project_assets.rs) reuses it for in-place `assets/` writes.
pub(crate) fn free_path(dir: &std::path::Path, name: &str) -> PathBuf {
    if !dir.join(name).exists() {
        return dir.join(name);
    }
    let p = std::path::Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("asset");
    let ext = p.extension().and_then(|e| e.to_str());
    for i in 2..1_000_000 {
        let candidate = match ext {
            Some(e) => format!("{stem}-{i}.{e}"),
            None => format!("{stem}-{i}"),
        };
        if !dir.join(&candidate).exists() {
            return dir.join(candidate);
        }
    }
    dir.join(name)
}

/// Open a folder in the OS file manager. Uses the platform's own launcher (no
/// extra Tauri plugin/permission needed); we spawn and don't wait, since some
/// launchers return a nonzero exit code even on success. `pub(crate)` so the
/// project commands (project.rs, `project_reveal`) reuse it.
pub(crate) fn reveal_path(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new("explorer").arg(path).spawn();
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = std::process::Command::new("xdg-open").arg(path).spawn();
    spawned.map(|_| ()).map_err(|e| e.to_string())
}

/// Ensure the import folder tree exists and return its absolute path (shown in
/// the Asset Browser so users know where to paste files).
#[tauri::command]
fn library_import_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(ensure_import_dirs(&app)?.to_string_lossy().into_owned())
}

/// Open the import folder in the OS file manager.
#[tauri::command]
fn library_reveal_import(app: tauri::AppHandle) -> Result<(), String> {
    let root = ensure_import_dirs(&app)?;
    reveal_path(&root)
}

#[derive(serde::Serialize)]
struct ImportFile {
    #[serde(rename = "type")]
    asset_type: String,
    name: String,
    mime: String,
    data: String,
}

/// Scan every import subfolder, returning the files found (base64) as a JSON
/// array. Each file's asset type comes from its subfolder; only known image /
/// audio extensions are picked up. Every returned original is moved into the
/// Imported/ archive so the next scan sees only genuinely new files.
#[tauri::command]
fn library_scan_import(app: tauri::AppHandle) -> Result<String, String> {
    let root = ensure_import_dirs(&app)?;
    let archive = root.join("Imported");
    std::fs::create_dir_all(&archive).map_err(|e| e.to_string())?;

    let mut out: Vec<ImportFile> = Vec::new();
    for ty in IMPORT_TYPES {
        let exts: &[&str] = if ty == "audio" { &AUDIO_EXTS } else { &IMAGE_EXTS };
        let Ok(entries) = std::fs::read_dir(root.join(ty)) else {
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
            let Some(mime) = mime_for_ext(&ext) else {
                continue;
            };
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("asset")
                .to_string();
            let Ok(bytes) = std::fs::read(&path) else {
                continue;
            };
            // Archive the original (rename first, copy+remove across volumes);
            // on total failure the file stays put and simply re-scans later.
            let dest = free_path(&archive, &name);
            if std::fs::rename(&path, &dest).is_err() && std::fs::write(&dest, &bytes).is_ok() {
                let _ = std::fs::remove_file(&path);
            }
            out.push(ImportFile {
                asset_type: ty.to_string(),
                name,
                mime: mime.to_string(),
                data: base64::engine::general_purpose::STANDARD.encode(&bytes),
            });
        }
    }
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Project Harbor H5·A: capture the project path this process was launched with
    // (a `.rpgatlas` association or `RPGAtlas.exe <path>`), before the app is built,
    // so the frontend can pull it once during boot and open straight into that game.
    let initial_launch = launch::initial_launch_path();

    tauri::Builder::default()
        .manage(launch::LaunchState::new(initial_launch))
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            // Hide the play-test window on close rather than destroying it, so it
            // can be reused for every subsequent play-test. Destroying it would
            // free its "playtest" label and leave nothing for open_playtest to
            // reopen. The main window keeps the default behavior (quits the app).
            if window.label() == "playtest" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            save_project,
            save_project_to_path,
            open_project,
            open_playtest,
            library_list,
            library_read,
            library_write,
            library_delete,
            library_set_meta,
            library_import_dir,
            library_reveal_import,
            library_scan_import,
            project::project_create,
            project::project_open,
            project::project_save,
            project::recents_list,
            project::recents_touch,
            project::recents_remove,
            project::project_reveal,
            project_assets::project_asset_index_read,
            project_assets::project_asset_index_write,
            project_assets::project_asset_read,
            project_assets::project_asset_write_inplace,
            project_assets::project_asset_write_cache,
            project_assets::project_asset_delete_cache,
            project_assets::project_assets_scan,
            project_assets::project_ensure_assets_readme,
            launch::take_launch_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running RPGAtlas");
}
