<#
.SYNOPSIS
    打包 Windows 发布件：一个自带 assets 的单文件 winwidget.exe。

.DESCRIPTION
    assets\ 整棵（排除 docs\m* 里程碑截图）已经由 build.rs 编进 exe，所以发布件就是
    一个文件：

      dist\WinWidget-<版本>-windows-x64.exe
      dist\WinWidget-<版本>-windows-x64.exe.sha256

    没有 zip，也没有 Inno Setup：复制这个 exe 到哪儿都能直接跑。数据仍在
    %APPDATA%\WinWidget，升级只覆盖 exe 本身。要便携（数据放 exe 旁边的 data\），
    在同目录建一个空的 portable 文件即可。

    应用内更新下载的也是这个 exe，由新副本在旧进程退出后覆盖自己
    （winwidget --apply-update <要替换的 exe>，见 src/platform/update.rs）。

    版本号取自 Cargo.toml 的 [package] version，可用 -Version 覆盖（CI 会传入
    prepare 步骤算好的版本）。

.PARAMETER Version
    覆盖版本号（默认取 Cargo.toml 里的 version）。

.PARAMETER SkipBuild
    跳过 cargo build，直接打包已有的 release 产物。

.PARAMETER Upx
    打包后用 UPX 压缩 exe（体积小很多，启动稍慢；部分杀软可能误报）。

.EXAMPLE
    pwsh -File scripts/package-windows.ps1
    pwsh -File scripts/package-windows.ps1 -SkipBuild
    pwsh -File scripts/package-windows.ps1 -Version 1.1.0 -Upx
#>
param(
    [string]$Version,
    [switch]$SkipBuild,
    [switch]$Upx
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

if (-not $Version) {
    $toml = Get-Content -LiteralPath "Cargo.toml" -Raw
    $match = [regex]::Match($toml, '(?m)^version\s*=\s*"([^"]+)"')
    if (-not $match.Success) {
        throw "无法从 Cargo.toml 解析版本号，请用 -Version 指定"
    }
    $Version = $match.Groups[1].Value
}

$assets = Join-Path $root "assets"
if (-not (Test-Path -LiteralPath (Join-Path $assets "sdk\base.css"))) {
    throw "缺少资源目录：$assets（build.rs 要把它编进 exe）"
}

if (-not $SkipBuild) {
    Write-Host "==> cargo build --release"
    cargo build --release
    if ($LASTEXITCODE -ne 0) {
        throw "构建失败（exit $LASTEXITCODE）"
    }
}

$built = Join-Path $root "target\release\winwidget.exe"
if (-not (Test-Path -LiteralPath $built)) {
    throw "缺少产物：$built（先去掉 -SkipBuild 构建一次）"
}

$name = "WinWidget-$Version-windows-x64"
$out = Join-Path $root "dist\$name.exe"
New-Item -ItemType Directory -Path (Join-Path $root "dist") -Force | Out-Null
if (Test-Path -LiteralPath $out) {
    Remove-Item -LiteralPath $out -Force
}
Copy-Item -LiteralPath $built -Destination $out

# UPX 直接作用在这一个 exe 上；变量名不能叫 $upx，会和 -Upx 这个 switch 撞名
if ($Upx) {
    $upxPath = (Get-Command upx -ErrorAction SilentlyContinue).Source
    if (-not $upxPath) {
        throw "未找到 upx，可 winget install UPX.UPX，或去掉 -Upx"
    }
    $before = (Get-Item -LiteralPath $out).Length
    & $upxPath --best --lzma $out *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "upx 压缩失败（exit $LASTEXITCODE）"
    }
    $after = (Get-Item -LiteralPath $out).Length
    Write-Host ("    UPX 压缩：{0:N2} MB -> {1:N2} MB" -f ($before / 1MB), ($after / 1MB))
}

# 自检：把 exe 放到一个没有 assets\ 的临时目录里跑 `list`。能列出内置组件，才说明
# assets 真的在 exe 里，而不是从仓库的 assets\ 捡到的。
$probe = Join-Path ([System.IO.Path]::GetTempPath()) ("ww-single-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $probe -Force | Out-Null
try {
    $probeExe = Join-Path $probe "winwidget.exe"
    Copy-Item -LiteralPath $out -Destination $probeExe
    $listing = & $probeExe list 2>&1 | Out-String
    $count = ([regex]::Matches($listing, '(?m)^widget\s{2}')).Count
    if ($count -lt 30) {
        throw "单文件自检失败：脱离 assets\ 只列出 $count 个内置组件（应为 30+）。构建产物没把 assets 编进去。`n$listing"
    }
    Write-Host ("==> 单文件自检：脱离 assets\ 仍列出 {0} 个内置组件" -f $count)
}
finally {
    Remove-Item -LiteralPath $probe -Recurse -Force -ErrorAction SilentlyContinue
}

$info = Get-Item -LiteralPath $out
$hash = (Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash.ToLower()
# 校验和随包发布，方便下载后核对
"$hash  $($info.Name)" | Set-Content -LiteralPath "$out.sha256" -Encoding ascii
Write-Host ("==> 发布件：{0}" -f $out)
Write-Host ("    {0:N2} MB" -f ($info.Length / 1MB))
Write-Host ("    sha256: {0}" -f $hash)
