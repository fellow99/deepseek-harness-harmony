# ============================================================================
# build-hap.ps1 — 用 DevEco 自带 JBR 构建并签名 HAP（命令行可复现）
# ----------------------------------------------------------------------------
# 为什么需要本脚本：
#   SignHap 阶段会调用 hap-sign-tool.jar 读取/重写 HAP(zip)。若命令行 PATH 上的
#   java 是早期 Temurin/OpenJDK 21（如 sdkman current = Temurin-21+35），其严格的
#   ZIP64 extra 校验会误报：
#       ERROR 11012006 File IO failed
#       Invalid CEN header (invalid zip64 extra data field size)
#   而 DevEco Studio 自带的 JBR 21.0.8 可正常签名。hvigor 通过 PATH（而非仅
#   JAVA_HOME）解析 java，因此本脚本把 JBR 的 bin 放到 PATH 最前面，并剔除
#   sdkman 的 java，再执行 hvigorw。
#
# 签名材料：
#   证书/口令不在本脚本，也不在 build-profile.json5（已外置，见 hvigorfile.ts）：
#     - signing.local.json （gitignored，样例 signing.local.json.sample）
#     - .ohos/config/ 下 .p12/.cer/.p7b + material 密钥链（gitignored）
#
# 用法（在工程根目录）：
#   powershell -ExecutionPolicy Bypass -File scripts\build-hap.ps1
#   # 可选参数：
#   #   -BuildMode debug|release     默认 debug
#   #   -JbrHome  <JBR 根目录>        默认从常见 DevEco 安装路径探测
#   #   -SdkHome  <sdk 目录>          默认 D:\oh-workspace\deveco-studio-6\sdk
#   #   -NodeHome <node 目录>         默认 <DevEco>\tools\node
# ============================================================================

[CmdletBinding()]
param(
    [ValidateSet('debug', 'release')]
    [string]$BuildMode = 'debug',

    [string]$JbrHome  = $(if ($env:DEVECO_JBR_HOME) { $env:DEVECO_JBR_HOME } else { '' }),
    [string]$SdkHome  = $(if ($env:DEVECO_SDK_HOME) { $env:DEVECO_SDK_HOME } else { '' }),
    [string]$NodeHome = $(if ($env:NODE_HOME) { $env:NODE_HOME } else { '' }),

    [string]$Hvigorw = 'D:\oh-workspace\command-line-tools-6\bin\hvigorw.bat',
    [string]$DevEcoHome = 'D:\oh-workspace\deveco-studio-6'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

# --- 1. 解析 JBR -------------------------------------------------------------
if (-not $JbrHome) {
    $candidates = @(
        (Join-Path $DevEcoHome 'jbr'),
        'D:\oh-workspace\deveco-studio-6\jbr'
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath (Join-Path $c 'bin\java.exe'))) {
            $JbrHome = $c
            break
        }
    }
}
if (-not $JbrHome -or -not (Test-Path -LiteralPath (Join-Path $JbrHome 'bin\java.exe'))) {
    throw "未找到 DevEco 自带 JBR（bin\java.exe）。请用 -JbrHome 或环境变量 DEVECO_JBR_HOME 指定。"
}

# --- 2. 解析 SDK / Node ------------------------------------------------------
if (-not $SdkHome)  { $SdkHome  = Join-Path $DevEcoHome 'sdk' }
if (-not $NodeHome) { $NodeHome = Join-Path $DevEcoHome 'tools\node' }
if (-not (Test-Path $SdkHome))  { throw "SDK 目录不存在：$SdkHome（用 -SdkHome 或 DEVECO_SDK_HOME 指定）" }
if (-not (Test-Path $NodeHome)) { throw "Node 目录不存在：$NodeHome（用 -NodeHome 或 NODE_HOME 指定）" }
if (-not (Test-Path $Hvigorw))  { throw "hvigorw.bat 不存在：$Hvigorw（用 -Hvigorw 指定）" }

# --- 3. 组装干净 PATH：JBR 在前，剔除其它 JDK（sdkman / Temurin 等） --------
$jbrBin   = Join-Path $JbrHome 'bin'
$toolBin  = Split-Path -Parent $Hvigorw
$kept = ($env:PATH -split ';') | Where-Object {
    $_ -and ($_ -notlike '*\.sdkman\candidates\java\*') -and
    ($_ -notlike '*\temurin*') -and ($_ -ne $jbrBin)
}
$env:PATH = (@($jbrBin, $toolBin, $NodeHome) + $kept) -join ';'
$env:JAVA_HOME       = $JbrHome
$env:DEVECO_SDK_HOME = $SdkHome
$env:NODE_HOME       = $NodeHome

Write-Host "JBR        : $jbrBin" -ForegroundColor Cyan
Write-Host "java -version:" -ForegroundColor Cyan
& (Join-Path $jbrBin 'java.exe') -version

# --- 4. 签名材料自检（仅提示，不阻断；缺失时 hvigorfile 会跳过注入） ---------
if (-not (Test-Path (Join-Path $projectRoot 'signing.local.json'))) {
    Write-Warning "未找到 signing.local.json：将不注入签名配置（产出未签名/IDE 自动调试签名）。"
}

# --- 5. 执行 hvigor 构建 ------------------------------------------------------
Write-Host "`n=== hvigorw assembleHap (buildMode=$BuildMode) ===" -ForegroundColor Green
& $Hvigorw assembleHap --mode module -p product=default -p buildMode=$BuildMode --no-daemon
if ($LASTEXITCODE -ne 0) { throw "hvigorw 构建失败（exit $LASTEXITCODE）" }

$hap = Join-Path $projectRoot 'electron\build\default\outputs\default\electron-default-signed.hap'
if (Test-Path $hap) {
    $size = [math]::Round((Get-Item $hap).Length / 1MB, 1)
    Write-Host "`n✅ 已签名 HAP：$hap ($size MB)" -ForegroundColor Green
} else {
    Write-Warning "构建成功但未找到 signed.hap：$hap"
}
