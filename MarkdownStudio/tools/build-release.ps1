# build-release.ps1 - Zero-install release builder (Windows PowerShell 5.1 built-in).
# No Node.js / Python / esbuild required on the release machine.
#
# Usage 1 (normal):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-release.ps1
# Usage 2 (execution policy locked down):
#   $sb = [scriptblock]::Create((Get-Content -Raw -Encoding UTF8 tools\build-release.ps1))
#   & $sb -ToolsDir "<project>\tools"
# Usage 3 (with diagnostic log):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-release.ps1 -LogPath "<project>\dist\build.log"
#
# Output: dist\MarkdownStudioLite.html - one self-contained file, double-click under file://.

param(
  [string]$ToolsDir = "",
  [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"
$script:LogFile = $LogPath

function Write-Step([string]$msg) {
  $line = "[" + (Get-Date -Format "HH:mm:ss.fff") + "] " + $msg
  Write-Output $line
  if ($script:LogFile) {
    [System.IO.File]::AppendAllText($script:LogFile, $line + "`r`n", [System.Text.UTF8Encoding]::new($false))
  }
}

function Stop-Build([string]$msg) {
  Write-Step ("FATAL: " + $msg)
  throw $msg
}

# --- Locate project root (works for -File, dot-source and scriptblock calls) ---
if (-not $ToolsDir) { $ToolsDir = $PSScriptRoot }
if (-not $ToolsDir -and $MyInvocation.MyCommand.Path) {
  $ToolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $ToolsDir) { Stop-Build "Cannot locate tools dir; pass -ToolsDir explicitly." }
$root = Split-Path -Parent $ToolsDir
Write-Step ("Project root: " + $root)

if ($script:LogFile) {
  [System.IO.File]::WriteAllText($script:LogFile, "", [System.Text.UTF8Encoding]::new($false))
}

$templatePath = Join-Path $root "src\index.template.html"
$outputPath = Join-Path (Join-Path $root "dist") "MarkdownStudioLite.html"
if (-not (Test-Path $templatePath)) { Stop-Build ("Template not found: " + $templatePath) }
$html = [System.IO.File]::ReadAllText($templatePath, [System.Text.Encoding]::UTF8)
Write-Step ("Template loaded: " + $html.Length + " chars")

# --- 1. Inline CSS ---
$cssFiles = @("app.css", "dark.css", "print.css")
$cssText = foreach ($name in $cssFiles) {
  $path = Join-Path (Join-Path $root "src\styles") $name
  if (-not (Test-Path $path)) { Stop-Build ("Missing stylesheet: " + $path) }
  ([System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)).Replace("</style", "<\/style")
}
$cssBlock = "<style>`n" + ($cssText -join "`n") + "`n</style>"
if (-not $html.Contains("<!-- MDSL:CSS -->")) { Stop-Build "Template missing MDSL:CSS placeholder" }
$html = $html.Replace("<!-- MDSL:CSS -->", $cssBlock)
Write-Step ("CSS inlined: " + $cssFiles.Count + " files")

# --- 2. Inline vendor (fixed order: dependencies first) ---
$vendorFiles = @(
  "marked.min.js",
  "prism.min.js",
  "prism-langs.js",
  "docx.umd.js",
  "temml.min.js",
  "cm6.iife.js"
)
$vendorScripts = foreach ($name in $vendorFiles) {
  $path = Join-Path (Join-Path $root "vendor") $name
  if (-not (Test-Path $path)) { Stop-Build ("Missing vendor file: " + $path) }
  $source = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  $safe = [regex]::Replace($source, "</script", "<\/script", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  "<script>`n$safe`n</script>"
}
$vendorBlock = $vendorScripts -join "`n"
if (-not $html.Contains("<!-- MDSL:VENDOR -->")) { Stop-Build "Template missing MDSL:VENDOR placeholder" }
$html = $html.Replace("<!-- MDSL:VENDOR -->", $vendorBlock)
Write-Step ("Vendor inlined: " + $vendorFiles.Count + " files")

# --- 3. Inject i18n + third-party license text ---
$licenseDir = Join-Path $root "licenses"
$licenseFiles = @(Get-ChildItem -Path $licenseDir -File | Sort-Object Name)
if ($licenseFiles.Count -lt 5) { Stop-Build "Not enough license files" }

$noticeObjects = @()
foreach ($file in $licenseFiles) {
  $text = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
  $noticeObjects += [ordered]@{
    name    = $file.Name
    version = ""
    license = "See full license text below"
    text    = $text
  }
}

function Convert-JsonForScript($value) {
  $json = $value | ConvertTo-Json -Depth 12 -Compress
  # Keep JSON valid while preventing an accidental </script> from closing the tag early.
  return $json.Replace("<", "\u003C").Replace(">", "\u003E").Replace("&", "\u0026")
}

$i18n = [System.IO.File]::ReadAllText((Join-Path $root "lang\zh-CN.json"), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$i18nJson = Convert-JsonForScript $i18n
$noticesJson = Convert-JsonForScript @($noticeObjects)
$i18nBlock = "<script>`nglobalThis.__MDSL_I18N = $i18nJson;`nglobalThis.__MDSL_NOTICES = $noticesJson;`n</script>"
if (-not $html.Contains("<!-- MDSL:I18N -->")) { Stop-Build "Template missing MDSL:I18N placeholder" }
$html = $html.Replace("<!-- MDSL:I18N -->", $i18nBlock)
Write-Step ("i18n + notices injected: " + $licenseFiles.Count + " licenses")

# --- 4. Business modules: ESM -> IIFE (plain string rewriting, no bundler, no regex delegates) ---
$moduleOrder = @(
  "platform.js", "icons.js", "notices.js", "author.js", "slug.js", "sanitizer.js", "shortcuts.js", "help.js",
  "storage.js", "theme.js", "parser.js", "editor.js", "viewer.js", "toc.js",
  "search.js", "previewSearch.js", "imageViewer.js", "desktopBridge.js", "fileService.js", "paginator.js", "print.js", "omml.js", "imageData.js",
  "docxConverter.js", "exportDocx.js", "main.js"
)
$moduleIds = @{}
foreach ($file in $moduleOrder) {
  $moduleIds[$file] = "__mdsl_" + [IO.Path]::GetFileNameWithoutExtension($file)
}

$importPattern = '(?m)^\s*import\s+\{([^}]+)\}\s+from\s+"\./([^"]+)";\s*'
$defPattern = '(?m)^export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)'

$moduleScripts = foreach ($file in $moduleOrder) {
  $path = Join-Path (Join-Path $root "src") $file
  if (-not (Test-Path $path)) { Stop-Build ("Missing source module: " + $path) }
  $source = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

  # Validate every import before rewriting (outside of any delegate / closure).
  foreach ($m in [regex]::Matches($source, $importPattern)) {
    $dep = $m.Groups[2].Value
    if (-not $moduleIds.ContainsKey($dep)) {
      Stop-Build ("Unregistered module dependency: " + $dep + " (in " + $file + ")")
    }
  }
  # Rewrite imports with literal string replacement.
  foreach ($m in [regex]::Matches($source, $importPattern)) {
    $names = $m.Groups[1].Value
    $target = $moduleIds[$m.Groups[2].Value]
    $source = $source.Replace($m.Value, "const {$names} = $target;`n")
  }

  # Collect exported names, then strip the export keyword literally.
  $moduleExports = New-Object System.Collections.Generic.List[string]
  foreach ($m in [regex]::Matches($source, $defPattern)) {
    $moduleExports.Add($m.Groups[1].Value)
    $source = $source.Replace($m.Value, ($m.Value -replace '^export\s+', ''))
  }

  if ($file -eq "main.js") {
    $body = "(async () => {`n$source`n})();"
  } else {
    $exports = $moduleExports -join ","
    if (-not $exports) { Stop-Build ("No exports collected for module " + $file) }
    $body = "const $($moduleIds[$file]) = (() => {`n$source`nreturn {$exports};`n})();"
  }
  [regex]::Replace($body, "</script", "<\/script", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
}
Write-Step ("Modules rewritten: " + $moduleOrder.Count)

$appScript = $moduleScripts -join "`n"
$appBlock = "<script>`n$appScript`n</script>"
if (-not $html.Contains("<!-- MDSL:APP -->")) { Stop-Build "Template missing MDSL:APP placeholder" }
$html = $html.Replace("<!-- MDSL:APP -->", $appBlock)
Write-Step "App script injected"

# --- 5. Static THIRD-PARTY-NOTICES (present in HTML even without JS) ---
$noticeSections = foreach ($file in $licenseFiles) {
  $text = [System.Net.WebUtility]::HtmlEncode([System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8))
  "<section><h3>$($file.Name)</h3><pre>$text</pre></section>"
}
$noticeBlock = "<details class=`"third-party-notices`"><summary>Third-party software licenses</summary>" +
  ($noticeSections -join "`n") + "</details>"
if (-not $html.Contains("<!-- MDSL:NOTICES -->")) { Stop-Build "Template missing MDSL:NOTICES placeholder" }
$html = $html.Replace("<!-- MDSL:NOTICES -->", $noticeBlock)
Write-Step "Static notices injected"

# --- 6. Self-check (fail closed) ---
$problems = @()
if ($html -match "MDSL:(CSS|VENDOR|I18N|APP|NOTICES)") { $problems += "Unreplaced build placeholder" }
if ($html -match '<script\s+type="module"') { $problems += "type=module remains" }
if ($html -match '(?i)(?:src|href)="(?:css|js|vendor|assets|lang)/') { $problems += "External resource reference remains" }
if ($appScript -match '(?m)^\s*(?:import|export)\s') { $problems += "import/export statement remains in app script" }
if ($appScript -match '\bfetch\s*\(' -or $appScript -match "XMLHttpRequest") { $problems += "Network call in app script" }
if (-not $html.Contains("third-party-notices")) { $problems += "Missing THIRD-PARTY-NOTICES" }
if ($noticeObjects.Count -lt 5) { $problems += "Too few license notices" }
if ($problems.Count -gt 0) { Stop-Build ("Self-check failed: " + ($problems -join "; ")) }
Write-Step "Self-check passed"

$outDir = Split-Path -Parent $outputPath
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
[System.IO.File]::WriteAllText($outputPath, $html, [System.Text.UTF8Encoding]::new($false))

# --- 7. Mirror to desktop shell (only when the Tauri project exists) ---
# Same single HTML runs in both places: the desktop bridge auto-detects window.__TAURI__,
# so there is no separate "desktop edition" to keep in sync.
$desktopApp = Join-Path (Join-Path $root "desktop") "app"
if (Test-Path (Split-Path -Parent $desktopApp)) {
  if (-not (Test-Path $desktopApp)) { New-Item -ItemType Directory -Path $desktopApp -Force | Out-Null }
  [System.IO.File]::WriteAllText((Join-Path $desktopApp "index.html"), $html, [System.Text.UTF8Encoding]::new($false))
  Write-Step ("Desktop copy: " + (Join-Path $desktopApp "index.html"))
}

$sizeBytes = (Get-Item $outputPath).Length
$sizeMiB = [Math]::Round($sizeBytes / 1MB, 2)
Write-Step ("Created: " + $outputPath)
Write-Step ("Size: " + $sizeBytes + " bytes (" + $sizeMiB + " MiB)")
Write-Step ("Vendor: " + $vendorFiles.Count + " | Modules: " + $moduleOrder.Count + " | Licenses: " + $noticeObjects.Count)
if ($sizeBytes -gt 3MB) { Stop-Build "Output exceeds 3 MiB hard limit" }
if ($sizeBytes -gt 2MB) { Write-Step "WARNING: output exceeds preferred 2 MiB target" }
Write-Step "BUILD OK"
