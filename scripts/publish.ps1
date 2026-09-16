# publish.ps1 - distribute dsh-auto-translate (none of the three routes needs GitHub)
#
#   powershell -File scripts/publish.ps1 -Target tgz
#   powershell -File scripts/publish.ps1 -Target zip
#   powershell -File scripts/publish.ps1 -Target bundle
#   powershell -File scripts/publish.ps1 -Target gitee  -Remote https://gitee.com/USER/dsh-auto-translate.git
#   powershell -File scripts/publish.ps1 -Target github -Remote https://github.com/USER/dsh-auto-translate.git
#   powershell -File scripts/publish.ps1 -Target npm
#
# tgz / zip / bundle are fully local and need no account.
# gitee / github / npm ask for your credentials interactively; nothing is stored by this script.
param(
  [ValidateSet('tgz', 'zip', 'bundle', 'gitee', 'github', 'npm')]
  [string]$Target = 'tgz',
  [string]$Remote = ''
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Output ('plugin dir: ' + $root)

function Get-Sha256([string]$path) {
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()
}

function Invoke-Tests {
  Write-Output 'running offline tests ...'
  npm test
  if ($LASTEXITCODE -ne 0) {
    Write-Output 'TESTS FAILED - aborted'
    exit 1
  }
  Write-Output 'tests passed'
}

function New-Tarball {
  Invoke-Tests
  Get-ChildItem (Join-Path $root '*.tgz') -ErrorAction SilentlyContinue | Remove-Item -Force
  npm pack | Out-Null
  $tgz = Get-ChildItem (Join-Path $root '*.tgz') | Select-Object -First 1
  Write-Output ('tgz     : ' + $tgz.FullName)
  Write-Output ('size    : ' + [Math]::Round($tgz.Length / 1KB, 1) + ' KB')
  Write-Output ('sha256  : ' + (Get-Sha256 $tgz.FullName))
  return $tgz.FullName
}

if ($Target -eq 'tgz') {
  $p = New-Tarball
  Write-Output 'send this file to others; they run:'
  Write-Output ('  dsh plugin --profile web add ' + $p)
  exit 0
}

if ($Target -eq 'zip') {
  Invoke-Tests
  $zip = Join-Path $root 'dsh-auto-translate-repo.zip'
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  $tmp = Join-Path $env:TEMP ('at-zip-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force $tmp | Out-Null
  robocopy $root $tmp /E /XD .git node_modules /XF *.tgz *.zip /NFL /NDL /NJH /NJS | Out-Null
  $global:LASTEXITCODE = 0
  Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $zip -Force
  Remove-Item $tmp -Recurse -Force
  Write-Output ('zip     : ' + $zip)
  Write-Output ('size    : ' + [Math]::Round((Get-Item $zip).Length / 1KB, 1) + ' KB')
  Write-Output ('sha256  : ' + (Get-Sha256 $zip))
  Write-Output 'use: create a repo on gitee.com in your browser, then upload these files'
  exit 0
}

if ($Target -eq 'bundle') {
  Invoke-Tests
  $bundle = Join-Path $root 'dsh-auto-translate.bundle'
  Remove-Item $bundle -Force -ErrorAction SilentlyContinue
  git bundle create $bundle --all
  Write-Output ('bundle  : ' + $bundle)
  Write-Output ('sha256  : ' + (Get-Sha256 $bundle))
  Write-Output 'use: copy it to any machine that can push, then clone and push to any host'
  exit 0
}

if ($Target -eq 'gitee' -or $Target -eq 'github') {
  if ($Remote -eq '') {
    Write-Output 'missing -Remote, e.g. -Remote https://gitee.com/USER/dsh-auto-translate.git'
    exit 1
  }
  Invoke-Tests
  $name = 'github'
  if ($Target -eq 'gitee') { $name = 'gitee' }
  git remote remove $name 2>$null
  $global:LASTEXITCODE = 0
  git remote add $name $Remote
  Write-Output ('pushing to ' + $Remote + ' (credentials are asked interactively)')
  git push -u $name main
  Write-Output 'done. others install with:'
  Write-Output ('  dsh plugin --profile web add git+' + $Remote)
  exit 0
}

if ($Target -eq 'npm') {
  Invoke-Tests
  Write-Output 'interactive npm login (credentials stay on your machine)'
  npm login
  Write-Output 'publishing dsh-auto-translate ...'
  npm publish --access public
  Write-Output 'done. others install with: dsh plugin --profile web add dsh-auto-translate'
  exit 0
}
