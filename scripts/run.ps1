<#
.SYNOPSIS
    构建并启动 WinWidget（Windows）。

.DESCRIPTION
    默认用调试配置构建后启动 target\debug\winwidget.exe；加 -Release 改用发布配置。
    构建失败或找不到产物会立刻报错退出，不会悄悄启动上一次的旧 exe。

    资源目录（组件、SDK、主题、控制中心页面、开发文档）优先用 exe 旁边的 assets\，
    找不到就往上找构建目录附近的 assets\，所以从仓库里直接跑不用拷来拷去。

    单实例：已有实例在跑时，新进程会把控制中心交给旧进程然后自己退出，
    于是看不到刚构建的版本 —— 加 -Kill 先结束旧实例再启动。

.PARAMETER Release
    用 release 配置构建并启动（target\release\winwidget.exe）。

.PARAMETER NoBuild
    跳过构建，直接启动已有产物（适合刚 build 完反复调界面）。

.PARAMETER NoLaunch
    只构建并打印产物路径，不启动窗口（适合脚本化冒烟检查）。

.PARAMETER Kill
    启动前先结束正在运行的 winwidget。

.PARAMETER Cli
    后面跟的参数当作命令行传给 exe（list / add <id> / remove <id> / --version），
    执行完就退出，不弹界面。

.EXAMPLE
    pwsh -File scripts/run.ps1
    pwsh -File scripts/run.ps1 -Kill
    pwsh -File scripts/run.ps1 -Release
    pwsh -File scripts/run.ps1 -NoBuild -NoLaunch
    pwsh -File scripts/run.ps1 -Cli list
#>
param(
    [switch]$Release,
    [switch]$NoBuild,
    [switch]$NoLaunch,
    [switch]$Kill,
    [switch]$Cli
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

if ($Kill) {
    $running = Get-Process -Name winwidget -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host ("==> 结束正在运行的实例（PID {0}）" -f ($running.Id -join ", "))
        $running | Stop-Process -Force
        Start-Sleep -Milliseconds 800
    }
}

$profile = if ($Release) { "release" } else { "debug" }

if (-not $NoBuild) {
    $cargoArgs = @("build")
    if ($Release) {
        $cargoArgs += "--release"
    }
    Write-Host ("==> cargo " + ($cargoArgs -join " "))
    & cargo @cargoArgs
    if ($LASTEXITCODE -ne 0) {
        throw "构建失败（exit $LASTEXITCODE）"
    }
}

$exe = Join-Path $root "target\$profile\winwidget.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    throw "缺少产物：$exe（先去掉 -NoBuild 构建一次）"
}

$cliArgs = @($args)
if ($Cli) {
    if ($cliArgs.Count -eq 0) {
        throw "-Cli 后面要跟命令，例如 -Cli list"
    }
    Write-Host ("==> {0} {1}" -f $exe, ($cliArgs -join " "))
    & $exe @cliArgs
    exit $LASTEXITCODE
}

if ($NoLaunch) {
    Write-Host "==> 已构建：$exe"
    return
}

Write-Host "==> 启动：$exe"
Start-Process -FilePath $exe -WorkingDirectory $root
