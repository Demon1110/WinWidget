<#
.SYNOPSIS
    Convert widget preview PNG/JPEG files to WebP for the control center.

.DESCRIPTION
    The app displays whatever the manifest points at, and the preview loader accepts a PNG/JPEG
    next to a missing WebP. This script is only a developer convenience: it is not bundled into
    the exe, so using ImageMagick here does not add to the shipped binary.

    Point -Path at one file or a widget folder. A folder is searched recursively for
    .png/.jpg/.jpeg and each one gets a sibling .webp with the same stem.

.PARAMETER Path
    A preview file or a folder to scan recursively.

.PARAMETER Quality
    WebP quality, 1-100. Default 90.

.PARAMETER Width
    Optional maximum width in pixels. Images are only downscaled, never enlarged.

.PARAMETER Force
    Overwrite an existing .webp instead of skipping it.

.EXAMPLE
    pwsh -File scripts/preview-to-webp.ps1 -Path assets/widgets/bluetooth/preview

.EXAMPLE
    pwsh -File scripts/preview-to-webp.ps1 -Path assets/widgets -Width 900 -Force
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [ValidateRange(1, 100)]
    [int]$Quality = 90,
    [int]$Width = 0,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Find-Magick {
    $cmd = Get-Command magick -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $roots = @(
        "$env:ProgramFiles\ImageMagick-*\magick.exe",
        "${env:ProgramFiles(x86)}\ImageMagick-*\magick.exe"
    )
    foreach ($pattern in $roots) {
        $hit = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

$target = (Resolve-Path -LiteralPath $Path).Path
$magick = Find-Magick
if (-not $magick) {
    Write-Host "未找到 ImageMagick 的 magick。"
    Write-Host "可以继续使用 PNG：把 widget.json 的 preview 指向 .png，或保留 .webp 路径并在旁边放同名 .png；"
    Write-Host "客户端会自动回退到 PNG/JPEG。安装 ImageMagick 后重跑本脚本即可批量转换。"
    exit 2
}

$files = if (Test-Path -LiteralPath $target -PathType Container) {
    Get-ChildItem -LiteralPath $target -Recurse -File |
        Where-Object { $_.Extension -match '^\.(png|jpe?g)$' }
} else {
    Get-Item -LiteralPath $target |
        Where-Object { $_.Extension -match '^\.(png|jpe?g)$' }
}

if (-not $files) {
    Write-Host "没有找到可转换的 PNG/JPEG：$target"
    exit 0
}

$converted = 0
$skipped = 0
foreach ($file in $files) {
    $out = [System.IO.Path]::ChangeExtension($file.FullName, ".webp")
    if ((Test-Path -LiteralPath $out) -and -not $Force) {
        Write-Host "skip  $($file.FullName) (already has .webp)"
        $skipped++
        continue
    }

    $magickArgs = @($file.FullName, "-auto-orient", "-strip", "-quality", "$Quality")
    if ($Width -gt 0) { $magickArgs += @("-resize", "${Width}>") }
    $magickArgs += @("-define", "webp:method=6", "-define", "webp:alpha-quality=100", $out)

    & $magick @magickArgs
    if ($LASTEXITCODE -ne 0) { throw "ImageMagick failed: $($file.FullName)" }
    $size = (Get-Item -LiteralPath $out).Length
    Write-Host ("ok    {0} -> {1} ({2:N0} B)" -f $file.Name, [System.IO.Path]::GetFileName($out), $size)
    $converted++
}

Write-Host "done: $converted converted, $skipped skipped"
