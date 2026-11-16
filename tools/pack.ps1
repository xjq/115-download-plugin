<#
  tools/pack.ps1 —— 一键打包 CRX + ZIP
  用法：  pwsh tools/pack.ps1

  要点：
   1. 从干净的 staging 目录打包，只含运行时文件（不含 dist/tools/test/README）
   2. Chrome 的 --pack-extension 不会自动复用同名 .pem，必须显式传 --pack-extension-key
   3. 私钥不能位于被打包目录内，否则 Chrome 报错退出；故打包时临时复制到 TEMP
   4. 私钥持久保存在 dist/115-magnet-helper.pem，决定扩展 ID 恒定不变
#>
param(
  [string]$ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
)

$ErrorActionPreference = 'Stop'

$root     = Split-Path -Parent $PSScriptRoot
$dist     = Join-Path $root 'dist'
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$version  = $manifest.version

if (-not (Test-Path $ChromePath)) { throw "找不到 Chrome: $ChromePath" }
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$key    = Join-Path $dist '115-magnet-helper.pem'
$crxOut = Join-Path $dist "115-magnet-helper-v$version.crx"
$zipOut = Join-Path $dist "115-magnet-helper-v$version.zip"

$RUNTIME = @('manifest.json','shared.js','background.js','content.js',
             'popup.html','popup.js','options.html','options.js',
             'login.html','login.js','lib','icons')

# ---- 1. staging：只复制运行时文件 ----
$stamp   = [guid]::NewGuid().ToString('N').Substring(0,8)
$staging = Join-Path $env:TEMP "m115-src-$stamp"
New-Item -ItemType Directory -Force -Path $staging | Out-Null
foreach ($i in $RUNTIME) {
  $src = Join-Path $root $i
  if (-not (Test-Path $src)) { throw "缺少运行时文件: $i" }
  Copy-Item -LiteralPath $src -Destination $staging -Recurse -Force
}

# ---- 2. 私钥：复制到 TEMP 供 Chrome 使用（不能放在被打包目录内） ----
$prof   = Join-Path $env:TEMP "m115-pack-$stamp"
$tmpKey = Join-Path $env:TEMP "m115-key-$stamp.pem"
New-Item -ItemType Directory -Force -Path $prof | Out-Null

Write-Output "正在打包 v$version ..."
if (Test-Path $key) {
  Write-Output "  复用已有私钥（扩展 ID 保持不变）"
  Copy-Item -LiteralPath $key -Destination $tmpKey -Force
  $out = & $ChromePath --pack-extension="$staging" --pack-extension-key="$tmpKey" --user-data-dir=$prof 2>&1 | Out-String
} else {
  Write-Output "  首次打包，生成新私钥"
  $out = & $ChromePath --pack-extension="$staging" --user-data-dir=$prof 2>&1 | Out-String
}
if ($LASTEXITCODE -ne 0) { throw "Chrome 打包失败 (exit $LASTEXITCODE): $($out.Trim())" }

$tmpCrx = "$staging.crx"
$tmpPem = "$staging.pem"
if (-not (Test-Path $tmpCrx)) { throw "CRX 未生成: $tmpCrx  $($out.Trim())" }

Move-Item -LiteralPath $tmpCrx -Destination $crxOut -Force
if (-not (Test-Path $key) -and (Test-Path $tmpPem)) {
  Move-Item -LiteralPath $tmpPem -Destination $key -Force
}

# ---- 3. ZIP：解压后即可“加载已解压的扩展程序”，也可直接上传 Web Store ----
$zipItems = $RUNTIME | ForEach-Object { Join-Path $staging $_ }
Compress-Archive -Path $zipItems -DestinationPath $zipOut -CompressionLevel Optimal -Force

# ---- 4. 扩展 ID ----
$extId = $null
$idScript = Join-Path $PSScriptRoot 'crx_id.py'
if (Test-Path $idScript) {
  $py = (python $idScript $crxOut 2>$null) -join "`n"
  if ($py -match 'EXTENSION ID:\s*(\w+)') { $extId = $Matches[1] }
}

Write-Output ""
Write-Output "打包完成："
Write-Output "  CRX : $crxOut  ($((Get-Item $crxOut).Length) bytes)"
Write-Output "  ZIP : $zipOut  ($((Get-Item $zipOut).Length) bytes)"
Write-Output "  KEY : $key  (私钥，勿丢失/勿泄露，决定扩展 ID)"
if ($extId) { Write-Output "  ID  : $extId" }
Write-Output ""
Write-Output "staging 临时目录留在 TEMP（m115-src-$stamp / m115-pack-$stamp / m115-key-$stamp.pem），系统会自行清理"
