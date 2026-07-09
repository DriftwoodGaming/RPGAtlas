/* RPGAtlas — src-tauri/src/project_paths.rs
   Path-safety guard for the project-folder commands (Project Harbor, Phase H1·B).

   Every project-scoped command canonicalizes its target and proves it stays
   inside the project root; IPC-supplied strings are never trusted as path
   components without validation. This extends the `blob_file_name` discipline in
   lib.rs from a single filename to whole paths, and owns the tagged error type
   the whole project surface returns (docs/harbor-1-spec.md §2, §6).

   Pure and self-contained (no Tauri/AppHandle), so it is unit-tested in isolation
   with `cargo test`. GPL-3.0-or-later (see ../LICENSE). */

use std::path::{Path, PathBuf};

/// The finite, kid-friendly failure taxonomy (docs/harbor-1-spec.md §6). Serialized
/// SCREAMING_SNAKE (e.g. `FOLDER_EXISTS`) so the typed host maps `code` → copy via
/// `src/shared/project-errors.ts`. The frontend never sees a raw OS string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProjectErrorCode {
    FolderExists,
    NoPermission,
    DiskFull,
    Missing,
    NotAProject,
    UnsafePath,
    // Reserved for H5's single-instance plugin; defined now so the taxonomy is
    // fixed in one place (docs/harbor-1-spec.md §6) but not yet constructed.
    #[allow(dead_code)]
    SecondInstance,
    Io,
}

/// A command failure: a stable machine `code` plus an optional developer `detail`
/// (never surfaced to kids — the host resolves `code` to friendly copy).
#[derive(Debug, serde::Serialize)]
pub struct ProjectError {
    pub code: ProjectErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl ProjectError {
    pub fn new(code: ProjectErrorCode) -> Self {
        Self { code, detail: None }
    }

    pub fn detailed(code: ProjectErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: Some(detail.into()),
        }
    }
}

/// Map an `std::io::Error` to the taxonomy. `AlreadyExists → FOLDER_EXISTS`,
/// `PermissionDenied → NO_PERMISSION`, `NotFound → MISSING`, a full disk/quota
/// → `DISK_FULL`, everything else → `IO`.
///
/// `ErrorKind::StorageFull` is not stable on the pinned MSRV (1.77.2), so disk-full
/// is detected via `raw_os_error` (`ENOSPC` on unix, `ERROR_DISK_FULL` on Windows)
/// — the non-binding implementation note in the signed contract.
pub fn map_io(e: std::io::Error) -> ProjectError {
    use std::io::ErrorKind;
    let code = match e.kind() {
        ErrorKind::AlreadyExists => ProjectErrorCode::FolderExists,
        ErrorKind::PermissionDenied => ProjectErrorCode::NoPermission,
        ErrorKind::NotFound => ProjectErrorCode::Missing,
        _ if is_disk_full(&e) => ProjectErrorCode::DiskFull,
        _ => ProjectErrorCode::Io,
    };
    ProjectError::detailed(code, e.to_string())
}

fn is_disk_full(e: &std::io::Error) -> bool {
    match e.raw_os_error() {
        // ENOSPC (no space left on device)
        #[cfg(unix)]
        Some(28) => true,
        // ERROR_DISK_FULL / ERROR_HANDLE_DISK_FULL
        #[cfg(windows)]
        Some(112) | Some(39) => true,
        _ => false,
    }
}

/// True for a single Windows reserved device name (`CON`, `PRN`, `AUX`, `NUL`,
/// `COM1`–`COM9`, `LPT1`–`LPT9`), case-insensitive, with or without an extension
/// (`CON.txt` is still reserved). Mirrors the TS sanitizer's rule (§5.1).
fn is_reserved_device(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name);
    let upper = stem.to_ascii_uppercase();
    if matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return true;
    }
    for prefix in ["COM", "LPT"] {
        if let Some(rest) = upper.strip_prefix(prefix) {
            if rest.len() == 1 && matches!(rest.as_bytes()[0], b'1'..=b'9') {
                return true;
            }
        }
    }
    false
}

/// Reject any single path segment that could escape the project root or is illegal
/// as a cross-platform folder/file name. Returns `UNSAFE_PATH` on rejection.
///
/// Rejects: empty, `.`, `..`, any of `/ \ : NUL` or a control char, an absolute
/// segment, a trailing dot or space (illegal as a Windows name ending), or a
/// reserved device name. Internal fixed components (`"assets"`, `"game.rpgatlas"`,
/// …) pass; H4's IPC-derived asset relative paths are the real customers.
pub fn validate_component(name: &str) -> Result<(), ProjectError> {
    let reject = |why: &str| Err(ProjectError::detailed(ProjectErrorCode::UnsafePath, why.to_string()));

    if name.is_empty() || name == "." || name == ".." {
        return reject("empty or dot segment");
    }
    if name
        .chars()
        .any(|c| matches!(c, '/' | '\\' | ':' | '\0') || c.is_control())
    {
        return reject("separator, colon, NUL, or control character in name");
    }
    if Path::new(name).is_absolute() {
        return reject("absolute path segment");
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return reject("segment ends in a dot or space");
    }
    if is_reserved_device(name) {
        return reject("reserved device name");
    }
    Ok(())
}

/// Canonicalize an **existing** directory (via `dunce::canonicalize` for friendly
/// non-UNC paths on Windows). `NotFound → MISSING`, `PermissionDenied →
/// NO_PERMISSION`. A path that resolves to a non-directory is treated as `MISSING`
/// (it is not a usable project root).
pub fn canonical_root(path: &str) -> Result<PathBuf, ProjectError> {
    let canon = dunce::canonicalize(path).map_err(map_io)?;
    if canon.is_dir() {
        Ok(canon)
    } else {
        Err(ProjectError::new(ProjectErrorCode::Missing))
    }
}

/// The deepest ancestor of `p` that exists on disk (for canonicalization, which
/// requires existence). Walks up until a component exists, or the path runs out.
fn deepest_existing_ancestor(p: &Path) -> PathBuf {
    let mut cur = p;
    loop {
        if cur.exists() {
            return cur.to_path_buf();
        }
        match cur.parent() {
            Some(parent) => cur = parent,
            None => return cur.to_path_buf(),
        }
    }
}

/// Validate each `rel` segment, join onto the canonical `root`, then verify by
/// canonicalizing the deepest existing ancestor of the result and asserting it
/// still lives under `root` (defeats a symlinked ancestor escape). `root` must
/// already be canonical (from `canonical_root`). This is the single path-building
/// helper — internal constants and (H4) IPC-derived asset paths both flow through it.
pub fn contained_join(root: &Path, rel: &[&str]) -> Result<PathBuf, ProjectError> {
    for seg in rel {
        validate_component(seg)?;
    }
    let mut joined = root.to_path_buf();
    for seg in rel {
        joined.push(seg);
    }
    let ancestor = deepest_existing_ancestor(&joined);
    let canon = dunce::canonicalize(&ancestor).map_err(map_io)?;
    if canon.starts_with(root) {
        Ok(joined)
    } else {
        Err(ProjectError::detailed(
            ProjectErrorCode::UnsafePath,
            "resolved path escaped the project root",
        ))
    }
}

/// Resolve any project identifier — a folder path OR a `…/game.rpgatlas` file path
/// — to the canonical project root. Lets `project_open`/`project_save`/
/// `project_reveal` accept either form (the folder and the file are interchangeable
/// identifiers, §1.1). A file whose name ends `.rpgatlas` resolves to its parent;
/// anything else resolves as a folder.
pub fn resolve_target(target: &str) -> Result<PathBuf, ProjectError> {
    let p = Path::new(target);
    let is_project_file = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("rpgatlas"))
        .unwrap_or(false);
    if is_project_file {
        let parent = p
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .ok_or_else(|| ProjectError::new(ProjectErrorCode::Missing))?;
        canonical_root(&parent.to_string_lossy())
    } else {
        canonical_root(target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp(tag: &str) -> PathBuf {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("rpgatlas-guard-{tag}-{n}"))
    }

    #[test]
    fn validate_rejects_traversal_and_separators() {
        for bad in ["", ".", "..", "a/b", "a\\b", "C:", "\0", "name ", "name."] {
            assert!(validate_component(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn validate_rejects_reserved_device_names_any_case_with_or_without_ext() {
        for bad in ["con", "CON", "Nul", "aux", "prn", "Com1", "COM9", "lpt9.txt"] {
            assert!(validate_component(bad).is_err(), "should reject {bad:?}");
            assert_eq!(
                validate_component(bad).unwrap_err().code,
                ProjectErrorCode::UnsafePath
            );
        }
    }

    #[test]
    fn validate_accepts_ordinary_and_internal_names() {
        for ok in [
            "My Game",
            "game.rpgatlas",
            ".atlas",
            ".gitignore",
            "READ ME — how to add assets.txt",
            "com10",  // only COM1-9 are reserved
            "comic",  // COM prefix but not a device
            "library.json",
        ] {
            assert!(validate_component(ok).is_ok(), "should accept {ok:?}");
        }
    }

    #[test]
    fn contained_join_accepts_nested_and_rejects_escape() {
        let base = unique_temp("contain");
        std::fs::create_dir_all(&base).unwrap();
        let root = dunce::canonicalize(&base).unwrap();

        // A legitimate not-yet-existing nested path is accepted (ancestor = root).
        assert!(contained_join(&root, &["assets", "characters"]).is_ok());
        // A `..` segment is rejected at component validation.
        assert!(contained_join(&root, &["..", "evil"]).is_err());
        // An absolute-looking / separator-laden segment is rejected.
        assert!(contained_join(&root, &["a/b"]).is_err());
        assert!(contained_join(&root, &["\\\\server\\share"]).is_err());

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn contained_join_result_stays_under_root() {
        let base = unique_temp("under");
        std::fs::create_dir_all(base.join("inside")).unwrap();
        let root = dunce::canonicalize(&base).unwrap();
        let p = contained_join(&root, &["inside"]).unwrap();
        assert!(p.starts_with(&root));
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn resolve_target_maps_project_file_to_parent_and_folder_to_itself() {
        let base = unique_temp("resolve");
        std::fs::create_dir_all(&base).unwrap();
        let root = dunce::canonicalize(&base).unwrap();
        let file = root.join("game.rpgatlas");
        std::fs::write(&file, "{}").unwrap();

        assert_eq!(resolve_target(&file.to_string_lossy()).unwrap(), root);
        assert_eq!(resolve_target(&root.to_string_lossy()).unwrap(), root);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn canonical_root_missing_maps_to_missing_code() {
        let missing = unique_temp("nope");
        let err = canonical_root(&missing.to_string_lossy()).unwrap_err();
        assert_eq!(err.code, ProjectErrorCode::Missing);
    }
}
