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
#     - SIGN_MODE 环境变量选择签名模式（debug | release）；本脚本由 -SignMode 解析后设置，
#       hvigorw 子进程继承它。
#     - hvigorfile.ts 按 SIGN_MODE 读取对应文件并注入 signingConfigs（仅内存，绝不写盘）：
#         debug   → signing.debug.local.json   （gitignored，样例 signing.debug.local.json.sample）
#         release → signing.release.local.json （gitignored，样例 signing.release.local.json.sample）
#     - 材料文件指向 .p12/.cer/.p7b + 同级 material 密钥链（gitignored）。
#
# 用法（在工程根目录）：
#   powershell -ExecutionPolicy Bypass -File scripts\build-hap.ps1
#   # 可选参数：
#   #   -Task Hap|App                 默认 Hap；App=应用级 App Pack（应用市场上架用 .app）
#   #   -BuildMode debug|release      默认 debug（App 上架应使用 release）
#   #   -SignMode auto|debug|release  默认 auto（跟随 -BuildMode）；决定 hvigorfile.ts 用哪份签名材料
#   #   -JbrHome  <JBR 根目录>        默认从常见 DevEco 安装路径探测
#   #   -SdkHome  <sdk 目录>          默认 D:\oh-workspace\deveco-studio-6\sdk
#   #   -NodeHome <node 目录>         默认 <DevEco>\tools\node
#
# 任务说明：
#   Hap → hvigor `assembleHap --mode module`，产出 electron\build\default\outputs\default\electron-default-signed.hap（真机装机）
#   App → hvigor `assembleApp  --mode project`，产出 build\outputs\default\*-signed.app（应用市场提交）
#         注意：应用市场只接受「发布证书 + 发布 Profile」签名的包，必须 -SignMode release。调试材料签出的
#         .app 仅可用于本地验证，无法上架。签名材料经 SIGN_MODE 选择（见 hvigorfile.ts）。
#   构建成功后本脚本会用 hap-sign-tool verify-app 校验产物内嵌 Profile 的 type 是否与 -SignMode 一致，
#   不一致直接报错退出（防止 release 构建被静默用 debug 材料签名）。
# ============================================================================

[CmdletBinding()]
param(
    [ValidateSet('Hap', 'App')]
    [string]$Task = 'Hap',

    [ValidateSet('debug', 'release')]
    [string]$BuildMode = 'debug',

    # auto = 跟随 -BuildMode；也允许显式指定（例如 release 编译 + debug 材料签名，用于真机回归）
    [ValidateSet('auto', 'debug', 'release')]
    [string]$SignMode = 'auto',

    [string]$JbrHome  = $(if ($env:DEVECO_JBR_HOME) { $env:DEVECO_JBR_HOME } else { '' }),
    [string]$SdkHome  = $(if ($env:DEVECO_SDK_HOME) { $env:DEVECO_SDK_HOME } else { '' }),
    [string]$NodeHome = $(if ($env:NODE_HOME) { $env:NODE_HOME } else { '' }),

    [string]$Hvigorw = 'D:\oh-workspace\command-line-tools-6\bin\hvigorw.bat',
    [string]$DevEcoHome = 'D:\oh-workspace\deveco-studio-6'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

# --- 0. 解析签名模式 ---------------------------------------------------------
# auto（默认）跟随 -BuildMode（安全默认）；也可显式指定，例如 release 编译 + debug 签名
# （release-signed 包无法侧载，真机回归须用 debug 材料签名）。
if ($SignMode -eq 'auto') { $SignMode = $BuildMode }
# 让 hvigorw 子进程继承，hvigorfile.ts 据此读取 signing.<mode>.local.json 注入签名配置。
$env:SIGN_MODE = $SignMode

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
Write-Host "SignMode   : $SignMode  (task=$Task, buildMode=$BuildMode)" -ForegroundColor Cyan
Write-Host "java -version:" -ForegroundColor Cyan
& (Join-Path $jbrBin 'java.exe') -version

# --- 4. 签名材料自检（仅提示，不阻断；缺失时 hvigorfile 会跳过注入） ---------
$signingFile = Join-Path $projectRoot "signing.$SignMode.local.json"
if (-not (Test-Path -LiteralPath $signingFile)) {
    Write-Warning "未找到 signing.$SignMode.local.json：将不注入签名配置（产出未签名/IDE 自动调试签名）。"
}

# --- 5. 执行 hvigor 构建 ------------------------------------------------------
# Hap：模块级包（真机装机/调试）→ assembleHap（--mode module）
# App：应用级 App Pack（应用市场提交）→ assembleApp（--mode project）
if ($Task -eq 'App') {
    $hvigorTask = 'assembleApp'
    $hvigorMode = 'project'
    if ($BuildMode -ne 'release') {
        Write-Warning "App Pack 用于应用市场上架时应使用 -BuildMode release（当前 $BuildMode）。"
    }
    if ($SignMode -ne 'release') {
        Write-Warning "App Pack 用于应用市场上架时必须使用 -SignMode release（当前 $SignMode）：调试材料签名的 .app 无法上架，仅供本地验证。"
    }
} else {
    $hvigorTask = 'assembleHap'
    $hvigorMode = 'module'
}
Write-Host "`n=== hvigorw $hvigorTask (task=$Task, buildMode=$BuildMode, signMode=$SignMode) ===" -ForegroundColor Green
& $Hvigorw $hvigorTask --mode $hvigorMode -p product=default -p buildMode=$BuildMode --no-daemon
if ($LASTEXITCODE -ne 0) { throw "hvigorw 构建失败（exit $LASTEXITCODE）" }

# --- 6. 汇报产物 --------------------------------------------------------------
if ($Task -eq 'App') {
    $appDir = Join-Path $projectRoot 'build\outputs\default'
    $app = Get-ChildItem -Path $appDir -Filter '*-signed.app' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($app) {
        $size = [math]::Round($app.Length / 1MB, 1)
        Write-Host "`n✅ 已签名 App Pack（应用市场提交）：$($app.FullName) ($size MB)" -ForegroundColor Green
    } else {
        Write-Warning "构建成功但未找到 signed .app：$appDir\*-signed.app"
    }
} else {
    $hap = Join-Path $projectRoot 'electron\build\default\outputs\default\electron-default-signed.hap'
    if (Test-Path $hap) {
        $size = [math]::Round((Get-Item $hap).Length / 1MB, 1)
        Write-Host "`n✅ 已签名 HAP：$hap ($size MB)" -ForegroundColor Green
    } else {
        Write-Warning "构建成功但未找到 signed.hap：$hap"
    }
}

# --- 7. 产物签名断言：内嵌 Profile 的 type 必须与 -SignMode 一致 ----------------
# 背景：本项目曾出现「release 构建被静默用 debug 材料签名」——构建成功但产物无法上架。
# 这里用 SDK 自带的 hap-sign-tool verify-app 解出产物内嵌 provisioning profile 的 type 做硬校验。
function Get-P7bProfileType {
    param([Parameter(Mandatory = $true)][string]$Path)
    # .p7b 是二进制：Profile JSON 内嵌其中，JSON 之后紧跟的是二进制字节，未必有换行。
    # 因此不能按「行尾换行」截取，改为：
    #   1) 用 Latin-1(代码页 28591) 逐字节映射成字符串，任何字节都能无损还原为字符，
    #      不会像 UTF-8 那样在非法字节处产生替换字符；
    #   2) 定位 "version-name"，往回找最近的 '{' 作为 JSON 起点；
    #   3) 用「括号配平 + 字符串/转义感知」扫描出与之匹配的 '}'，精确截取整段 JSON。
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $text = [System.Text.Encoding]::GetEncoding(28591).GetString($bytes)
    $vnIdx = $text.IndexOf('"version-name"')
    if ($vnIdx -lt 0) { return $null }
    $jsonStart = $text.LastIndexOf('{', $vnIdx)
    if ($jsonStart -lt 0) { return $null }

    $depth = 0
    $inString = $false
    $escaped = $false
    $jsonEnd = -1
    for ($i = $jsonStart; $i -lt $text.Length; $i++) {
        $ch = $text[$i]
        if ($escaped) { $escaped = $false; continue }
        if ($ch -eq '\') { if ($inString) { $escaped = $true }; continue }
        if ($ch -eq '"') { $inString = -not $inString; continue }
        if ($inString) { continue }
        if ($ch -eq '{') {
            $depth++
        } elseif ($ch -eq '}') {
            $depth--
            if ($depth -eq 0) { $jsonEnd = $i; break }
        }
    }
    if ($jsonEnd -lt 0) { return $null }

    $json = $text.Substring($jsonStart, $jsonEnd - $jsonStart + 1)
    try { return (ConvertFrom-Json $json).type } catch { return $null }
}

$assertArtifact = $null
if ($Task -eq 'App') {
    $assertAppDir = Join-Path $projectRoot 'build\outputs\default'
    $assertApp = Get-ChildItem -Path $assertAppDir -Filter '*-signed.app' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($assertApp) { $assertArtifact = $assertApp.FullName }
} else {
    $assertHap = Join-Path $projectRoot 'electron\build\default\outputs\default\electron-default-signed.hap'
    if (Test-Path -LiteralPath $assertHap) { $assertArtifact = $assertHap }
}

if (-not $assertArtifact) {
    Write-Warning "签名断言跳过：未找到可校验的已签名产物（Task=$Task）。"
} else {
    # hap-sign-tool.jar 位于 <SdkHome>\default\openharmony\toolchains\lib\ 下
    $hapSignTool = Join-Path $SdkHome 'default\openharmony\toolchains\lib\hap-sign-tool.jar'
    if (-not (Test-Path -LiteralPath $hapSignTool)) {
        $found = Get-ChildItem -Path $SdkHome -Recurse -Filter 'hap-sign-tool.jar' -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($found) { $hapSignTool = $found.FullName }
    }
    if (-not (Test-Path -LiteralPath $hapSignTool)) {
        Write-Warning "签名断言跳过：未找到 hap-sign-tool.jar（期望位于 $SdkHome\default\openharmony\toolchains\lib\）。"
    } else {
        $verifyTmp = Join-Path ([System.IO.Path]::GetTempPath()) ("harness-signcheck-" + [System.Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $verifyTmp -Force | Out-Null
        try {
            $outCertChain = Join-Path $verifyTmp 'cert-chain.cer'
            $outProfile   = Join-Path $verifyTmp 'profile.p7b'
            & (Join-Path $jbrBin 'java.exe') -jar $hapSignTool verify-app `
                -inFile $assertArtifact -outCertChain $outCertChain -outProfile $outProfile | Out-Null
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outProfile)) {
                Write-Warning "签名断言跳过：hap-sign-tool verify-app 未能解出 Profile（exit $LASTEXITCODE）。"
            } else {
                $actualType = Get-P7bProfileType -Path $outProfile
                $shownActual = if ($actualType) { $actualType } else { '<无法解析>' }
                if ($actualType -ne $SignMode) {
                    Write-Host ""
                    Write-Host "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" -ForegroundColor Red
                    Write-Host "!!  签名模式不匹配：产物内嵌 Profile type = $shownActual，但请求的是 $SignMode" -ForegroundColor Red
                    Write-Host "!!  产物：$assertArtifact" -ForegroundColor Red
                    Write-Host "!!  该包并非用 $SignMode 材料签名，禁止用于对应用途。" -ForegroundColor Red
                    Write-Host "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" -ForegroundColor Red
                    throw "签名模式不匹配：产物 Profile type=$shownActual，期望 $SignMode（$assertArtifact）"
                }
                Write-Host "`n✅ 签名断言通过：Profile type = $actualType，与 -SignMode $SignMode 一致。" -ForegroundColor Green
            }
        } finally {
            Remove-Item -LiteralPath $verifyTmp -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
