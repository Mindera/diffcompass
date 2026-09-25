$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$ReleaseRoot = Join-Path (Get-Location) "dist\release"
$Platform = "windows-x64"
$PackageName = "code-review-tour-v$Version-$Platform"
$PackageRoot = Join-Path $ReleaseRoot $PackageName
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $ReleaseRoot
New-Item -ItemType Directory -Force -Path (Join-Path $PackageRoot "bin"), (Join-Path $PackageRoot "share\code-review-tour\skills") | Out-Null

& bun build --compile --minify --target=bun-windows-x64 src/cli.ts --outfile (Join-Path $PackageRoot "bin\code-review-tour.exe")
if ($LASTEXITCODE -ne 0) { throw "Windows executable compilation failed." }
Copy-Item -Recurse skills/code-review-tour (Join-Path $PackageRoot "share\code-review-tour\skills\code-review-tour")
& bun scripts/package-archify.ts (Join-Path $PackageRoot "share\code-review-tour\archify")
if ($LASTEXITCODE -ne 0) { throw "Archify packaging failed." }
Copy-Item scripts/install.sh, scripts/install.ps1 (Join-Path $PackageRoot "share\code-review-tour")
Copy-Item README.md $PackageRoot

$Archive = Join-Path $ReleaseRoot "$PackageName.zip"
Compress-Archive -Path $PackageRoot -DestinationPath $Archive
$Hash = (Get-FileHash -Algorithm SHA256 $Archive).Hash.ToLowerInvariant()
Set-Content -Encoding ASCII (Join-Path $ReleaseRoot "checksums.txt") "$Hash  $PackageName.zip"
Write-Host "Windows release artifact is in $ReleaseRoot"
