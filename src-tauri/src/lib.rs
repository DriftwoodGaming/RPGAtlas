/* RPGAtlas desktop wrapper — native commands.
   GPL-3.0-or-later (see ../LICENSE).

   The editor is the existing static web app, embedded as the frontend. These
   commands give it the few things a browser tab cannot do well: native file
   dialogs for project save/load, and a dedicated window for play-testing. */

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

/// Save the editor's project JSON to a user-chosen file. Returns the chosen
/// path, or `None` if the user cancelled the dialog.
#[tauri::command]
fn save_project(
    app: tauri::AppHandle,
    json: String,
    suggested: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("RPGAtlas project", &["json"])
        .set_file_name(format!("{suggested}.json"))
        .blocking_save_file();

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
    if let Some(existing) = app.get_webview_window("playtest") {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "playtest", WebviewUrl::App("play.html".into()))
        .title("RPGAtlas — Playtest")
        .inner_size(816.0, 624.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_project,
            save_project_to_path,
            open_project,
            open_playtest
        ])
        .run(tauri::generate_context!())
        .expect("error while running RPGAtlas");
}
