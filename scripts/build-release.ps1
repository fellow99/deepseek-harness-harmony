# ============================================================================
# build-release.ps1 — 发布签名构建入口（固定 -BuildMode release -SignMode release）
# ----------------------------------------------------------------------------
# 签名材料：
#   release 模式的证书/口令来自 signing.release.local.json（gitignored；样例
#   signing.release.local.json.sample）。hvigorfile.ts 在 SIGN_MODE=release 时读取该文件，
#   并以「仅内存」方式注入 signingConfigs，绝不写回 build-profile.json5。
#
# 上架要求：
#   - AppGallery（应用市场）只接受用【华为签发的 release 证书 + release 描述文件（provisioning
#     profile / .p7b）】签名的包。debug 材料签出的 .app 无法上架，仅供本地验证。
#   - release 签名的包【无法】通过 hdc 侧载，安装会失败并报
#       signature verification failed due to not trusted app source
#     因此真机调试 / 回归测试请改用 build-debug.ps1（debug 材料 + debug 签名）。
#
# 产物：
#   - App Pack：build\outputs\default\*-signed.app
#     上架时须与符号表一起上传：build\outputs\default\symbol\release\app-symbol.zip
#
# 用法（在工程根目录）：
#   powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1 -Task Hap
#   # 额外参数（-SdkHome / -JbrHome / -NodeHome / -Hvigorw / -DevEcoHome）原样透传给 build-hap.ps1
# ============================================================================

[CmdletBinding()]
param(
    [ValidateSet('Hap', 'App')]
    [string]$Task = 'App',

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
    '-BuildMode', 'release',
    '-SignMode', 'release'
)
if ($JbrHome)    { $forward += @('-JbrHome', $JbrHome) }
if ($SdkHome)    { $forward += @('-SdkHome', $SdkHome) }
if ($NodeHome)   { $forward += @('-NodeHome', $NodeHome) }
if ($Hvigorw)    { $forward += @('-Hvigorw', $Hvigorw) }
if ($DevEcoHome) { $forward += @('-DevEcoHome', $DevEcoHome) }
if ($ExtraArgs)  { $forward += $ExtraArgs }

Write-Host "=== build-release: Task=$Task, BuildMode=release, SignMode=release ===" -ForegroundColor Green
& powershell @forward
exit $LASTEXITCODE
