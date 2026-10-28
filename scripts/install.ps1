[CmdletBinding(PositionalBinding = $false)]
param(
  [switch]$Minimal,
  [switch]$BinaryOnly,
  [switch]$NoMinimal,
  [string]$Version
)

& {
  Set-StrictMode -Off
  $ErrorActionPreference = "Stop"
  $ProgressPreference = "SilentlyContinue"
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $Repository = "Mindera/diffcompass"
  if (-not $Version) { $Version = if ($env:DIFFCOMPASS_VERSION) { $env:DIFFCOMPASS_VERSION } else { "latest" } }
  $VersionPattern = '^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$'
  if ($Version -ne "latest") {
    $Version = "v" + ($Version -replace '^v', '')
    if ($Version -notmatch $VersionPattern) { throw "Unsupported DiffCompass version: $Version. Use vX.Y.Z." }
  }
  $LocalAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME "AppData\Local" }
  $InstallRoot = if ($env:DIFFCOMPASS_INSTALL_ROOT) { $env:DIFFCOMPASS_INSTALL_ROOT } else { Join-Path $LocalAppData "diffcompass" }
  $BinRoot = if ($env:DIFFCOMPASS_BIN_ROOT) { $env:DIFFCOMPASS_BIN_ROOT } else { Join-Path $InstallRoot "bin" }
  $InstallSkills = -not ($Minimal -or $BinaryOnly) -or $NoMinimal
  $Architecture = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
    "Arm64" { "arm64" }
    "X64" { "x64" }
    default { throw "Unsupported Windows architecture: $([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)" }
  }
  $Pattern = "diffcompass-v*-windows-$Architecture.zip"
  $Temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("diffcompass-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $Temporary | Out-Null

  try {
    if ($env:DIFFCOMPASS_ARCHIVE) {
      if (-not (Test-Path -LiteralPath $env:DIFFCOMPASS_ARCHIVE -PathType Leaf)) { throw "Local release archive not found: $env:DIFFCOMPASS_ARCHIVE" }
      Copy-Item -LiteralPath $env:DIFFCOMPASS_ARCHIVE -Destination $Temporary
      $ChecksumSource = Join-Path (Split-Path $env:DIFFCOMPASS_ARCHIVE) "checksums.txt"
      if (-not (Test-Path -LiteralPath $ChecksumSource -PathType Leaf)) { throw "checksums.txt must be beside the local release archive." }
      Copy-Item -LiteralPath $ChecksumSource -Destination (Join-Path $Temporary "checksums.txt")
    } else {
      if ($Version -eq "latest") {
        $Latest = Invoke-WebRequest -UseBasicParsing -Method Head -Uri "https://github.com/$Repository/releases/latest"
        $LatestUri = if ($Latest.BaseResponse.ResponseUri) { $Latest.BaseResponse.ResponseUri } else { $Latest.BaseResponse.RequestMessage.RequestUri }
        $Version = "$LatestUri" -replace '^.*/releases/tag/', ''
        if ("$LatestUri" -notmatch '/releases/tag/' -or $Version -notmatch $VersionPattern) { throw "Could not resolve the latest DiffCompass release from $LatestUri." }
      }
      $ArchiveName = "diffcompass-$Version-windows-$Architecture.zip"
      $ReleaseUrl = "https://github.com/$Repository/releases/download/$Version"
      Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseUrl/$ArchiveName" -OutFile (Join-Path $Temporary $ArchiveName)
      Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseUrl/checksums.txt" -OutFile (Join-Path $Temporary "checksums.txt")
    }

    $Archive = Get-ChildItem -LiteralPath $Temporary -Filter $Pattern | Select-Object -First 1
    if (-not $Archive) { throw "No release archive found for windows-$Architecture." }
    $ChecksumLine = Get-Content (Join-Path $Temporary "checksums.txt") | Where-Object { $_ -match "\s(?:\./)?$([regex]::Escape($Archive.Name))$" } | Select-Object -First 1
    if (-not $ChecksumLine) { throw "No checksum found for $($Archive.Name)." }
    $Expected = ($ChecksumLine -split "\s+")[0].ToLowerInvariant()
    $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Archive.FullName).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected) { throw "Checksum verification failed for $($Archive.Name)." }

    Expand-Archive -LiteralPath $Archive.FullName -DestinationPath $Temporary
    $PackageRoot = Get-ChildItem -LiteralPath $Temporary -Directory -Filter "diffcompass-v*-windows-$Architecture" | Select-Object -First 1
    if (-not $PackageRoot -or $PackageRoot.Name -notmatch '^diffcompass-v(.+)-windows-(?:arm64|x64)$') { throw "The release archive has an unexpected layout." }
    $ReleaseVersion = $Matches[1]
    $VersionRoot = Join-Path $InstallRoot $ReleaseVersion
    New-Item -ItemType Directory -Force -Path $BinRoot | Out-Null
    if (-not (Test-Path (Join-Path $VersionRoot "bin\diffcompass.exe"))) {
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
    $Launcher = "@echo off`r`nset /p CRT_VERSION=<`"$InstallRoot\current-version`"`r`n`"$InstallRoot\%CRT_VERSION%\bin\diffcompass.exe`" %*`r`n"
    Set-Content -Encoding ASCII (Join-Path $BinRoot "diffcompass.cmd") $Launcher
    Set-Content -Encoding ASCII (Join-Path $BinRoot ".diffcompass-managed") $InstallRoot

    function Install-Skill([string]$Root) {
      $Target = Join-Path $Root "diffcompass"
      $Marker = Join-Path $Target ".diffcompass-managed"
      if ((Test-Path $Target) -and -not (Test-Path $Marker)) {
        Write-Warning "Existing skill was preserved instead of overwritten: $Target"
        return $false
      }
      if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
      New-Item -ItemType Directory -Force -Path $Root | Out-Null
      Copy-Item -Recurse -Force (Join-Path $VersionRoot "share\diffcompass\skills\diffcompass") $Target
      Set-Content -Encoding ASCII $Marker $InstallRoot
      return $true
    }

    $SkillError = $false
    if ($InstallSkills) {
      $CodexRoot = if ($env:DIFFCOMPASS_CODEX_SKILL_ROOT) { $env:DIFFCOMPASS_CODEX_SKILL_ROOT } elseif ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME "skills" } else { Join-Path $HOME ".codex\skills" }
      $ClaudeRoot = if ($env:DIFFCOMPASS_CLAUDE_SKILL_ROOT) { $env:DIFFCOMPASS_CLAUDE_SKILL_ROOT } else { Join-Path $HOME ".claude\skills" }
      $GeminiRoot = if ($env:DIFFCOMPASS_GEMINI_SKILL_ROOT) { $env:DIFFCOMPASS_GEMINI_SKILL_ROOT } else { Join-Path $HOME ".gemini\skills" }
      $CopilotRoot = if ($env:DIFFCOMPASS_COPILOT_SKILL_ROOT) { $env:DIFFCOMPASS_COPILOT_SKILL_ROOT } elseif ($env:COPILOT_HOME) { Join-Path $env:COPILOT_HOME "skills" } else { Join-Path $HOME ".copilot\skills" }
      foreach ($Root in @($CodexRoot, $ClaudeRoot, $GeminiRoot, $CopilotRoot)) { if (-not (Install-Skill $Root)) { $SkillError = $true } }
    }

    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $UserPath) { $UserPath = "" }
    if (-not $env:DIFFCOMPASS_NO_PATH_UPDATE -and ($UserPath -split ';') -notcontains $BinRoot) {
      [Environment]::SetEnvironmentVariable("Path", (($UserPath.TrimEnd(';') + ";" + $BinRoot).TrimStart(';')), "User")
      Write-Host "Added $BinRoot to your user PATH. Open a new terminal to use it."
    }
    Write-Host "Installed DiffCompass $ReleaseVersion"
    Write-Host "Command: $(Join-Path $BinRoot 'diffcompass.cmd')"
    if (-not $InstallSkills) { Write-Host "Skills: skipped (--minimal)" }
    if ($SkillError) { throw "One or more agent skills already existed and were preserved." }
  } finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Temporary
  }
}
