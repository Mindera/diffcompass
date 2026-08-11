[CmdletBinding()]
param(
  [switch]$Minimal,
  [switch]$BinaryOnly,
  [switch]$NoMinimal
)

$ErrorActionPreference = "Stop"
$Repository = "rcosteira79/code-review-tour"
$Version = if ($env:CODE_REVIEW_TOUR_VERSION) { $env:CODE_REVIEW_TOUR_VERSION } else { "latest" }
$LocalAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME "AppData\Local" }
$InstallRoot = if ($env:CODE_REVIEW_TOUR_INSTALL_ROOT) { $env:CODE_REVIEW_TOUR_INSTALL_ROOT } else { Join-Path $LocalAppData "code-review-tour" }
$BinRoot = if ($env:CODE_REVIEW_TOUR_BIN_ROOT) { $env:CODE_REVIEW_TOUR_BIN_ROOT } else { Join-Path $InstallRoot "bin" }
$InstallSkills = -not ($Minimal -or $BinaryOnly) -or $NoMinimal
$Architecture = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
  "Arm64" { "arm64" }
  "X64" { "x64" }
  default { throw "Unsupported Windows architecture: $([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)" }
}
$Pattern = "code-review-tour-v*-windows-$Architecture.zip"
$Temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("code-review-tour-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Temporary | Out-Null

function Test-GhAuthentication {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { return $false }
  $PreviousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  & gh auth status *> $null
  $Authenticated = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $PreviousErrorAction
  return $Authenticated
}

try {
  if ($env:CODE_REVIEW_TOUR_ARCHIVE) {
    if (-not (Test-Path -LiteralPath $env:CODE_REVIEW_TOUR_ARCHIVE -PathType Leaf)) { throw "Local release archive not found: $env:CODE_REVIEW_TOUR_ARCHIVE" }
    Copy-Item -LiteralPath $env:CODE_REVIEW_TOUR_ARCHIVE -Destination $Temporary
    $ChecksumSource = Join-Path (Split-Path $env:CODE_REVIEW_TOUR_ARCHIVE) "checksums.txt"
    if (-not (Test-Path -LiteralPath $ChecksumSource -PathType Leaf)) { throw "checksums.txt must be beside the local release archive." }
    Copy-Item -LiteralPath $ChecksumSource -Destination (Join-Path $Temporary "checksums.txt")
  } elseif (Test-GhAuthentication) {
    $Arguments = @("release", "download")
    if ($Version -ne "latest") { $Arguments += $Version }
    $Arguments += @("--repo", $Repository, "--pattern", $Pattern, "--pattern", "checksums.txt", "--dir", $Temporary)
    & gh @Arguments
    if ($LASTEXITCODE -ne 0) { throw "GitHub CLI could not download the release." }
  } else {
    if ($Version -eq "latest") { throw "Installing the latest private release requires authenticated GitHub CLI, or set CODE_REVIEW_TOUR_VERSION=vX.Y.Z." }
    $ArchiveName = "code-review-tour-$Version-windows-$Architecture.zip"
    $ReleaseUrl = "https://github.com/$Repository/releases/download/$Version"
    Invoke-WebRequest -UseBasicParsing "$ReleaseUrl/$ArchiveName" -OutFile (Join-Path $Temporary $ArchiveName)
    Invoke-WebRequest -UseBasicParsing "$ReleaseUrl/checksums.txt" -OutFile (Join-Path $Temporary "checksums.txt")
  }

  $Archive = Get-ChildItem -LiteralPath $Temporary -Filter $Pattern | Select-Object -First 1
  if (-not $Archive) { throw "No release archive found for windows-$Architecture." }
  $ChecksumLine = Get-Content (Join-Path $Temporary "checksums.txt") | Where-Object { $_ -match "\s(?:\./)?$([regex]::Escape($Archive.Name))$" } | Select-Object -First 1
  if (-not $ChecksumLine) { throw "No checksum found for $($Archive.Name)." }
  $Expected = ($ChecksumLine -split "\s+")[0].ToLowerInvariant()
  $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Archive.FullName).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "Checksum verification failed for $($Archive.Name)." }

  Expand-Archive -LiteralPath $Archive.FullName -DestinationPath $Temporary
  $PackageRoot = Get-ChildItem -LiteralPath $Temporary -Directory -Filter "code-review-tour-v*-windows-$Architecture" | Select-Object -First 1
  if (-not $PackageRoot -or $PackageRoot.Name -notmatch '^code-review-tour-v(.+)-windows-(?:arm64|x64)$') { throw "The release archive has an unexpected layout." }
  $ReleaseVersion = $Matches[1]
  $VersionRoot = Join-Path $InstallRoot $ReleaseVersion
  New-Item -ItemType Directory -Force -Path $BinRoot | Out-Null
  if (-not (Test-Path (Join-Path $VersionRoot "bin\code-review-tour.exe"))) {
    New-Item -ItemType Directory -Force -Path (Join-Path $VersionRoot "bin"), (Join-Path $VersionRoot "share") | Out-Null
    Copy-Item -Recurse -Force -Path (Join-Path $PackageRoot.FullName "bin\*") -Destination (Join-Path $VersionRoot "bin")
    Copy-Item -Recurse -Force -Path (Join-Path $PackageRoot.FullName "share\*") -Destination (Join-Path $VersionRoot "share")
  }

  $HistoryPath = Join-Path $InstallRoot "history"
  $History = @()
  if (Test-Path $HistoryPath) { $History = @(Get-Content $HistoryPath | Where-Object { $_ }) }
  $History = @($History | Where-Object { $_ -ne $ReleaseVersion }) + $ReleaseVersion
  $History | Set-Content -Encoding ASCII $HistoryPath
  Set-Content -Encoding ASCII (Join-Path $InstallRoot "install-mode") $(if ($InstallSkills) { "full" } else { "minimal" })
  Set-Content -Encoding ASCII (Join-Path $InstallRoot "current-version") $ReleaseVersion
  $Launcher = "@echo off`r`nset /p CRT_VERSION=<`"$InstallRoot\current-version`"`r`n`"$InstallRoot\%CRT_VERSION%\bin\code-review-tour.exe`" %*`r`n"
  Set-Content -Encoding ASCII (Join-Path $BinRoot "code-review-tour.cmd") $Launcher
  Set-Content -Encoding ASCII (Join-Path $BinRoot ".code-review-tour-managed") $InstallRoot

  function Install-Skill([string]$Root) {
    $Target = Join-Path $Root "code-review-tour"
    $Marker = Join-Path $Target ".code-review-tour-managed"
    if ((Test-Path $Target) -and -not (Test-Path $Marker)) {
      Write-Warning "Existing skill was preserved instead of overwritten: $Target"
      return $false
    }
    if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
    New-Item -ItemType Directory -Force -Path $Root | Out-Null
    Copy-Item -Recurse -Force (Join-Path $VersionRoot "share\code-review-tour\skills\code-review-tour") $Target
    Set-Content -Encoding ASCII $Marker $InstallRoot
    return $true
  }

  $SkillError = $false
  if ($InstallSkills) {
    $CodexRoot = if ($env:CODE_REVIEW_TOUR_CODEX_SKILL_ROOT) { $env:CODE_REVIEW_TOUR_CODEX_SKILL_ROOT } elseif ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME "skills" } else { Join-Path $HOME ".codex\skills" }
    $ClaudeRoot = if ($env:CODE_REVIEW_TOUR_CLAUDE_SKILL_ROOT) { $env:CODE_REVIEW_TOUR_CLAUDE_SKILL_ROOT } else { Join-Path $HOME ".claude\skills" }
    $GeminiRoot = if ($env:CODE_REVIEW_TOUR_GEMINI_SKILL_ROOT) { $env:CODE_REVIEW_TOUR_GEMINI_SKILL_ROOT } else { Join-Path $HOME ".gemini\skills" }
    $CopilotRoot = if ($env:CODE_REVIEW_TOUR_COPILOT_SKILL_ROOT) { $env:CODE_REVIEW_TOUR_COPILOT_SKILL_ROOT } elseif ($env:COPILOT_HOME) { Join-Path $env:COPILOT_HOME "skills" } else { Join-Path $HOME ".copilot\skills" }
    foreach ($Root in @($CodexRoot, $ClaudeRoot, $GeminiRoot, $CopilotRoot)) { if (-not (Install-Skill $Root)) { $SkillError = $true } }
  }

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $UserPath) { $UserPath = "" }
  if (-not $env:CODE_REVIEW_TOUR_NO_PATH_UPDATE -and ($UserPath -split ';') -notcontains $BinRoot) {
    [Environment]::SetEnvironmentVariable("Path", (($UserPath.TrimEnd(';') + ";" + $BinRoot).TrimStart(';')), "User")
    Write-Host "Added $BinRoot to your user PATH. Open a new terminal to use it."
  }
  Write-Host "Installed Code Review Tour $ReleaseVersion"
  Write-Host "Command: $(Join-Path $BinRoot 'code-review-tour.cmd')"
  if (-not $InstallSkills) { Write-Host "Skills: skipped (--minimal)" }
  if ($SkillError) { throw "One or more agent skills already existed and were preserved." }
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Temporary
}
