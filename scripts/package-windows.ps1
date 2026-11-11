<#
.SYNOPSIS
    打包 Windows 运行包（便携版 zip）。

.DESCRIPTION
    cargo build --release 之后，把 winwidget.exe 和整棵 assets\ 装进
    dist\stage\WinWidget-<版本>-windows-x64\，再压成同名 zip 并附 SHA-256。

    assets\ 必须跟着走：组件、SDK、主题、控制中心页面、开发文档都从 exe 旁边的
    assets\ 读。只有 docs\m*（里程碑截图，仓库里的说明素材）被排除，省掉约 13 MB。

    版本号取自 Cargo.toml 的 [package] version，可用 -Version 覆盖（CI 会传入
    prepare 步骤算好的版本）。

.PARAMETER Version
    覆盖版本号（默认取 Cargo.toml 里的 version）。

.PARAMETER SkipBuild
    跳过 cargo build，直接打包已有的 release 产物。

.PARAMETER NoZip
    只生成 dist\stage 目录，不打 zip（方便本地直接跑）。

.PARAMETER Portable
    在包根目录放一个空的 portable 文件：数据（配置、存储、日志）落到 exe 旁边的
    data\，而不是 %APPDATA%\WinWidget。U 盘 / 绿色版用法。

.PARAMETER Upx
    打包前用 UPX 压缩 exe（体积小很多，启动稍慢；部分杀软可能误报）。

.EXAMPLE
    pwsh -File scripts/package-windows.ps1
    pwsh -File scripts/package-windows.ps1 -SkipBuild
    pwsh -File scripts/package-windows.ps1 -Portable
    pwsh -File scripts/package-windows.ps1 -Version 1.1.0
#>
param(
    [string]$Version,
    [switch]$SkipBuild,
    [switch]$NoZip,
    [switch]$Portable,
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

if (-not $SkipBuild) {
    Write-Host "==> cargo build --release"
    cargo build --release
    if ($LASTEXITCODE -ne 0) {
        throw "构建失败（exit $LASTEXITCODE）"
    }
}

$exe = Join-Path $root "target\release\winwidget.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    throw "缺少产物：$exe（先去掉 -SkipBuild 构建一次）"
}

$assets = Join-Path $root "assets"
if (-not (Test-Path -LiteralPath (Join-Path $assets "sdk\base.css"))) {
    throw "缺少资源目录：$assets（打包后程序找不到组件和文档）"
}

$name = "WinWidget-$Version-windows-x64"
$stage = Join-Path $root "dist\stage\$name"
if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Copy-Item -LiteralPath $exe -Destination (Join-Path $stage "winwidget.exe")
Copy-Item -LiteralPath $assets -Destination (Join-Path $stage "assets") -Recurse

# 里程碑截图只是仓库里的说明素材，不进运行包
$docsDir = Join-Path $stage "assets\docs"
if (Test-Path -LiteralPath $docsDir) {
    Get-ChildItem -LiteralPath $docsDir -Directory |
        Where-Object { $_.Name -match '^m\d+$' } |
        Remove-Item -Recurse -Force
}

foreach ($file in @("README.md", "LICENSE")) {
    $src = Join-Path $root $file
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination $stage
    }
}

if ($Portable) {
    New-Item -ItemType File -Path (Join-Path $stage "portable") -Force | Out-Null
}

$exeInfo = Get-Item -LiteralPath (Join-Path $stage "winwidget.exe")
Write-Host ("==> 产物目录：{0}" -f $stage)
Write-Host ("    winwidget.exe  {0:N2} MB" -f ($exeInfo.Length / 1MB))

if ($Upx) {
    $stagedExe = Join-Path $stage "winwidget.exe"
    # 变量名不能叫 $upx，和 -Upx 这个 switch 参数同名（PowerShell 不区分大小写）
    $upxPath = (Get-Command upx -ErrorAction SilentlyContinue).Source
    if (-not $upxPath) {
        throw "未找到 upx，可 winget install UPX.UPX，或去掉 -Upx"
    }
    $before = (Get-Item -LiteralPath $stagedExe).Length
    & $upxPath --best --lzma $stagedExe *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "upx 压缩失败（exit $LASTEXITCODE）"
    }
    $after = (Get-Item -LiteralPath $stagedExe).Length
    Write-Host ("    UPX 压缩：{0:N2} MB -> {1:N2} MB" -f ($before / 1MB), ($after / 1MB))
}

if ($NoZip) {
    return
}

$zip = Join-Path $root "dist\$name.zip"
if (Test-Path -LiteralPath $zip) {
    Remove-Item -LiteralPath $zip -Force
}
Compress-Archive -Path $stage -DestinationPath $zip -Force

$zipInfo = Get-Item -LiteralPath $zip
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
# 校验和随包发布，方便下载后核对
"$hash  $($zipInfo.Name)" | Set-Content -LiteralPath "$zip.sha256" -Encoding ascii
Write-Host ("==> 压缩包：{0}" -f $zip)
Write-Host ("    {0:N2} MB" -f ($zipInfo.Length / 1MB))
Write-Host ("    sha256: {0}" -f $hash)
