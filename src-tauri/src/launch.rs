/* RPGAtlas — src-tauri/src/launch.rs
   Launch-from-a-project plumbing (Project Harbor, Phase H5·A + H5·B). The desktop
   exe can be started with a project path (a `.rpgatlas` file association, or
   `RPGAtlas.exe C:\Games\MyGame` from a shell), and — once tauri-plugin-single-
   instance is registered (H5·B) — a *second* launch hands its path to the already-
   running process instead of starting a new one.

   Both paths funnel through ONE seam so the frontend's existing boot decision
   (boot.ts start() → launchManager) does the actual open:
   - the INITIAL argv is captured in `run()` into a managed `LaunchState` and pulled
     once by the frontend via `take_launch_path` (H5·A);
   - a SECOND launch's argv is pushed to the running frontend as an `atlas://open-
     project` event by the single-instance callback (H5·B, wired in lib.rs).

   The argv → path parse lives here as a pure, cargo-tested function; validation of
   the path (folder vs game.rpgatlas, missing, not-a-project) stays `project_open`'s
   job (project.rs), so a bad path yields the same kid-friendly error taxonomy the
   Project Manager already shows — never a silent drop or a crash.
   GPL-3.0-or-later (see ../LICENSE). */

use std::path::Path;
use std::sync::Mutex;

/// The name of the event the single-instance callback (lib.rs) emits to the running
/// frontend so it opens the requested project (H5·B). The frontend listens for it
/// through the withGlobalTauri event API (manager-host.ts `onOpenProjectRequest`).
pub(crate) const OPEN_PROJECT_EVENT: &str = "atlas://open-project";

/// Holds the project path the app was launched with (if any), until the frontend
/// pulls it once via `take_launch_path`. `pub(crate)` fields are not exposed; the
/// constructor + command own all access.
#[derive(Default)]
pub struct LaunchState {
    pending: Mutex<Option<String>>,
}

impl LaunchState {
    pub fn new(initial: Option<String>) -> Self {
        LaunchState {
            pending: Mutex::new(initial),
        }
    }
}

/// Parse a project path out of a process argument list. Skips `args[0]` (the
/// executable), skips empty entries and anything that looks like a flag (`-`/`--…`),
/// and returns the FIRST remaining argument as an absolute path string — resolving a
/// relative path against `cwd` (the directory the launch happened in). Returns `None`
/// when there is no path argument (a plain double-click of the exe, or a dev launch).
///
/// Intentionally does NOT check existence or shape: `project_open` canonicalizes,
/// contains, and classifies the path (folder / game.rpgatlas / missing / not-a-
/// project), so a bogus argument surfaces as the friendly taxonomy at open time.
pub(crate) fn project_arg_from_args(args: &[String], cwd: &Path) -> Option<String> {
    for arg in args.iter().skip(1) {
        if arg.is_empty() || arg.starts_with('-') {
            continue; // flags (e.g. --flag, -x) and empty entries are never the game
        }
        let p = Path::new(arg);
        let abs = if p.is_absolute() { p.to_path_buf() } else { cwd.join(p) };
        return Some(abs.to_string_lossy().into_owned());
    }
    None
}

/// Capture the initial launch path from the real process argv + cwd. Called once from
/// `run()` before the app is built; the result seeds `LaunchState`.
pub fn initial_launch_path() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir().unwrap_or_else(|_| Path::new(".").to_path_buf());
    project_arg_from_args(&args, &cwd)
}

/// Return (and clear) the project path the app was launched with, or `None`. The
/// frontend calls this once during boot (manager.ts `launchManager`); clearing it
/// means a later reload (a File ▸ Open reboot, an external-change reload) never
/// re-triggers the CLI open. A poisoned lock degrades to `None` (never panics).
#[tauri::command]
pub fn take_launch_path(state: tauri::State<'_, LaunchState>) -> Option<String> {
    state.pending.lock().ok().and_then(|mut guard| guard.take())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn none_when_only_the_executable() {
        let cwd = PathBuf::from("/work");
        assert_eq!(project_arg_from_args(&args(&["rpgatlas.exe"]), &cwd), None);
        assert_eq!(project_arg_from_args(&[], &cwd), None); // defensive: no argv at all
    }

    #[test]
    fn flags_and_empties_are_skipped() {
        let cwd = PathBuf::from("/work");
        // Leading flags are skipped; the first real path wins.
        let got = project_arg_from_args(
            &args(&["rpgatlas.exe", "--flag", "-x", "", "/Games/My Game"]),
            &cwd,
        );
        assert_eq!(got, Some("/Games/My Game".to_string()));
        // A launch that is only flags yields no path.
        assert_eq!(
            project_arg_from_args(&args(&["rpgatlas.exe", "--dev", "--foo"]), &cwd),
            None
        );
    }

    #[test]
    fn absolute_path_is_returned_verbatim() {
        // Use an absolute path shaped for the host OS so `is_absolute()` holds.
        let cwd = PathBuf::from(if cfg!(windows) { "C:\\work" } else { "/work" });
        let abs = if cfg!(windows) {
            "C:\\Games\\Hero\\game.rpgatlas"
        } else {
            "/Games/Hero/game.rpgatlas"
        };
        let got = project_arg_from_args(&args(&["rpgatlas.exe", abs]), &cwd);
        assert_eq!(got, Some(abs.to_string()));
    }

    #[test]
    fn relative_path_is_resolved_against_cwd() {
        let cwd = PathBuf::from(if cfg!(windows) { "C:\\work" } else { "/work" });
        let got = project_arg_from_args(&args(&["rpgatlas.exe", "MyGame"]), &cwd);
        let expected = cwd.join("MyGame").to_string_lossy().into_owned();
        assert_eq!(got, Some(expected));
    }
}
