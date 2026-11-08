//! Markdown Studio Lite — Tauri 桌面外壳
//!
//! 设计原则：
//! 1. 前端仍然是那份单文件 HTML，不做任何 npm 运行时依赖；所有原生能力通过
//!    `invoke` 调自定义命令，因此浏览器版与桌面版共用同一套业务代码。
//! 2. 文件读写留在 Rust 侧，前端只传路径与文本。CSP 收紧后预览区不再有外链请求。
//! 3. 文件关联只写 HKCU，不需要管理员权限；Windows 的 UserChoice 保护无法绕过，
//!    所以注册后引导用户点一次「始终使用此应用」。

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

const PROG_ID: &str = "MarkdownStudioLite.md";
const ASSOC_EXTS: [&str; 2] = [".md", ".markdown"];

/// 首次启动来自命令行、或第二个实例转发过来的待打开文件。
pub struct PendingFile(pub Mutex<Option<String>>);

#[derive(serde::Serialize)]
pub struct ReadResult {
    text: String,
    encoding: String,
    size: u64,
}

#[derive(serde::Serialize)]
pub struct DefaultStatus {
    registered: bool,
    user_choice: Option<String>,
    is_default: bool,
    exe: String,
}

/* ---------------- 参数与路径 ---------------- */

fn first_file_arg() -> Option<String> {
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') || arg.starts_with("--") {
            continue;
        }
        let p = PathBuf::from(&arg);
        if p.is_file() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

fn file_arg_from(argv: &[String]) -> Option<String> {
    for arg in argv.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let p = PathBuf::from(arg);
        if p.is_file() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

fn fp_to_string(fp: FilePath) -> String {
    match fp {
        FilePath::Path(p) => p.to_string_lossy().to_string(),
        FilePath::Url(u) => u.to_string(),
    }
}

/* ---------------- 编码 ---------------- */

fn decode(bytes: &[u8]) -> (String, String) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (
            String::from_utf8_lossy(&bytes[3..]).into_owned(),
            "utf-8-bom".to_string(),
        );
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (cow, _, _) = encoding_rs::UTF_16LE.decode(&bytes[2..]);
        return (cow.into_owned(), "utf-16le".to_string());
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (cow, _, _) = encoding_rs::UTF_16BE.decode(&bytes[2..]);
        return (cow.into_owned(), "utf-16be".to_string());
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_string(), "utf-8".to_string()),
        // 中文环境的老文件多数是 GBK；UTF-8 解不开时优先按 GBK 试一次。
        Err(_) => {
            let (cow, _, had_errors) = encoding_rs::GBK.decode(bytes);
            if !had_errors {
                (cow.into_owned(), "gbk".to_string())
            } else {
                (String::from_utf8_lossy(bytes).into_owned(), "utf-8-lossy".to_string())
            }
        }
    }
}

fn encode(text: &str, encoding: &str) -> Vec<u8> {
    match encoding {
        "utf-8-bom" => {
            let mut v = vec![0xEF, 0xBB, 0xBF];
            v.extend_from_slice(text.as_bytes());
            v
        }
        "utf-16le" => {
            let (bytes, _, _) = encoding_rs::UTF_16LE.encode(text);
            let mut v = vec![0xFF, 0xFE];
            v.extend_from_slice(&bytes);
            v
        }
        "utf-16be" => {
            let (bytes, _, _) = encoding_rs::UTF_16BE.encode(text);
            let mut v = vec![0xFE, 0xFF];
            v.extend_from_slice(&bytes);
            v
        }
        "gbk" => {
            let (bytes, _, _) = encoding_rs::GBK.encode(text);
            bytes.into_owned()
        }
        _ => text.as_bytes().to_vec(),
    }
}

/* ---------------- 命令 ---------------- */

#[tauri::command]
fn take_pending_file(state: State<PendingFile>) -> Option<String> {
    if let Ok(mut guard) = state.0.lock() {
        return guard.take();
    }
    None
}

#[tauri::command]
fn peek_pending_file(state: State<PendingFile>) -> Option<String> {
    if let Ok(guard) = state.0.lock() {
        return guard.clone();
    }
    None
}

#[tauri::command]
fn read_text_file(path: String) -> Result<ReadResult, String> {
    let p = PathBuf::from(&path);
    let bytes = std::fs::read(&p).map_err(|e| format!("读取失败：{}", e))?;
    let size = bytes.len() as u64;
    let (text, encoding) = decode(&bytes);
    Ok(ReadResult { text, encoding, size })
}

#[tauri::command]
fn write_text_file(path: String, text: String, encoding: String) -> Result<u64, String> {
    let p = PathBuf::from(&path);
    if let Some(dir) = p.parent() {
        if !dir.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(dir);
        }
    }
    let bytes = encode(&text, &encoding);

    // 先写临时文件再替换，避免写入中途失败把原文档截断。
    let mut tmp = p.clone();
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "untitled.md".to_string());
    tmp.set_file_name(format!(".{}.mdsl-tmp", name));

    match std::fs::write(&tmp, &bytes) {
        Ok(_) => match std::fs::rename(&tmp, &p) {
            Ok(_) => Ok(bytes.len() as u64),
            Err(_) => {
                let _ = std::fs::remove_file(&tmp);
                std::fs::write(&p, &bytes).map_err(|e| format!("写入失败：{}", e))?;
                Ok(bytes.len() as u64)
            }
        },
        Err(e) => Err(format!("写入失败：{}", e)),
    }
}

#[tauri::command]
async fn pick_markdown(app: AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("打开 Markdown 文件")
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("文本文件", &["txt"])
        .pick_file(move |p| {
            let _ = tx.send(p);
        });
    rx.await.ok().flatten().map(fp_to_string)
}

#[tauri::command]
async fn pick_save_path(app: AppHandle, default_name: String) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("另存为")
        .set_file_name(&default_name)
        .add_filter("Markdown", &["md", "markdown"])
        .save_file(move |p| {
            let _ = tx.send(p);
        });
    rx.await.ok().flatten().map(fp_to_string)
}

#[cfg(windows)]
fn notify_assoc_changed() {
    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
    unsafe {
        SHChangeNotify(
            SHCNE_ASSOCCHANGED as i32,
            SHCNF_IDLIST,
            std::ptr::null(),
            std::ptr::null(),
        );
    }
}

#[cfg(windows)]
fn register_association(exe: &str) -> std::io::Result<()> {
    use winreg::enums::{HKEY_CURRENT_USER, REG_NONE};
    use winreg::{RegKey, RegValue};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (classes, _) = hkcu.create_subkey("Software\\Classes")?;

    for ext in ASSOC_EXTS {
        let (key, _) = classes.create_subkey(ext)?;
        key.set_value("", &PROG_ID)?;
        // 没有 OpenWithProgids 时，右键「打开方式」里看不到本程序，
        // 用户就永远没法把它选成默认。
        let (open_with, _) = key.create_subkey("OpenWithProgids")?;
        open_with.set_raw_value(
            PROG_ID,
            &RegValue { bytes: Vec::new(), vtype: REG_NONE },
        )?;
    }

    let (prog, _) = classes.create_subkey(PROG_ID)?;
    prog.set_value("", &"Markdown 文档")?;
    let (icon, _) = prog.create_subkey("DefaultIcon")?;
    icon.set_value("", &format!("\"{}\",0", exe))?;
    let (cmd, _) = prog.create_subkey("shell\\open\\command")?;
    cmd.set_value("", &format!("\"{}\" \"%1\"", exe))?;

    // 同时登记到 Applications\，让「打开方式 → 更多应用」里出现可选项。
    let app_name = std::path::Path::new(exe)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "MarkdownStudioLite.exe".to_string());
    let (app_key, _) = classes.create_subkey(format!("Applications\\{}", app_name))?;
    app_key.set_value("FriendlyAppName", &"Markdown Studio Lite")?;
    let (app_cmd, _) = app_key.create_subkey("shell\\open\\command")?;
    app_cmd.set_value("", &format!("\"{}\" \"%1\"", exe))?;
    let (types, _) = app_key.create_subkey("SupportedTypes")?;
    for ext in ASSOC_EXTS {
        types.set_value(ext, &"")?;
    }
    Ok(())
}

#[tauri::command]
fn set_default_app() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        register_association(&exe_str).map_err(|e| format!("写入注册表失败：{}", e))?;
        notify_assoc_changed();
    }
    Ok(exe_str)
}

#[tauri::command]
fn default_app_status() -> DefaultStatus {
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut registered = false;
    let mut user_choice: Option<String> = None;

    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        if let Ok(key) = hkcu.open_subkey("Software\\Classes\\.md") {
            if let Ok(v) = key.get_value::<String, _>("") {
                registered = v == PROG_ID;
            }
        }
        if let Ok(key) = hkcu.open_subkey(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\UserChoice",
        ) {
            if let Ok(v) = key.get_value::<String, _>("ProgId") {
                user_choice = Some(v);
            }
        }
    }

    let is_default = match &user_choice {
        Some(v) => v == PROG_ID,
        None => registered,
    };

    DefaultStatus {
        registered,
        user_choice,
        is_default,
        exe,
    }
}

#[tauri::command]
fn open_default_apps_settings() -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", "ms-settings:defaultapps"])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/* 直接弹系统的「打开方式」对话框。用户勾选「始终使用此应用」后，Windows 会自己
   写入带哈希校验的 UserChoice —— 这一步只能由用户点，程序无法代劳。 */
#[tauri::command]
fn open_with_dialog(path: Option<String>) -> Result<String, String> {
    let target = match path {
        Some(p) if std::path::Path::new(&p).is_file() => p,
        _ => {
            let tmp = std::env::temp_dir().join("Markdown Studio Lite 示例.md");
            std::fs::write(
                &tmp,
                "# 示例文档\n\n用来把 Markdown Studio Lite 设为 .md 的默认打开方式。\n",
            )
            .map_err(|e| e.to_string())?;
            tmp.to_string_lossy().to_string()
        }
    };
    std::process::Command::new("rundll32.exe")
        .arg("shell32.dll,OpenAs_RunDLL")
        .arg(&target)
        .spawn()
        .map_err(|e| format!("无法打开「打开方式」对话框：{}", e))?;
    Ok(target)
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn focus_and_pull(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.eval(
            "window.__MDSL_DESKTOP__ && window.__MDSL_DESKTOP__.pull && window.__MDSL_DESKTOP__.pull();",
        );
    }
}

pub fn run() {
    let startup = first_file_arg();

    tauri::Builder::default()
        .manage(PendingFile(Mutex::new(startup)))
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = file_arg_from(&argv) {
                if let Some(state) = app.try_state::<PendingFile>() {
                    if let Ok(mut guard) = state.0.lock() {
                        *guard = Some(path);
                    }
                }
            }
            focus_and_pull(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            take_pending_file,
            peek_pending_file,
            read_text_file,
            write_text_file,
            pick_markdown,
            pick_save_path,
            set_default_app,
            default_app_status,
            open_default_apps_settings,
            open_with_dialog,
            reveal_in_explorer
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Markdown Studio Lite");
}
