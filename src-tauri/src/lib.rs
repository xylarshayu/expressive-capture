#[cfg(feature = "desktop")]
use image::{io::Reader as ImageReader, ImageFormat};
#[cfg(feature = "desktop")]
use serde::{Deserialize, Serialize};
#[cfg(feature = "desktop")]
use std::io::Cursor;
#[cfg(feature = "desktop")]
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
#[cfg(feature = "desktop")]
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
#[cfg(feature = "desktop")]
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
#[cfg(feature = "desktop")]
use uuid::Uuid;
use zip::{write::FileOptions, ZipArchive, ZipWriter};

const STAGING_DIR: &str = ".expressive-capture-staging";
#[cfg(feature = "desktop")]
const PRIMARY_HOTKEY: &str = "Ctrl+Alt+X";
#[cfg(feature = "desktop")]
const FALLBACK_HOTKEY: &str = "Ctrl+Alt+Shift+X";

#[cfg(feature = "desktop")]
struct CaptureState {
    root: Mutex<Option<PathBuf>>,
    sessions: Mutex<HashMap<String, CaptureSession>>,
    pending_copy_path: Mutex<Option<String>>,
    hotkey_registered: Mutex<bool>,
    hotkey: Mutex<String>,
    config_path: PathBuf,
}

#[cfg(feature = "desktop")]
impl Default for CaptureState {
    fn default() -> Self {
        Self {
            root: Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
            pending_copy_path: Mutex::new(None),
            hotkey_registered: Mutex::new(false),
            hotkey: Mutex::new(PRIMARY_HOTKEY.to_owned()),
            config_path: PathBuf::from("preferences.json"),
        }
    }
}

#[cfg(feature = "desktop")]
#[derive(Clone)]
struct CaptureSession {
    staging_dir: PathBuf,
    image_count: u32,
}

#[cfg(feature = "desktop")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BeginCaptureResult {
    session_id: String,
    staging_path: String,
}

#[cfg(feature = "desktop")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StagedImageResult {
    relative_path: String,
    asset_url: Option<String>,
    preview_bytes: Vec<u8>,
}

#[cfg(feature = "desktop")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StagedDiagramResult {
    source_relative_path: String,
    preview_relative_path: String,
}

#[cfg(feature = "desktop")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FinalizeCaptureResult {
    document_path: String,
    bundle_path: String,
    archive_path: Option<String>,
    copied_path: String,
    clipboard_copied: bool,
}

#[cfg(feature = "desktop")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    hotkey: String,
    hotkey_registered: bool,
    hotkey_conflict: bool,
    output_root: Option<String>,
    pending_copy_path: Option<String>,
}

#[cfg(feature = "desktop")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RetryCopyResult {
    copied_path: String,
    clipboard_copied: bool,
}

#[cfg(feature = "desktop")]
#[derive(Deserialize, Serialize)]
struct PersistedConfig {
    output_root: String,
    hotkey: String,
    #[serde(default)]
    pending_copy_path: Option<String>,
}

fn command_error(message: impl Into<String>) -> String {
    message.into()
}

#[cfg(feature = "desktop")]
fn native_path(path: &Path) -> String {
    let rendered = path.to_string_lossy();
    #[cfg(target_os = "windows")]
    {
        if let Some(unc) = rendered.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        if let Some(ordinary) = rendered.strip_prefix(r"\\?\") {
            return ordinary.to_owned();
        }
    }
    rendered.into_owned()
}

fn slugify(title: &str) -> String {
    let mut slug = String::new();
    let mut dash = false;
    for character in title.chars() {
        if character.is_ascii_alphanumeric() {
            if dash && !slug.is_empty() {
                slug.push('-');
            }
            slug.push(character.to_ascii_lowercase());
            dash = false;
        } else if !slug.is_empty() {
            dash = true;
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "capture".to_owned()
    } else {
        slug.chars().take(72).collect()
    }
}

#[cfg(all(feature = "desktop", not(target_os = "windows")))]
fn sync_directory(path: &Path) -> Result<(), String> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| command_error(format!("cannot sync capture directory: {error}")))
}

// Windows cannot open a directory as a normal `File` for `sync_all` without
// Win32 backup-semantics handles. File sync plus same-volume atomic renames are
// retained; a Windows integration test covers actual publish behavior.
#[cfg(all(feature = "desktop", target_os = "windows"))]
fn sync_directory(_: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(all(feature = "desktop", target_os = "windows"))]
fn copy_native_path(path: &Path) -> bool {
    clipboard_win::set_clipboard_string(&native_path(path)).is_ok()
}

#[cfg(all(feature = "desktop", not(target_os = "windows")))]
fn copy_native_path(_: &Path) -> bool {
    false
}

fn prepare_capture_root(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if !candidate.is_absolute() {
        return Err(command_error("capture root must be an absolute path"));
    }
    fs::create_dir_all(&candidate)
        .map_err(|error| command_error(format!("cannot create capture root: {error}")))?;
    let canonical = candidate
        .canonicalize()
        .map_err(|error| command_error(format!("cannot resolve capture root: {error}")))?;
    if !canonical.is_dir() {
        return Err(command_error("capture root must be a directory"));
    }
    Ok(canonical)
}

fn prepare_staging_root(root: &Path) -> Result<PathBuf, String> {
    let staging = root.join(STAGING_DIR);
    match fs::symlink_metadata(&staging) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(command_error(
                "capture staging directory must not be a symbolic link",
            ));
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(command_error("capture staging path must be a directory"));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&staging).map_err(|error| {
                command_error(format!("cannot create capture staging directory: {error}"))
            })?;
        }
        Err(error) => {
            return Err(command_error(format!(
                "cannot inspect capture staging directory: {error}"
            )));
        }
    }
    let canonical = staging.canonicalize().map_err(|error| {
        command_error(format!("cannot resolve capture staging directory: {error}"))
    })?;
    if canonical != staging || canonical.parent() != Some(root) {
        return Err(command_error(
            "capture staging directory is redirected outside its reserved path",
        ));
    }
    Ok(canonical)
}

fn prepare_capture_storage(path: &str) -> Result<PathBuf, String> {
    let root = prepare_capture_root(path)?;
    prepare_staging_root(&root)?;
    Ok(root)
}

#[cfg(feature = "desktop")]
fn default_capture_root() -> Result<PathBuf, String> {
    let home = std::env::var_os(if cfg!(target_os = "windows") {
        "USERPROFILE"
    } else {
        "HOME"
    })
    .map(PathBuf::from)
    .ok_or_else(|| {
        command_error("cannot determine the user home directory for the default capture root")
    })?;
    let root = home.join("Documents").join("Expressive Captures");
    prepare_capture_storage(&root.to_string_lossy())
}

#[cfg(feature = "desktop")]
fn app_config_path() -> Result<PathBuf, String> {
    let base = if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    }
    .ok_or_else(|| command_error("cannot determine application config directory"))?;
    let directory = base.join("Expressive Capture");
    fs::create_dir_all(&directory)
        .map_err(|error| command_error(format!("cannot create config directory: {error}")))?;
    Ok(directory.join("preferences.json"))
}

#[cfg(feature = "desktop")]
fn read_persisted_config(path: &Path) -> Option<PersistedConfig> {
    read_primary_or_backup(path, |bytes| serde_json::from_slice(bytes).ok())
}

fn read_primary_or_backup<T>(path: &Path, parse: impl Fn(&[u8]) -> Option<T>) -> Option<T> {
    fs::read(path)
        .ok()
        .and_then(|bytes| parse(&bytes))
        .or_else(|| {
            fs::read(path.with_extension("json.bak"))
                .ok()
                .and_then(|bytes| parse(&bytes))
        })
}

fn publish_replacement(temporary: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        fs::rename(temporary, destination)
            .map_err(|error| command_error(format!("cannot publish replacement: {error}")))
    }
    #[cfg(target_os = "windows")]
    {
        let backup = destination.with_extension("json.bak");
        let previous_backup = destination.with_extension("json.bak.previous");
        let had_destination = destination.exists();
        if had_destination && backup.exists() {
            // A stale backup must not block a later write. Rotate it rather than deleting
            // it before the new serialized file becomes the primary configuration.
            let _ = fs::remove_file(&previous_backup);
            fs::rename(&backup, &previous_backup).map_err(|error| {
                command_error(format!("cannot rotate stale preferences backup: {error}"))
            })?;
        }
        if had_destination {
            fs::rename(destination, &backup).map_err(|error| {
                command_error(format!("cannot preserve existing preferences: {error}"))
            })?;
        }
        if let Err(error) = fs::rename(temporary, destination) {
            if had_destination {
                let _ = fs::rename(&backup, destination);
            }
            return Err(command_error(format!(
                "cannot publish replacement: {error}"
            )));
        }
        if had_destination {
            let _ = fs::remove_file(backup);
        }
        // The new temp file was fully synced before entering this function, so at this
        // point it is a valid primary. Old rotated copies can be discarded best-effort.
        let _ = fs::remove_file(previous_backup);
        Ok(())
    }
}

#[cfg(feature = "desktop")]
fn write_persisted_config(path: &Path, config: &PersistedConfig) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| command_error("invalid config path"))?;
    let temporary = parent.join("preferences.json.tmp");
    let encoded = serde_json::to_vec(config)
        .map_err(|error| command_error(format!("cannot encode preferences: {error}")))?;
    let mut file = File::create(&temporary)
        .map_err(|error| command_error(format!("cannot write preferences: {error}")))?;
    file.write_all(&encoded)
        .and_then(|_| file.sync_all())
        .map_err(|error| command_error(format!("cannot sync preferences: {error}")))?;
    publish_replacement(&temporary, path)?;
    Ok(())
}

#[cfg(feature = "desktop")]
fn valid_hotkey(hotkey: &str) -> bool {
    matches!(hotkey, PRIMARY_HOTKEY | FALLBACK_HOTKEY)
}

fn ensure_direct_child(parent: &Path, child: &Path) -> Result<(), String> {
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| command_error(format!("cannot resolve capture root: {error}")))?;
    let canonical_child_parent = child
        .parent()
        .ok_or_else(|| command_error("capture path has no parent"))?
        .canonicalize()
        .map_err(|error| command_error(format!("cannot resolve capture path parent: {error}")))?;
    if canonical_child_parent != canonical_parent
        || child
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(command_error("capture path escapes configured root"));
    }
    Ok(())
}

#[cfg(feature = "desktop")]
fn checked_session<'a>(
    sessions: &'a HashMap<String, CaptureSession>,
    id: &str,
) -> Result<&'a CaptureSession, String> {
    sessions
        .get(id)
        .ok_or_else(|| command_error("unknown or completed capture session"))
}

fn valid_attachment_id(id: &str) -> bool {
    id.strip_prefix("dia_")
        .is_some_and(|token| !token.is_empty() && token.len() <= 60)
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn validate_excalidraw_scene(scene_json: &str) -> Result<(), String> {
    let scene: serde_json::Value = serde_json::from_str(scene_json)
        .map_err(|_| command_error("diagram scene must be valid JSON"))?;
    let object = scene
        .as_object()
        .ok_or_else(|| command_error("diagram scene must be an Excalidraw sidecar object"))?;
    if object.get("type").and_then(serde_json::Value::as_str) != Some("excalidraw")
        || object
            .get("version")
            .and_then(serde_json::Value::as_f64)
            .is_none()
        || object
            .get("source")
            .and_then(serde_json::Value::as_str)
            .is_none()
        || object
            .get("elements")
            .and_then(serde_json::Value::as_array)
            .is_none()
        || object
            .get("appState")
            .and_then(serde_json::Value::as_object)
            .is_none()
    {
        return Err(command_error(
            "diagram scene must be a portable Excalidraw sidecar (type, version, source, elements, appState)",
        ));
    }
    if object
        .get("files")
        .is_some_and(|files| !files.as_object().is_some_and(|files| files.is_empty()))
    {
        return Err(command_error(
            "diagram scene files must be absent or an empty object for portable sidecars",
        ));
    }
    Ok(())
}

fn validate_svg_preview(svg: &str) -> Result<(), String> {
    let normalized = svg.trim_start().to_ascii_lowercase();
    if !normalized.starts_with("<svg") || normalized.len() > 10 * 1024 * 1024 {
        return Err(command_error("diagram preview must be bounded SVG markup"));
    }
    const FORBIDDEN: [&str; 9] = [
        "<script",
        "<foreignobject",
        "<iframe",
        "<object",
        "<embed",
        "<image",
        "javascript:",
        "data:text/html",
        "url(",
    ];
    let compact: String = normalized
        .chars()
        .filter(|character| !character.is_ascii_whitespace())
        .collect();
    let event_attribute = [
        "onload=",
        "onerror=",
        "onclick=",
        "onbegin=",
        "onend=",
        "onrepeat=",
        "onfocus=",
        "onmouseover=",
    ]
    .iter()
    .any(|token| compact.contains(token));
    if FORBIDDEN.iter().any(|token| normalized.contains(token))
        || compact.contains("href=\"http://")
        || compact.contains("href='http://")
        || compact.contains("href=\"https://")
        || compact.contains("href='https://")
        || compact.contains("xmlns:")
        || compact.contains("&#")
        || compact.contains("&colon;")
        || event_attribute
    {
        return Err(command_error(
            "diagram preview contains active, scripted, or external SVG content",
        ));
    }
    Ok(())
}

fn validate_attachment_reference(attachments: &Path, reference: &str) -> Result<(), String> {
    let filename = reference
        .strip_prefix("./attachments/")
        .or_else(|| reference.strip_prefix("attachments/"))
        .filter(|name| !name.is_empty() && !name.contains('/') && !name.contains('\\'))
        .ok_or_else(|| command_error("attachment reference must be a direct attachments child"))?;
    let path = attachments.join(filename);
    ensure_direct_child(attachments, &path)?;
    if !fs::symlink_metadata(&path)
        .map_err(|_| command_error(format!("referenced attachment is missing: {reference}")))?
        .file_type()
        .is_file()
    {
        return Err(command_error(format!(
            "referenced attachment is not a regular file: {reference}"
        )));
    }
    Ok(())
}

fn validate_markdown_attachment_references(
    markdown: &str,
    attachments: &Path,
) -> Result<(), String> {
    for line in markdown.lines() {
        for prefix in ["source: ", "preview: "] {
            if let Some(reference) = line.strip_prefix(prefix) {
                if reference.starts_with("./attachments/") || reference.starts_with("attachments/")
                {
                    validate_attachment_reference(attachments, reference)?;
                }
            }
        }
        let mut remainder = line;
        while let Some(start) = remainder.find("](") {
            let after = &remainder[start + 2..];
            let end = after
                .find(')')
                .ok_or_else(|| command_error("unterminated Markdown attachment link"))?;
            let reference = &after[..end];
            if reference.starts_with("./attachments/") || reference.starts_with("attachments/") {
                validate_attachment_reference(attachments, reference)?;
            }
            remainder = &after[end + 1..];
        }
    }
    Ok(())
}

#[cfg(feature = "desktop")]
fn staged_attachment_path(session: &CaptureSession, filename: &str) -> Result<PathBuf, String> {
    let attachments = session.staging_dir.join("attachments");
    let destination = attachments.join(filename);
    ensure_direct_child(&attachments, &destination)?;
    Ok(destination)
}

#[cfg(feature = "desktop")]
fn write_synced(path: &Path, content: &[u8]) -> Result<(), String> {
    let mut file = File::create(path)
        .map_err(|error| command_error(format!("cannot write staged attachment: {error}")))?;
    file.write_all(content)
        .and_then(|_| file.sync_all())
        .map_err(|error| command_error(format!("cannot sync staged attachment: {error}")))
}

#[cfg(feature = "desktop")]
fn show_capture_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn configure_capture_root(root: String, state: State<'_, CaptureState>) -> Result<String, String> {
    let requested = if root.trim().is_empty() {
        default_capture_root()?
    } else {
        prepare_capture_storage(&root)?
    };
    let has_active_session = !state
        .sessions
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .is_empty();
    let current = state
        .root
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .clone();
    let has_pending_copy = state
        .pending_copy_path
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .is_some();
    if has_pending_copy && current.as_ref() != Some(&requested) {
        return Err(command_error(
            "cannot change the capture root while a clipboard copy is pending",
        ));
    }
    if has_pending_copy {
        return Ok(native_path(&requested));
    }
    if has_active_session && current.as_ref() != Some(&requested) {
        return Err(command_error(
            "cannot change the capture root while a capture session is active",
        ));
    }
    if has_active_session {
        return Ok(native_path(&requested));
    }
    prepare_staging_root(&requested)?;
    *state
        .root
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))? = Some(requested.clone());
    persist_preferences(&state)?;
    Ok(native_path(&requested))
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn begin_capture(state: State<'_, CaptureState>) -> Result<BeginCaptureResult, String> {
    let root = state
        .root
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .clone()
        .ok_or_else(|| command_error("configure_capture_root must be called first"))?;
    let session_id = Uuid::new_v4().to_string();
    // Repair a staging directory removed between application startup and the
    // first capture. First launch must not depend on opening Settings once.
    let staging_root = prepare_staging_root(&root)?;
    let staging_dir = staging_root.join(&session_id);
    ensure_direct_child(&staging_root, &staging_dir)?;
    fs::create_dir_all(staging_dir.join("attachments"))
        .map_err(|error| command_error(format!("cannot create capture staging area: {error}")))?;
    state
        .sessions
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .insert(
            session_id.clone(),
            CaptureSession {
                staging_dir: staging_dir.clone(),
                image_count: 0,
            },
        );
    Ok(BeginCaptureResult {
        session_id,
        staging_path: native_path(&staging_dir),
    })
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn resume_capture(
    session_id: String,
    state: State<'_, CaptureState>,
) -> Result<BeginCaptureResult, String> {
    Uuid::parse_str(&session_id).map_err(|_| command_error("capture session id must be a UUID"))?;
    let root = state
        .root
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .clone()
        .ok_or_else(|| command_error("configure_capture_root must be called first"))?;
    let staging_root = root.join(STAGING_DIR);
    let staging_dir = staging_root.join(&session_id);
    ensure_direct_child(&staging_root, &staging_dir)?;
    let attachments = staging_dir.join("attachments");
    if !staging_dir.is_dir() || !attachments.is_dir() {
        return Err(command_error(
            "staged capture does not exist or is incomplete",
        ));
    }
    let mut image_count = 0_u32;
    for entry in fs::read_dir(&attachments)
        .map_err(|error| command_error(format!("cannot inspect staged attachments: {error}")))?
    {
        let entry = entry.map_err(|error| {
            command_error(format!("cannot inspect staged attachments: {error}"))
        })?;
        if !entry
            .file_type()
            .map_err(|error| command_error(format!("cannot inspect staged attachment: {error}")))?
            .is_file()
        {
            return Err(command_error(
                "staged attachments must contain regular files only",
            ));
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(number) = name
            .strip_prefix("image-")
            .and_then(|value| value.strip_suffix(".png"))
        {
            let index: u32 = number
                .parse()
                .map_err(|_| command_error("staged image filename is invalid"))?;
            if index == 0 || index > 10_000 {
                return Err(command_error("staged image filename is out of bounds"));
            }
            image_count = image_count.max(index);
        }
    }
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?;
    sessions
        .entry(session_id.clone())
        .or_insert(CaptureSession {
            staging_dir: staging_dir.clone(),
            image_count,
        });
    Ok(BeginCaptureResult {
        session_id,
        staging_path: native_path(&staging_dir),
    })
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn stage_image(
    session_id: String,
    bytes: Vec<u8>,
    state: State<'_, CaptureState>,
) -> Result<StagedImageResult, String> {
    if bytes.is_empty() || bytes.len() > 50 * 1024 * 1024 {
        return Err(command_error("image must be between 1 byte and 50 MiB"));
    }
    if image::guess_format(&bytes).ok() == Some(ImageFormat::Gif) {
        return Err(command_error(
            "GIF images are not accepted; paste a static image",
        ));
    }
    let reader = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|_| command_error("clipboard content is not a supported encoded image"))?;
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| command_error("clipboard content is not a supported encoded image"))?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 24_000_000 {
        return Err(command_error(
            "image dimensions must be non-zero and at most 24 megapixels",
        ));
    }
    let image = image::load_from_memory(&bytes)
        .map_err(|_| command_error("clipboard content is not a supported encoded image"))?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?;
    let session = checked_session(&sessions, &session_id)?.clone();
    let image_index = session.image_count + 1;
    let filename = format!("image-{image_index:03}.png");
    let destination = staged_attachment_path(&session, &filename)?;
    let mut encoded = Cursor::new(Vec::new());
    image
        .write_to(&mut encoded, ImageFormat::Png)
        .map_err(|error| command_error(format!("cannot encode clipboard image: {error}")))?;
    let preview_bytes = encoded.into_inner();
    write_synced(&destination, &preview_bytes)?;
    if let Some(active) = sessions.get_mut(&session_id) {
        active.image_count = image_index;
    }
    Ok(StagedImageResult {
        relative_path: format!("attachments/{filename}"),
        asset_url: None,
        preview_bytes,
    })
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn stage_diagram(
    session_id: String,
    id: String,
    scene_json: String,
    svg: String,
    state: State<'_, CaptureState>,
) -> Result<StagedDiagramResult, String> {
    if !valid_attachment_id(&id) {
        return Err(command_error(
            "diagram id must be dia_<token> using only letters, digits, hyphen, or underscore",
        ));
    }
    if scene_json.is_empty()
        || scene_json.len() > 5 * 1024 * 1024
        || svg.is_empty()
        || svg.len() > 10 * 1024 * 1024
    {
        return Err(command_error(
            "diagram source or preview exceeds size limit",
        ));
    }
    validate_excalidraw_scene(&scene_json)?;
    validate_svg_preview(&svg)?;
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?;
    let session = checked_session(&sessions, &session_id)?.clone();
    drop(sessions);
    let source_name = format!("{id}.excalidraw");
    let preview_name = format!("{id}.svg");
    let source = staged_attachment_path(&session, &source_name)?;
    let preview = staged_attachment_path(&session, &preview_name)?;
    write_synced(&source, scene_json.as_bytes())?;
    write_synced(&preview, svg.as_bytes())?;
    Ok(StagedDiagramResult {
        source_relative_path: format!("attachments/{source_name}"),
        preview_relative_path: format!("attachments/{preview_name}"),
    })
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn load_staged_diagram(
    session_id: String,
    source_relative_path: String,
    state: State<'_, CaptureState>,
) -> Result<String, String> {
    let filename = source_relative_path
        .strip_prefix("attachments/")
        .filter(|name| name.ends_with(".excalidraw") && !name.contains('/') && !name.contains('\\'))
        .ok_or_else(|| {
            command_error("diagram path must name one staged attachments/*.excalidraw file")
        })?;
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?;
    let session = checked_session(&sessions, &session_id)?.clone();
    drop(sessions);
    let path = staged_attachment_path(&session, filename)?;
    let content = fs::read_to_string(path)
        .map_err(|error| command_error(format!("cannot load staged diagram: {error}")))?;
    validate_excalidraw_scene(&content)?;
    Ok(content)
}

fn zip_directory(source: &Path, document_name: &str, zip_path: &Path) -> Result<(), String> {
    let file = File::create(zip_path)
        .map_err(|error| command_error(format!("cannot create archive: {error}")))?;
    let mut writer = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    writer
        .add_directory("attachments/", options)
        .map_err(|error| command_error(format!("cannot write archive: {error}")))?;
    let markdown = fs::read(source.join(document_name))
        .map_err(|error| command_error(format!("cannot read document for archive: {error}")))?;
    writer
        .start_file(document_name, options)
        .map_err(|error| command_error(format!("cannot write archive: {error}")))?;
    writer
        .write_all(&markdown)
        .map_err(|error| command_error(format!("cannot write archive: {error}")))?;
    let attachments = source.join("attachments");
    for entry in fs::read_dir(&attachments)
        .map_err(|error| command_error(format!("cannot enumerate attachments: {error}")))?
    {
        let entry = entry
            .map_err(|error| command_error(format!("cannot enumerate attachments: {error}")))?;
        if !entry
            .file_type()
            .map_err(|error| command_error(format!("cannot inspect attachment: {error}")))?
            .is_file()
        {
            return Err(command_error("capture attachments must be regular files"));
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let content = fs::read(entry.path())
            .map_err(|error| command_error(format!("cannot read attachment: {error}")))?;
        writer
            .start_file(format!("attachments/{name}"), options)
            .map_err(|error| command_error(format!("cannot write archive: {error}")))?;
        writer
            .write_all(&content)
            .map_err(|error| command_error(format!("cannot write archive: {error}")))?;
    }
    let archive_file = writer
        .finish()
        .map_err(|error| command_error(format!("cannot finish archive: {error}")))?;
    archive_file
        .sync_all()
        .map_err(|error| command_error(format!("cannot sync archive: {error}")))?;
    Ok(())
}

fn verify_zip(source: &Path, document_name: &str, zip_path: &Path) -> Result<(), String> {
    let file = File::open(zip_path)
        .map_err(|error| command_error(format!("cannot verify archive: {error}")))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| command_error(format!("archive is invalid: {error}")))?;
    let mut expected = vec![(
        document_name.to_string(),
        fs::read(source.join(document_name))
            .map_err(|error| command_error(format!("cannot read document: {error}")))?,
    )];
    for entry in fs::read_dir(source.join("attachments"))
        .map_err(|error| command_error(format!("cannot enumerate attachments: {error}")))?
    {
        let entry = entry
            .map_err(|error| command_error(format!("cannot enumerate attachments: {error}")))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        expected.push((
            format!("attachments/{name}"),
            fs::read(entry.path())
                .map_err(|error| command_error(format!("cannot read attachment: {error}")))?,
        ));
    }
    if archive.len() != expected.len() + 1 {
        return Err(command_error(
            "archive verification failed: unexpected entry count",
        ));
    }
    if !archive
        .by_name("attachments/")
        .map_err(|_| command_error("archive verification failed: missing attachments directory"))?
        .is_dir()
    {
        return Err(command_error(
            "archive verification failed: attachments entry is not a directory",
        ));
    }
    for (name, content) in expected {
        let mut entry = archive
            .by_name(&name)
            .map_err(|_| command_error(format!("archive verification failed: missing {name}")))?;
        let mut actual = Vec::new();
        entry
            .read_to_end(&mut actual)
            .map_err(|error| command_error(format!("archive verification failed: {error}")))?;
        if actual != content {
            return Err(command_error(format!(
                "archive verification failed: content mismatch for {name}"
            )));
        }
    }
    Ok(())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn finalize_capture(
    session_id: String,
    markdown: String,
    title: String,
    archive: bool,
    state: State<'_, CaptureState>,
) -> Result<FinalizeCaptureResult, String> {
    if markdown.len() > 10 * 1024 * 1024 || title.len() > 512 {
        return Err(command_error("capture content exceeds size limit"));
    }
    let root = state
        .root
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .clone()
        .ok_or_else(|| command_error("configure_capture_root must be called first"))?;
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?;
    let session = checked_session(&sessions, &session_id)?.clone();
    drop(sessions);
    validate_markdown_attachment_references(&markdown, &session.staging_dir.join("attachments"))?;
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| command_error("system clock is before epoch"))?
        .as_secs();
    let name = format!(
        "{seconds}-{}-{}",
        slugify(&title),
        &Uuid::new_v4().simple().to_string()[..8]
    );
    let document_name = format!("{name}.md");
    let final_dir = root.join(&name);
    let build_dir = root.join(format!(".{name}.tmp"));
    let final_zip = root.join(format!("{name}.zip"));
    let build_zip = root.join(format!(".{name}.zip.tmp"));
    ensure_direct_child(&root, &final_dir)?;
    ensure_direct_child(&root, &build_dir)?;
    ensure_direct_child(&root, &final_zip)?;
    ensure_direct_child(&root, &build_zip)?;
    if state
        .pending_copy_path
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .is_some()
    {
        return Err(command_error(
            "resolve the pending clipboard copy before finalizing another capture",
        ));
    }
    let document_path = final_dir.join(&document_name);
    let copied_path = if archive {
        final_zip.clone()
    } else {
        document_path.clone()
    };
    let copied_path_text = native_path(&copied_path);
    // Journal the intended output before any publish rename. A failed journal leaves
    // the session untouched and retryable, never a committed-but-unreported capture.
    *state
        .pending_copy_path
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))? =
        Some(copied_path_text.clone());
    if let Err(error) = persist_preferences(&state) {
        *state
            .pending_copy_path
            .lock()
            .map_err(|_| command_error("capture state lock poisoned"))? = None;
        return Err(error);
    }

    let result = (|| -> Result<(), String> {
        fs::rename(&session.staging_dir, &build_dir)
            .map_err(|error| command_error(format!("cannot prepare capture bundle: {error}")))?;
        let mut document = File::create(build_dir.join(&document_name))
            .map_err(|error| command_error(format!("cannot write Markdown: {error}")))?;
        document
            .write_all(markdown.as_bytes())
            .map_err(|error| command_error(format!("cannot write Markdown: {error}")))?;
        document
            .sync_all()
            .map_err(|error| command_error(format!("cannot sync Markdown: {error}")))?;
        sync_directory(&build_dir.join("attachments"))?;
        sync_directory(&build_dir)?;
        if archive {
            zip_directory(&build_dir, &document_name, &build_zip)?;
            verify_zip(&build_dir, &document_name, &build_zip)?;
        }
        fs::rename(&build_dir, &final_dir)
            .map_err(|error| command_error(format!("cannot publish capture folder: {error}")))?;
        if archive {
            if let Err(error) = fs::rename(&build_zip, &final_zip) {
                let _ = fs::rename(&final_dir, &build_dir);
                return Err(command_error(format!(
                    "cannot publish capture archive: {error}"
                )));
            }
        }
        sync_directory(&root)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&build_zip);
        // Keep the session retryable: no partially published output, and restore the
        // opaque staging folder when a prepare/publish step fails.
        if build_dir.exists() {
            let _ = fs::rename(&build_dir, &session.staging_dir);
        }
        *state
            .pending_copy_path
            .lock()
            .map_err(|_| command_error("capture state lock poisoned"))? = None;
        let _ = persist_preferences(&state);
    }
    result?;
    state
        .sessions
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .remove(&session_id);
    let clipboard_copied = copy_native_path(&copied_path);
    if clipboard_copied {
        *state
            .pending_copy_path
            .lock()
            .map_err(|_| command_error("capture state lock poisoned"))? = None;
        if persist_preferences(&state).is_err() {
            *state
                .pending_copy_path
                .lock()
                .map_err(|_| command_error("capture state lock poisoned"))? =
                Some(copied_path_text.clone());
        }
    }
    Ok(FinalizeCaptureResult {
        document_path: native_path(&document_path),
        bundle_path: native_path(&final_dir),
        archive_path: archive.then(|| native_path(&final_zip)),
        copied_path: copied_path_text,
        clipboard_copied,
    })
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn abort_capture(session_id: String, state: State<'_, CaptureState>) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .remove(&session_id)
        .ok_or_else(|| command_error("unknown or completed capture session"))?;
    fs::remove_dir_all(session.staging_dir)
        .map_err(|error| command_error(format!("cannot discard staged capture: {error}")))
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn get_runtime_status(state: State<'_, CaptureState>) -> Result<RuntimeStatus, String> {
    let hotkey_registered = *state
        .hotkey_registered
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?;
    let output_root = state
        .root
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .as_ref()
        .map(|path| native_path(path));
    let hotkey = state
        .hotkey
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .clone();
    let pending_copy_path = state
        .pending_copy_path
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .clone();
    Ok(RuntimeStatus {
        hotkey,
        hotkey_registered,
        hotkey_conflict: !hotkey_registered,
        output_root,
        pending_copy_path,
    })
}

#[cfg(feature = "desktop")]
fn persist_preferences(state: &CaptureState) -> Result<(), String> {
    let output_root = state
        .root
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .as_ref()
        .map(|path| native_path(path))
        .ok_or_else(|| command_error("capture root is not configured"))?;
    let hotkey = state
        .hotkey
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .clone();
    let pending_copy_path = state
        .pending_copy_path
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .clone();
    write_persisted_config(
        &state.config_path,
        &PersistedConfig {
            output_root,
            hotkey,
            pending_copy_path,
        },
    )
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn retry_copy(path: String, state: State<'_, CaptureState>) -> Result<RetryCopyResult, String> {
    if state
        .pending_copy_path
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .as_deref()
        != Some(path.as_str())
    {
        return Err(command_error(
            "path was not committed by this application session",
        ));
    }
    let copied_path = PathBuf::from(&path);
    if !copied_path.is_file() && !copied_path.is_dir() {
        return Err(command_error("committed output no longer exists"));
    }
    let clipboard_copied = copy_native_path(&copied_path);
    if clipboard_copied {
        *state
            .pending_copy_path
            .lock()
            .map_err(|_| command_error("capture state lock poisoned"))? = None;
        if persist_preferences(&state).is_err() {
            // Keep the in-memory pending marker on a failed clear; an extra retry is safer
            // than losing recovery state after the committed capture has been published.
            *state
                .pending_copy_path
                .lock()
                .map_err(|_| command_error("capture state lock poisoned"))? = Some(path.clone());
        }
    }
    Ok(RetryCopyResult {
        copied_path: path,
        clipboard_copied,
    })
}

#[cfg(feature = "desktop")]
fn shortcut_for(hotkey: &str) -> Option<Shortcut> {
    let modifiers = match hotkey {
        PRIMARY_HOTKEY => Modifiers::CONTROL | Modifiers::ALT,
        FALLBACK_HOTKEY => Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT,
        _ => return None,
    };
    Some(Shortcut::new(Some(modifiers), Code::KeyX))
}

#[cfg(feature = "desktop")]
fn register_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut = shortcut_for(hotkey).ok_or_else(|| command_error("unsupported hotkey"))?;
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _, event| {
            if event.state() == ShortcutState::Pressed {
                show_capture_window(app);
            }
        })
        .map_err(|_| command_error("hotkey is unavailable or conflicts with another application"))
}

#[cfg(feature = "desktop")]
fn install_hotkey(app: &AppHandle, state: &CaptureState) {
    let requested = state
        .hotkey
        .lock()
        .map(|hotkey| hotkey.clone())
        .unwrap_or_else(|_| PRIMARY_HOTKEY.to_owned());
    let mut selected = None;
    for candidate in [requested.as_str(), PRIMARY_HOTKEY, FALLBACK_HOTKEY] {
        if register_hotkey(app, candidate).is_ok() {
            selected = Some(candidate.to_owned());
            break;
        }
    }
    if let Ok(mut registered) = state.hotkey_registered.lock() {
        *registered = selected.is_some();
    }
    if let Some(selected) = selected {
        if let Ok(mut hotkey) = state.hotkey.lock() {
            *hotkey = selected;
        }
    } else if let Ok(mut hotkey) = state.hotkey.lock() {
        hotkey.clear();
    }
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn configure_hotkey(
    hotkey: String,
    app: AppHandle,
    state: State<'_, CaptureState>,
) -> Result<RuntimeStatus, String> {
    if !valid_hotkey(&hotkey) {
        return Err(command_error(
            "hotkey must be Ctrl+Alt+X or Ctrl+Alt+Shift+X",
        ));
    }
    let current = state
        .hotkey
        .lock()
        .map_err(|_| command_error("capture state lock poisoned"))?
        .clone();
    if current != hotkey {
        // Register the new shortcut first. If it conflicts, the old one remains live.
        register_hotkey(&app, &hotkey)?;
        if let Some(previous) = shortcut_for(&current) {
            let _ = app.global_shortcut().unregister(previous);
        }
        *state
            .hotkey
            .lock()
            .map_err(|_| command_error("capture state lock poisoned"))? = hotkey;
        *state
            .hotkey_registered
            .lock()
            .map_err(|_| command_error("capture state lock poisoned"))? = true;
        persist_preferences(&state)?;
    }
    get_runtime_status(state)
}

#[cfg(feature = "desktop")]
fn load_safe_pending_copy(root: Option<&PathBuf>, pending: Option<&String>) -> Option<String> {
    let root = root?;
    let candidate = PathBuf::from(pending?);
    let canonical = candidate.canonicalize().ok()?;
    if canonical.is_file() && canonical.starts_with(root) {
        Some(native_path(&canonical))
    } else {
        None
    }
}

#[cfg(feature = "desktop")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config_path = app_config_path().unwrap_or_else(|_| PathBuf::from("preferences.json"));
    let persisted = read_persisted_config(&config_path);
    let root = persisted
        .as_ref()
        .and_then(|config| prepare_capture_storage(&config.output_root).ok())
        .or_else(|| default_capture_root().ok());
    let hotkey = persisted
        .as_ref()
        .map(|config| config.hotkey.as_str())
        .filter(|hotkey| valid_hotkey(hotkey))
        .unwrap_or(PRIMARY_HOTKEY)
        .to_owned();
    let pending_copy_path = load_safe_pending_copy(
        root.as_ref(),
        persisted
            .as_ref()
            .and_then(|config| config.pending_copy_path.as_ref()),
    );
    let state = CaptureState {
        root: Mutex::new(root),
        hotkey: Mutex::new(hotkey),
        pending_copy_path: Mutex::new(pending_copy_path),
        config_path,
        ..Default::default()
    };
    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_capture_window(app)
        }))
        .setup(|app| {
            install_hotkey(app.handle(), app.state::<CaptureState>().inner());
            let _ = persist_preferences(app.state::<CaptureState>().inner());
            if let Some(window) = app.get_webview_window("main") {
                let event_window = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = event_window.emit("capture://finalize-request", ());
                    }
                });
            }
            show_capture_window(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            configure_capture_root,
            configure_hotkey,
            begin_capture,
            resume_capture,
            stage_image,
            stage_diagram,
            load_staged_diagram,
            finalize_capture,
            abort_capture,
            get_runtime_status,
            retry_copy
        ])
        .run(tauri::generate_context!())
        .expect("error while running Expressive Capture");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn root_must_be_absolute_and_is_created_when_missing() {
        let temp = tempdir().unwrap();
        let created = temp.path().join("new-root");
        assert!(prepare_capture_root("relative").is_err());
        let root = prepare_capture_root(&created.to_string_lossy()).unwrap();
        assert!(root.is_dir());
    }

    #[test]
    fn capture_storage_prepares_and_repairs_first_launch_staging_directory() {
        let temp = tempdir().unwrap();
        let requested = temp.path().join("captures");
        let root = prepare_capture_storage(&requested.to_string_lossy()).unwrap();
        let staging = root.join(STAGING_DIR);
        assert!(staging.is_dir());

        fs::remove_dir(&staging).unwrap();
        let repaired = prepare_staging_root(&root).unwrap();
        assert_eq!(repaired, staging.canonicalize().unwrap());
        assert!(repaired.is_dir());
    }

    #[test]
    fn capture_storage_does_not_replace_a_reserved_staging_file() {
        let temp = tempdir().unwrap();
        let root = prepare_capture_root(&temp.path().join("captures").to_string_lossy()).unwrap();
        let staging = root.join(STAGING_DIR);
        fs::write(&staging, b"keep me").unwrap();

        assert_eq!(
            prepare_staging_root(&root).unwrap_err(),
            "capture staging path must be a directory"
        );
        assert_eq!(fs::read(&staging).unwrap(), b"keep me");
    }

    #[cfg(unix)]
    #[test]
    fn capture_storage_rejects_redirected_staging_directory() {
        use std::os::unix::fs::symlink;

        let temp = tempdir().unwrap();
        let root = prepare_capture_root(&temp.path().join("captures").to_string_lossy()).unwrap();
        let outside = temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        symlink(&outside, root.join(STAGING_DIR)).unwrap();

        assert_eq!(
            prepare_staging_root(&root).unwrap_err(),
            "capture staging directory must not be a symbolic link"
        );
    }

    #[test]
    fn replacement_preserves_a_complete_new_file() {
        let temp = tempdir().unwrap();
        let destination = temp.path().join("preferences.json");
        let replacement = temp.path().join("preferences.json.tmp");
        fs::write(&destination, "old").unwrap();
        fs::write(&replacement, "new").unwrap();
        publish_replacement(&replacement, &destination).unwrap();
        assert_eq!(fs::read_to_string(destination).unwrap(), "new");
    }

    #[test]
    fn missing_or_corrupt_primary_falls_back_to_complete_backup() {
        let temp = tempdir().unwrap();
        let destination = temp.path().join("preferences.json");
        let backup = destination.with_extension("json.bak");
        fs::write(&backup, b"backup").unwrap();
        let read_text = |bytes: &[u8]| std::str::from_utf8(bytes).ok().map(str::to_owned);
        assert_eq!(
            read_primary_or_backup(&destination, read_text).as_deref(),
            Some("backup")
        );
        fs::write(&destination, [0xff]).unwrap();
        assert_eq!(
            read_primary_or_backup(&destination, read_text).as_deref(),
            Some("backup")
        );
    }

    #[test]
    fn child_confinement_rejects_parent_traversal() {
        let temp = tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        assert!(ensure_direct_child(&root, &root.join("bundle")).is_ok());
        assert!(ensure_direct_child(&root, &root.join("nested/bundle")).is_err());
        assert!(ensure_direct_child(&root, &root.join("../outside")).is_err());
    }

    #[test]
    fn markdown_attachment_references_must_exist_as_direct_regular_files() {
        let temp = tempdir().unwrap();
        let attachments = temp.path().join("attachments");
        fs::create_dir_all(&attachments).unwrap();
        fs::write(attachments.join("image-001.png"), b"png").unwrap();
        fs::write(attachments.join("dia_demo.svg"), b"svg").unwrap();
        fs::write(attachments.join("dia_demo.excalidraw"), b"{}").unwrap();
        let valid = "![image](./attachments/image-001.png)\n```diagram\nsource: ./attachments/dia_demo.excalidraw\npreview: ./attachments/dia_demo.svg\n```\n![diagram](./attachments/dia_demo.svg)";
        assert!(validate_markdown_attachment_references(valid, &attachments).is_ok());
        assert!(validate_markdown_attachment_references(
            "![missing](./attachments/missing.png)",
            &attachments
        )
        .is_err());
        assert!(validate_markdown_attachment_references(
            "![escape](./attachments/../outside.png)",
            &attachments
        )
        .is_err());
        assert!(validate_markdown_attachment_references(
            "source: interview transcript\npreview: pending",
            &attachments
        )
        .is_ok());
    }

    #[test]
    fn zip_verification_detects_mismatch() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir_all(source.join("attachments")).unwrap();
        let document_name = "1700000000-capture.md";
        fs::write(source.join(document_name), "# capture").unwrap();
        fs::write(source.join("attachments/image-001.png"), b"image bytes").unwrap();
        let archive = temp.path().join("capture.zip");
        zip_directory(&source, document_name, &archive).unwrap();
        verify_zip(&source, document_name, &archive).unwrap();
        fs::write(source.join(document_name), "changed").unwrap();
        assert!(verify_zip(&source, document_name, &archive).is_err());
    }

    #[test]
    fn diagram_ids_are_version_one_conformant() {
        assert!(valid_attachment_id("dia_abc-123"));
        assert!(!valid_attachment_id("diagram-abc"));
        assert!(!valid_attachment_id("dia_../../escape"));
        assert!(!valid_attachment_id("dia_"));
    }

    #[test]
    fn diagram_scene_requires_portable_excalidraw_sidecar_shape() {
        let valid =
            r#"{"type":"excalidraw","version":2,"source":"local","elements":[],"appState":{}}"#;
        assert!(validate_excalidraw_scene(valid).is_ok());
        assert!(validate_excalidraw_scene(r#"{"elements":[]}"#).is_err());
        assert!(validate_excalidraw_scene(r#"{"type":"excalidraw","version":2,"source":"local","elements":[],"appState":{},"files":{"abc":{}}}"#).is_err());
        assert!(validate_excalidraw_scene("[]").is_err());
    }

    #[test]
    fn svg_preview_rejects_active_or_external_content() {
        let safe_excalidraw_preview =
            include_str!("../../tests/fixtures/diagram-v1/excalidraw-preview-safe.svg");
        let external_excalidraw_fonts =
            include_str!("../../tests/fixtures/diagram-v1/excalidraw-preview-external-font.svg");
        assert!(validate_svg_preview(safe_excalidraw_preview).is_ok());

        let forbidden = [
            "<svg><script>alert(1)</script></svg>",
            r#"<svg><foreignObject><p>HTML</p></foreignObject></svg>"#,
            r#"<svg><iframe src="about:blank"/></svg>"#,
            r#"<svg><object data="local"/></svg>"#,
            r#"<svg><embed src="local"/></svg>"#,
            r#"<svg><image href="data:image/png;base64,AA=="/></svg>"#,
            r#"<svg><a href="https://example.test">x</a></svg>"#,
            r#"<svg><a href="javascript:alert(1)">x</a></svg>"#,
            r#"<svg onload="alert(1)"/>"#,
            r#"<svg><text>&#106;avascript</text></svg>"#,
            r#"<svg xmlns:xlink="http://www.w3.org/1999/xlink"></svg>"#,
        ];
        for svg in forbidden {
            assert!(
                validate_svg_preview(svg).is_err(),
                "accepted unsafe SVG: {svg}"
            );
        }
        assert!(validate_svg_preview(external_excalidraw_fonts).is_err());
    }

    #[test]
    fn slug_is_portable_and_nonempty() {
        assert_eq!(slugify("A plan: capture / later"), "a-plan-capture-later");
        assert_eq!(slugify("   "), "capture");
    }
}
