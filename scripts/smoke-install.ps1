$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$Root = Join-Path ([System.IO.Path]::GetTempPath()) ("code-review-tour-smoke-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Root | Out-Null

try {
  $Archive = Get-ChildItem dist/release/code-review-tour-v*-windows-x64.zip | Select-Object -First 1
  if (-not $Archive) { throw "Build the Windows release archive before running the smoke test." }
  $env:CODE_REVIEW_TOUR_ARCHIVE = $Archive.FullName
  $env:CODE_REVIEW_TOUR_INSTALL_ROOT = Join-Path $Root "install"
  $env:CODE_REVIEW_TOUR_BIN_ROOT = Join-Path $Root "bin"
  $env:CODE_REVIEW_TOUR_CODEX_SKILL_ROOT = Join-Path $Root "codex\skills"
  $env:CODE_REVIEW_TOUR_CLAUDE_SKILL_ROOT = Join-Path $Root "claude\skills"
  $env:CODE_REVIEW_TOUR_GEMINI_SKILL_ROOT = Join-Path $Root "gemini\skills"
  $env:CODE_REVIEW_TOUR_COPILOT_SKILL_ROOT = Join-Path $Root "copilot\skills"
  $env:CODE_REVIEW_TOUR_STATE_ROOT = Join-Path $Root "state"
  $env:CODE_REVIEW_TOUR_NO_PATH_UPDATE = "1"

  & scripts/install.ps1
  $Command = Join-Path $env:CODE_REVIEW_TOUR_BIN_ROOT "code-review-tour.cmd"
  & $Command --version
  if ($LASTEXITCODE -ne 0) { throw "Installed Windows command failed." }
  & $Command bridge *> $null
  if ($LASTEXITCODE -ne 0) { throw "Bundled bridge command failed." }
  $env:BUN_BE_BUN = "1"
  try {
    & $Command scripts/smoke-archify.ts
    if ($LASTEXITCODE -ne 0) { throw "Installed Archify renderer smoke test failed." }
  } finally { Remove-Item Env:BUN_BE_BUN }
  foreach ($RootName in @("codex", "claude", "gemini", "copilot")) {
    if (-not (Test-Path (Join-Path $Root "$RootName\skills\code-review-tour\.code-review-tour-managed"))) { throw "$RootName skill was not installed as a managed copy." }
  }
  & $Command update --minimal
  if ($LASTEXITCODE -ne 0) { throw "Bundled Windows update failed." }
  $Preview = & $Command uninstall --dry-run
  if (($Preview -join "`n") -notmatch "Review sessions are preserved") { throw "Uninstall preview was incomplete." }
  & $Command uninstall --yes
  if ($LASTEXITCODE -ne 0) { throw "Windows uninstall command failed." }
  for ($Attempt = 0; $Attempt -lt 50 -and (Test-Path $env:CODE_REVIEW_TOUR_INSTALL_ROOT); $Attempt += 1) { Start-Sleep -Milliseconds 100 }
  if (Test-Path $env:CODE_REVIEW_TOUR_INSTALL_ROOT) { throw "Deferred Windows uninstall did not remove the managed install root." }
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Root
}
