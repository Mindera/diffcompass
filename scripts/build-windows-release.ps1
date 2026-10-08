$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$ReleaseRoot = Join-Path (Get-Location) "dist\release"
$Platform = "windows-x64"
$PackageName = "diffcompass-v$Version-$Platform"
$PackageRoot = Join-Path $ReleaseRoot $PackageName
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $ReleaseRoot
New-Item -ItemType Directory -Force -Path (Join-Path $PackageRoot "bin"), (Join-Path $PackageRoot "share\diffcompass\skills") | Out-Null

& bun build --compile --minify --target=bun-windows-x64 src/cli.ts --outfile (Join-Path $PackageRoot "bin\diffcompass.exe")
if ($LASTEXITCODE -ne 0) { throw "Windows executable compilation failed." }
Copy-Item -Recurse skills/diffcompass (Join-Path $PackageRoot "share\diffcompass\skills\diffcompass")
& bun scripts/package-archify.ts (Join-Path $PackageRoot "share\diffcompass\archify")
if ($LASTEXITCODE -ne 0) { throw "Archify packaging failed." }
& bun scripts/package-monaco.ts (Join-Path $PackageRoot "share\diffcompass\monaco")
if ($LASTEXITCODE -ne 0) { throw "Monaco packaging failed." }
Copy-Item scripts/install.sh, scripts/install.ps1 (Join-Path $PackageRoot "share\diffcompass")
Copy-Item README.md $PackageRoot

$Archive = Join-Path $ReleaseRoot "$PackageName.zip"
Compress-Archive -Path $PackageRoot -DestinationPath $Archive
$Hash = (Get-FileHash -Algorithm SHA256 $Archive).Hash.ToLowerInvariant()
Set-Content -Encoding ASCII (Join-Path $ReleaseRoot "checksums.txt") "$Hash  $PackageName.zip"
Write-Host "Windows release artifact is in $ReleaseRoot"
