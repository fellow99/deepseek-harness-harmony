# inject-hnp.ps1 -- embed an HNP package into the HAP and re-sign it.
#
# WHY THIS EXISTS
#   module.json5 declares `hnpPackages`, and the system installer FAILS the whole
#   install (code 9568409, "extract of the native package failed") when the HAP
#   does not actually carry that native package. hvigor, however, cannot produce
#   it: its PackingToolOptions class has no addHnpPath method, so it never emits
#   --hnp-path to app_packing_tool (verified in
#   hvigor/hvigor-ohos-plugin/src/builder/inner-java-command-builder/packing-tool-options.d.ts).
#   The packer itself DOES support --hnp-path in hap mode: it takes a DIRECTORY
#   and copies its contents into `hnp/` at the HAP root.
#
# WHAT IT DOES
#   1. re-runs app_packing_tool with exactly the arguments hvigor used
#      (captured from `hvigorw ... --debug`), plus --hnp-path
#   2. re-signs that HAP with hap-sign-tool sign-app
#   Result: <module>-<product>-signed-hnp.hap, which is the artifact to install.
#
# ORDERING
#   Run ④ (build-hap.ps1) first: it produces the intermediates and the unsigned
#   HAP this script consumes. hvigor's own signed HAP cannot be patched, because
#   the signature covers every entry.
#
# USAGE
#   pwsh -File scripts\inject-hnp.ps1 -BuildMode debug
#   Install output: electron\build\default\outputs\default\electron-default-signed-hnp.hap

[CmdletBinding()]
param(
  [string]$Module = 'electron',
  [string]$Product = 'default',
  [string]$BuildMode = 'debug',
  [string]$HnpRoot = '',
  # hap-sign-tool requires -compatibleVersion for hap input; must match
  # build-profile.json5's compatibleSdkVersion (5.0.5(17) -> 17).
  [string]$CompatibleVersion = '17',
  [string]$JbrHome = 'D:\oh-workspace\DevEco Studio\jbr',
  [string]$SdkHome = 'D:\oh-workspace\command-line-tools\sdk'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath $root)) { $root = (Get-Location).Path }

if ([string]::IsNullOrWhiteSpace($HnpRoot)) {
  $HnpRoot = Join-Path $root "$Module\hnp"
}

$intermediates = Join-Path $root "$Module\build\$Product\intermediates"
$outDir        = Join-Path $root "$Module\build\$Product\outputs\$Product"
$unsignedIn    = Join-Path $outDir "$Module-$Product-unsigned.hap"
$unsignedOut   = Join-Path $outDir "$Module-$Product-unsigned-hnp.hap"
$signedOut     = Join-Path $outDir "$Module-$Product-signed-hnp.hap"

$toolchains = Join-Path $SdkHome 'default\openharmony\toolchains'
$packerJar  = Join-Path $toolchains 'lib\app_packing_tool.jar'
$signJar    = Join-Path $toolchains 'lib\hap-sign-tool.jar'
$java       = Join-Path $JbrHome 'bin\java.exe'

# ---- preconditions ---------------------------------------------------------
foreach ($p in @($java, $packerJar, $signJar)) {
  if (-not (Test-Path -LiteralPath $p)) { throw "missing tool: $p" }
}
if (-not (Test-Path -LiteralPath $HnpRoot)) {
  throw "HNP root not found: $HnpRoot (expected a directory whose contents become hnp/ inside the HAP)"
}
$hnpFiles = Get-ChildItem -LiteralPath $HnpRoot -Recurse -File -Filter '*.hnp' -ErrorAction SilentlyContinue
if (-not $hnpFiles) { throw "no .hnp found under $HnpRoot" }
Write-Host "HNP payload(s) under $HnpRoot :"
$hnpFiles | ForEach-Object { Write-Host ("  {0}  ({1} B)" -f $_.FullName.Substring($HnpRoot.Length + 1), $_.Length) }

foreach ($p in @(
  (Join-Path $intermediates 'package\default\module.json'),
  (Join-Path $intermediates 'res\default\resources'),
  (Join-Path $intermediates 'res\default\resources.index'),
  (Join-Path $intermediates 'loader_out\default\ets'),
  (Join-Path $intermediates 'loader\default\pkgContextInfo.json'),
  (Join-Path $intermediates 'stripped_native_libs\default')
)) {
  if (-not (Test-Path -LiteralPath $p)) { throw "missing build intermediate: $p (run build-hap.ps1 first)" }
}

# ---- 1. pack with --hnp-path (arguments mirror hvigor's own invocation) ----
Write-Host "`n=== app_packing_tool --mode hap (+ --hnp-path) ===" -ForegroundColor Green
$packArgs = @(
  '-Dfile.encoding=GBK',
  '-jar', $packerJar,
  '--mode', 'hap',
  '--force', 'true',
  '--lib-path',        (Join-Path $intermediates 'stripped_native_libs\default'),
  '--json-path',       (Join-Path $intermediates 'package\default\module.json'),
  '--resources-path',  (Join-Path $intermediates 'res\default\resources'),
  '--index-path',      (Join-Path $intermediates 'res\default\resources.index'),
  '--pack-info-path',  (Join-Path $outDir 'pack.info'),
  '--out-path',        $unsignedOut,
  '--ets-path',        (Join-Path $intermediates 'loader_out\default\ets'),
  '--pkg-context-path',(Join-Path $intermediates 'loader\default\pkgContextInfo.json'),
  '--hnp-path',        $HnpRoot
)
& $java @packArgs
if ($LASTEXITCODE -ne 0) { throw "app_packing_tool failed (exit $LASTEXITCODE)" }
if (-not (Test-Path -LiteralPath $unsignedOut)) { throw "packer produced no output: $unsignedOut" }
Write-Host ("  -> {0}  ({1:N1} MB)" -f $unsignedOut, ((Get-Item -LiteralPath $unsignedOut).Length / 1MB))

# ---- 2. verify the hnp really landed inside the HAP ------------------------
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($unsignedOut)
try {
  $entries = @($zip.Entries | Where-Object { $_.FullName -like 'hnp/*' })
} finally { $zip.Dispose() }
if ($entries.Count -eq 0) { throw "hnp/ entries missing from $unsignedOut -- the packer did not embed the package" }
Write-Host "  hnp entries now inside the HAP:"
$entries | ForEach-Object { Write-Host ("    {0}  ({1} B)" -f $_.FullName, $_.Length) }

# ---- 3. sign --------------------------------------------------------------
$cfgPath = Join-Path $root "signing.$BuildMode.local.json"
if (-not (Test-Path -LiteralPath $cfgPath)) { throw "signing config not found: $cfgPath" }
$cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json

# signing.<mode>.local.json holds hvigor DecipherUtil CIPHERTEXT, so the
# plaintext must be recovered with hvigor's own implementation. The helper keeps
# the result on stdout; capture it into memory and never echo it.
$decryptHelper = Join-Path $PSScriptRoot 'lib\decrypt-signing-pwd.cjs'
Write-Host "`n=== recover plaintext passwords (hvigor DecipherUtil) ===" -ForegroundColor Green
$decryptedRaw = & node $decryptHelper $cfgPath
if ($LASTEXITCODE -ne 0) { throw "password decryption failed (exit $LASTEXITCODE)" }
$decrypted = $decryptedRaw | ConvertFrom-Json
if (-not $decrypted.keyPassword -or -not $decrypted.storePassword) {
  throw "decryption returned an empty password"
}
Write-Host ("  key material : {0}" -f $decrypted.materialDir)
Write-Host ("  passwords    : recovered (lengths {0}/{1})" -f $decrypted.keyPassword.Length, $decrypted.storePassword.Length)

Write-Host "`n=== hap-sign-tool sign-app ===" -ForegroundColor Green
$signArgs = @(
  '-Dfile.encoding=GBK',
  '-jar', $signJar,
  'sign-app',
  '-mode', 'localSign',
  '-keyAlias', $cfg.keyAlias,
  '-keyPwd', $decrypted.keyPassword,
  '-appCertFile', $cfg.certpath,
  '-profileFile', $cfg.profile,
  '-inFile', $unsignedOut,
  '-signAlg', $cfg.signAlg,
  '-keystoreFile', $cfg.storeFile,
  '-keystorePwd', $decrypted.storePassword,
  '-outFile', $signedOut,
  '-compatibleVersion', $CompatibleVersion,
  '-signCode', '1'
)
& $java @signArgs
if ($LASTEXITCODE -ne 0) { throw "hap-sign-tool failed (exit $LASTEXITCODE)" }
if (-not (Test-Path -LiteralPath $signedOut)) { throw "signer produced no output: $signedOut" }

# ---- 4. verify signature + hnp presence on the final artifact --------------
Write-Host "`n=== verify-app ===" -ForegroundColor Green
$tmpCert = Join-Path $env:TEMP 'hnp-outCertChain.cer'
$tmpProfile = Join-Path $env:TEMP 'hnp-outProfile.p7b'
& $java '-Dfile.encoding=GBK' -jar $signJar 'verify-app' '-inFile' $signedOut '-outCertChain' $tmpCert '-outProfile' $tmpProfile
if ($LASTEXITCODE -ne 0) { throw "verify-app failed (exit $LASTEXITCODE)" }

$zip2 = [System.IO.Compression.ZipFile]::OpenRead($signedOut)
try {
  $finalHnp = @($zip2.Entries | Where-Object { $_.FullName -like 'hnp/*' })
} finally { $zip2.Dispose() }
if ($finalHnp.Count -eq 0) { throw "hnp/ entries missing from signed artifact" }

Write-Host "`nOK" -ForegroundColor Green
Write-Host ("  signed + hnp: {0}  ({1:N1} MB)" -f $signedOut, ((Get-Item -LiteralPath $signedOut).Length / 1MB))
Write-Host ("  hnp entries : {0}" -f $finalHnp.Count)
Write-Host "  install with: hdc app install -r `"$signedOut`""
