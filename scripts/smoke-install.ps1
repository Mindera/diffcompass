$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$Root = Join-Path ([System.IO.Path]::GetTempPath()) ("diffcompass-smoke-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Root | Out-Null

try {
  $Archive = Get-ChildItem dist/release/diffcompass-v*-windows-x64.zip | Select-Object -First 1
  if (-not $Archive) { throw "Build the Windows release archive before running the smoke test." }
  $env:DIFFCOMPASS_ARCHIVE = $Archive.FullName
  $env:DIFFCOMPASS_INSTALL_ROOT = Join-Path $Root "install"
  $env:DIFFCOMPASS_BIN_ROOT = Join-Path $Root "bin"
  $env:DIFFCOMPASS_CODEX_SKILL_ROOT = Join-Path $Root "codex\skills"
  $env:DIFFCOMPASS_CLAUDE_SKILL_ROOT = Join-Path $Root "claude\skills"
  $env:DIFFCOMPASS_GEMINI_SKILL_ROOT = Join-Path $Root "gemini\skills"
  $env:DIFFCOMPASS_COPILOT_SKILL_ROOT = Join-Path $Root "copilot\skills"
  $env:DIFFCOMPASS_STATE_ROOT = Join-Path $Root "state"
  $env:DIFFCOMPASS_NO_PATH_UPDATE = "1"

  & scripts/install.ps1
  $Command = Join-Path $env:DIFFCOMPASS_BIN_ROOT "diffcompass.cmd"
  & $Command --version
  if ($LASTEXITCODE -ne 0) { throw "Installed Windows command failed." }
  & $Command bridge *> $null
  if ($LASTEXITCODE -ne 0) { throw "Bundled bridge command failed." }
  $env:BUN_BE_BUN = "1"
  try {
    & $Command scripts/smoke-archify.ts
    if ($LASTEXITCODE -ne 0) { throw "Installed Archify smoke check failed." }
    & $Command scripts/smoke-monaco.ts
    if ($LASTEXITCODE -ne 0) { throw "Installed Monaco renderer smoke test failed." }
  } finally { Remove-Item Env:BUN_BE_BUN }
  foreach ($RootName in @("codex", "claude", "gemini", "copilot")) {
    if (-not (Test-Path (Join-Path $Root "$RootName\skills\diffcompass\.diffcompass-managed"))) { throw "$RootName skill was not installed as a managed copy." }
  }
  & $Command update --minimal
  if ($LASTEXITCODE -ne 0) { throw "Bundled Windows update failed." }
  $Preview = & $Command uninstall --dry-run
  if (($Preview -join "`n") -notmatch "Review sessions are preserved") { throw "Uninstall preview was incomplete." }
  & $Command uninstall --yes
  if ($LASTEXITCODE -ne 0) { throw "Windows uninstall command failed." }
  for ($Attempt = 0; $Attempt -lt 50 -and (Test-Path $env:DIFFCOMPASS_INSTALL_ROOT); $Attempt += 1) { Start-Sleep -Milliseconds 100 }
  if (Test-Path $env:DIFFCOMPASS_INSTALL_ROOT) { throw "Deferred Windows uninstall did not remove the managed install root." }

  Remove-Item Env:DIFFCOMPASS_ARCHIVE
  $PackageVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
  $Tag = "v$PackageVersion"
  $StandInReleases = Join-Path $Root "releases"
  $StandInLog = Join-Path $Root "requests.log"
  $ArchiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Archive.FullName).Hash.ToLowerInvariant()
  foreach ($Release in @($Tag, "v0.0.1", "v0.0.2", "v0.0.3")) { New-Item -ItemType Directory -Force -Path (Join-Path $StandInReleases $Release) | Out-Null }
  Copy-Item -LiteralPath $Archive.FullName, (Join-Path $Archive.DirectoryName "checksums.txt") -Destination (Join-Path $StandInReleases $Tag)
  Copy-Item -LiteralPath $Archive.FullName -Destination (Join-Path $StandInReleases "v0.0.1\diffcompass-v0.0.1-windows-x64.zip")
  Set-Content -Encoding ASCII (Join-Path $StandInReleases "v0.0.1\checksums.txt") (("0" * 64) + "  diffcompass-v0.0.1-windows-x64.zip")
  Copy-Item -LiteralPath $Archive.FullName -Destination (Join-Path $StandInReleases "v0.0.2\diffcompass-v0.0.2-windows-x64.zip")
  Set-Content -Encoding ASCII (Join-Path $StandInReleases "v0.0.2\checksums.txt") "$ArchiveHash  diffcompass-v0.0.2-windows-arm64.zip"
  Set-Content -Encoding ASCII (Join-Path $StandInReleases "v0.0.3\checksums.txt") "$ArchiveHash  diffcompass-v0.0.3-windows-x64.zip"

  function Invoke-WebRequest {
    param([string]$Uri, [string]$OutFile, [string]$Method, [switch]$UseBasicParsing)
    Add-Content -LiteralPath $StandInLog -Value $Uri
    if ($Uri -eq "https://github.com/Mindera/diffcompass/releases/latest") {
      return [pscustomobject]@{ BaseResponse = [pscustomobject]@{ ResponseUri = [uri]"https://github.com/Mindera/diffcompass/releases/tag/$Tag" } }
    }
    if ($Uri -match '^https://github\.com/Mindera/diffcompass/releases/download/([^/]+)/([^/]+)$') {
      $Source = Join-Path (Join-Path $StandInReleases $Matches[1]) $Matches[2]
      if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "The remote server returned an error: (404) Not Found." }
      Copy-Item -LiteralPath $Source -Destination $OutFile
      return
    }
    throw "Unexpected request: $Uri"
  }

  $env:DIFFCOMPASS_INSTALL_ROOT = Join-Path $Root "stand-in\install"
  $env:DIFFCOMPASS_BIN_ROOT = Join-Path $Root "stand-in\bin"
  $env:DIFFCOMPASS_CODEX_SKILL_ROOT = Join-Path $Root "stand-in\codex\skills"
  $env:DIFFCOMPASS_CLAUDE_SKILL_ROOT = Join-Path $Root "stand-in\claude\skills"
  $env:DIFFCOMPASS_GEMINI_SKILL_ROOT = Join-Path $Root "stand-in\gemini\skills"
  $env:DIFFCOMPASS_COPILOT_SKILL_ROOT = Join-Path $Root "stand-in\copilot\skills"
  $CurrentVersion = Join-Path $env:DIFFCOMPASS_INSTALL_ROOT "current-version"
  $Download = "https://github.com/Mindera/diffcompass/releases/download/$Tag"
  $TagRequests = @("$Download/diffcompass-$Tag-windows-x64.zip", "$Download/checksums.txt")
  $LatestRequests = @("https://github.com/Mindera/diffcompass/releases/latest") + $TagRequests

  function Confirm-StandInInstall([scriptblock]$Install, [string[]]$Requests) {
    Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $StandInLog
    & $Install
    $Requested = @(Get-Content -LiteralPath $StandInLog)
    if (($Requested -join " ") -ne ($Requests -join " ")) { throw "The installer requested $($Requested -join ', ') instead of $($Requests -join ', ')." }
    if ((Get-Content -Raw -LiteralPath $CurrentVersion).Trim() -ne $PackageVersion) { throw "The stand-in install did not leave DiffCompass $PackageVersion current." }
  }

  Confirm-StandInInstall { & scripts/install.ps1 -Minimal } $LatestRequests
  Confirm-StandInInstall { & scripts/install.ps1 -Minimal -Version $Tag } $TagRequests
  Confirm-StandInInstall { & scripts/install.ps1 -Minimal -Version $PackageVersion } $TagRequests
  $env:DIFFCOMPASS_VERSION = $PackageVersion
  try { Confirm-StandInInstall { & scripts/install.ps1 -Minimal } $TagRequests } finally { Remove-Item Env:DIFFCOMPASS_VERSION }
  Confirm-StandInInstall { & { Invoke-Expression (Get-Content -Raw scripts/install.ps1) } } $LatestRequests

  $StandInLauncher = Join-Path $env:DIFFCOMPASS_BIN_ROOT "diffcompass.cmd"
  $StandInLauncherHash = (Get-FileHash -LiteralPath $StandInLauncher).Hash
  $BrokenReleases = [ordered]@{ "v0.0.1" = "Checksum verification failed"; "v0.0.2" = "No checksum found"; "v0.0.3" = "404" }
  foreach ($BrokenTag in $BrokenReleases.Keys) {
    $Failure = ""
    try { & scripts/install.ps1 -Minimal -Version $BrokenTag } catch { $Failure = $_.Exception.Message }
    if (-not $Failure.Contains($BrokenReleases[$BrokenTag])) { throw "Installing $BrokenTag failed with '$Failure' instead of '$($BrokenReleases[$BrokenTag])'." }
    if ((Get-Content -Raw -LiteralPath $CurrentVersion).Trim() -ne $PackageVersion) { throw "A failed install of $BrokenTag changed the current version." }
    if ((Get-FileHash -LiteralPath $StandInLauncher).Hash -ne $StandInLauncherHash) { throw "A failed install of $BrokenTag changed the launcher." }
    foreach ($BrokenVersion in @("0.0.1", "0.0.2", "0.0.3")) {
      if (Test-Path -LiteralPath (Join-Path $env:DIFFCOMPASS_INSTALL_ROOT $BrokenVersion)) { throw "A failed install of $BrokenTag left $BrokenVersion in the install root." }
    }
  }
  Remove-Item Function:\Invoke-WebRequest
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Root
}
