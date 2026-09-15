# ============================================================================
# build-debug.ps1 — 调试签名构建入口（固定 -BuildMode debug -SignMode debug）
# ----------------------------------------------------------------------------
# 签名材料：
#   debug 模式的证书/口令来自 signing.debug.local.json（gitignored；样例
#   signing.debug.local.json.sample）。hvigorfile.ts 在 SIGN_MODE=debug 时读取该文件，
#   并以「仅内存」方式注入 signingConfigs，绝不写回 build-profile.json5。
#
# 适用场景：
#   - 真机调试 / 回归测试。debug 签名的包可以用 hdc 侧载：
#       hdc app install -r electron\build\default\outputs\default\electron-default-signed.hap
#     （release 签名的包无法侧载，会报 not trusted app source，故本地测试一律用本脚本）。
#
# 用法（在工程根目录）：
#   powershell -ExecutionPolicy Bypass -File scripts\build-debug.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\build-debug.ps1 -Task App
#   # 额外参数（-SdkHome / -JbrHome / -NodeHome / -Hvigorw / -DevEcoHome）原样透传给 build-hap.ps1
# ============================================================================

[CmdletBinding()]
param(
    [ValidateSet('Hap', 'App')]
    [string]$Task = 'Hap',

    [string]$JbrHome = '',
    [string]$SdkHome = '',
    [string]$NodeHome = '',
    [string]$Hvigorw = '',
    [string]$DevEcoHome = '',

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)

$ErrorActionPreference = 'Stop'

$hapScript = Join-Path $PSScriptRoot 'build-hap.ps1'
if (-not (Test-Path -LiteralPath $hapScript)) {
    throw "未找到 build-hap.ps1：$hapScript"
}

$forward = @(
    '-ExecutionPolicy', 'Bypass', '-File', $hapScript,
    '-Task', $Task,
    '-BuildMode', 'debug',
    '-SignMode', 'debug'
)
if ($JbrHome)    { $forward += @('-JbrHome', $JbrHome) }
if ($SdkHome)    { $forward += @('-SdkHome', $SdkHome) }
if ($NodeHome)   { $forward += @('-NodeHome', $NodeHome) }
if ($Hvigorw)    { $forward += @('-Hvigorw', $Hvigorw) }
if ($DevEcoHome) { $forward += @('-DevEcoHome', $DevEcoHome) }
if ($ExtraArgs)  { $forward += $ExtraArgs }

Write-Host "=== build-debug: Task=$Task, BuildMode=debug, SignMode=debug ===" -ForegroundColor Green
& powershell @forward
exit $LASTEXITCODE
