# Elastic Beanstalk deployment bundle for Node on Amazon Linux.
# Do NOT use Compress-Archive — it stores backslashes in paths and Linux `unzip` fails on EB.
# This script uses .NET ZipArchive with POSIX-style entry names (forward slashes).

param(
  [string]$Version = "v21"
)

$ErrorActionPreference = "Stop"
$ServerRoot = $PSScriptRoot
$ProjectRoot = Split-Path $ServerRoot -Parent
$OutZip = Join-Path $ProjectRoot "aws-server-eb-posix-$Version.zip"

Set-Location $ServerRoot
Write-Host "==> npm ci"
npm ci
Write-Host "==> npm run build"
npm run build
Write-Host "==> npm prune --omit=dev"
npm prune --omit=dev

$required = @(
  "package.json",
  "package-lock.json",
  "Procfile",
  "dist",
  "node_modules",
  ".ebextensions"
)
foreach ($name in $required) {
  $p = Join-Path $ServerRoot $name
  if (-not (Test-Path $p)) { throw "Missing required path: $p" }
}

if (Test-Path $OutZip) { Remove-Item $OutZip -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$base = (Resolve-Path $ServerRoot).Path.TrimEnd('\')
$zip = [System.IO.Compression.ZipFile]::Open($OutZip, [System.IO.Compression.ZipArchiveMode]::Create)

try {
  foreach ($rel in $required) {
    $full = Join-Path $base $rel
    $item = Get-Item -LiteralPath $full
    if ($item.PSIsContainer) {
      Get-ChildItem -LiteralPath $full -Recurse -File -Force | ForEach-Object {
        $entry = $_.FullName.Substring($base.Length).TrimStart('\').Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
          $zip,
          $_.FullName,
          $entry,
          [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
      }
    }
    else {
      $entry = $item.Name
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip,
        $item.FullName,
        $entry,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  }
}
finally {
  $zip.Dispose()
}

$len = (Get-Item $OutZip).Length
Write-Host ""
Write-Host "OK: $OutZip"
Write-Host ("Size: {0:N0} bytes ({1:N2} MB)" -f $len, ($len / 1MB))
