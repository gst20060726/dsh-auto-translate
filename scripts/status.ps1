#requires -version 5.1
<#
  status.ps1 -- dsh-auto-translate status panel (read-only, changes nothing)

  Pure ASCII on purpose: Windows PowerShell 5.1 reads BOM-less UTF-8 files as GBK
  and would choke on non-ASCII string literals (same reason publish.ps1 is ASCII).

  Usage:
    powershell -ExecutionPolicy Bypass -File status.ps1            # console panel
    powershell -ExecutionPolicy Bypass -File status.ps1 -Open      # panel + open npm / Gitee pages
    powershell -ExecutionPolicy Bypass -File status.ps1 -Watch 30  # refresh every 30s
#>
param(
  [switch]$Open,
  [int]$Watch = 0
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$name = $pkg.name
$version = $pkg.version
$OK = '[OK]'
$WARN = '[!]'

function Section($t) {
  Write-Host ''
  Write-Host ('-' * 62) -ForegroundColor DarkGray
  Write-Host "  $t" -ForegroundColor Cyan
  Write-Host ('-' * 62) -ForegroundColor DarkGray
}

function Row($k, $v, $color = 'Gray') {
  Write-Host ('  {0,-14}' -f $k) -NoNewline -ForegroundColor DarkGray
  Write-Host $v -ForegroundColor $color
}

function Compare-VersionText($a, $b) {
  # 1 = $a newer, -1 = $a older, 0 = equal, '' = not comparable by numeric core
  $pa = @(($a -split '[-+]')[0] -split '\.')
  $pb = @(($b -split '[-+]')[0] -split '\.')
  $n = $pa.Count
  if ($pb.Count -gt $n) { $n = $pb.Count }
  for ($i = 0; $i -lt $n; $i++) {
    $x = $(if ($i -lt $pa.Count) { $pa[$i] } else { '0' })
    $y = $(if ($i -lt $pb.Count) { $pb[$i] } else { '0' })
    $nx = 0; $ny = 0
    if (-not [int]::TryParse($x, [ref]$nx)) { return '' }
    if (-not [int]::TryParse($y, [ref]$ny)) { return '' }
    if ($nx -gt $ny) { return 1 }
    if ($nx -lt $ny) { return -1 }
  }
  if ($a -eq $b) { return 0 }
  return ''
}

function Get-Status {
  $out = [ordered]@{}

  # ---- local git ----
  $head = (& git -C $root rev-parse --short HEAD 2>$null | Select-Object -First 1)
  $branch = (& git -C $root rev-parse --abbrev-ref HEAD 2>$null | Select-Object -First 1)
  $dirtyLines = @(& git -C $root status --porcelain 2>$null | Where-Object { $_ })
  $ahead = (& git -C $root rev-list --count 'gitee/main..HEAD' 2>$null | Select-Object -First 1)
  $lastMsg = (& git -C $root log -1 --format='%s' 2>$null | Select-Object -First 1)
  $lastTime = (& git -C $root log -1 --format='%ad' --date=format:'%m-%d %H:%M' 2>$null | Select-Object -First 1)

  $clean = ($dirtyLines.Count -eq 0)
  $synced = ($ahead -eq '0')
  $out.local = [ordered]@{
    branch = $branch
    head   = $head
    dirty  = $(if ($clean) { "$OK clean" } else { "$WARN " + $dirtyLines.Count + ' uncommitted file(s)' })
    clean  = $clean
    ahead  = $(if ($synced) { "$OK same as gitee/main" } else { "$WARN ahead of gitee/main by $ahead commit(s)" })
    synced = $synced
    msg    = $lastMsg
    time   = $lastTime
  }

  # ---- gitee remote ----
  $env:GIT_TERMINAL_PROMPT = '0'
  $env:GCM_INTERACTIVE = 'Never'
  $remoteLine = (& git -C $root ls-remote --heads gitee 2>$null | Select-Object -First 1)
  $rsha = ''
  $rstate = "$WARN query failed (network or credentials)"
  $rok = $false
  if ($remoteLine -and $remoteLine -match '^([0-9a-f]{7})') {
    $rsha = $Matches[1]
    if ($rsha -eq $head) { $rstate = "$OK identical to local HEAD"; $rok = $true }
    else { $rstate = "$WARN remote is $rsha (differs from local)" }
  }
  $out.gitee = [ordered]@{
    sha = $rsha; state = $rstate; ok = $rok
    url = 'https://gitee.com/nysjn/dsh-auto-translate'
  }

  # ---- npm registry ----
  $meta = $null
  $err = ''
  $raw = (& npm view $name --json 2>$null | Out-String)
  if ($raw -and $raw -match '\{') {
    try { $meta = $raw | ConvertFrom-Json } catch { $err = $_.Exception.Message }
  } else {
    $err = (($raw -split "`n") | Where-Object { $_ } | Select-Object -First 1)
    if (-not $err) { $err = 'query returned nothing' }
  }
  if ($meta) {
    $out.npm = [ordered]@{
      ok = $true; version = $meta.version; shasum = $meta.dist.shasum
      modified = $meta.time.modified; files = $meta.dist.fileCount
      url = "https://www.npmjs.com/package/$name"
    }
  } else {
    $out.npm = [ordered]@{ ok = $false; err = $err; url = "https://www.npmjs.com/package/$name" }
  }

  # ---- local package.json version vs npm published version ----
  $out.npm.local = $version
  if (-not $out.npm.ok) {
    $out.npm.drift = [ordered]@{
      state = 'unknown'; color = 'Yellow'
      msg   = "$WARN cannot compare: local $version vs npm (registry query failed)"
    }
  } elseif ($out.npm.version -eq $version) {
    $out.npm.drift = [ordered]@{
      state = 'sync'; color = 'Green'
      msg   = "$OK in sync: local package.json = npm published = $version"
    }
  } else {
    $cmp = Compare-VersionText $version $out.npm.version
    if ($cmp -eq 1) {
      $out.npm.drift = [ordered]@{
        state = 'ahead'; color = 'Yellow'
        msg   = "$WARN DRIFT: local $version is newer than npm $($out.npm.version) (publish pending)"
      }
    } elseif ($cmp -eq -1) {
      $out.npm.drift = [ordered]@{
        state = 'behind'; color = 'Red'
        msg   = "$WARN DRIFT: local $version is older than npm $($out.npm.version) (republish or pull needed)"
      }
    } else {
      $out.npm.drift = [ordered]@{
        state = 'unknown'; color = 'Yellow'
        msg   = "$WARN DRIFT: local $version differs from npm $($out.npm.version) (order not comparable)"
      }
    }
  }

  # ---- local tgz ----
  $tgz = Get-ChildItem (Join-Path $root '*.tgz') -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($tgz) {
    $out.tgz = [ordered]@{
      name = $tgz.Name
      size = ('{0:N1} KB' -f ($tgz.Length / 1KB))
      time = $tgz.LastWriteTime.ToString('MM-dd HH:mm')
    }
  } else { $out.tgz = $null }

  # ---- metrics: npm downloads + gitee stars (public APIs, no credentials) ----
  $weekTxt = 'n/a'; $monthTxt = 'n/a'; $dlNote = ''
  try {
    $w = Invoke-RestMethod "https://api.npmjs.org/downloads/point/last-week/$name" -TimeoutSec 20
    $weekTxt = '' + $w.downloads
  } catch { $dlNote = 'npm download stats not available yet (npm delays counting for new packages)' }
  try {
    $m = Invoke-RestMethod "https://api.npmjs.org/downloads/point/last-month/$name" -TimeoutSec 20
    $monthTxt = '' + $m.downloads
  } catch { }
  $out.metrics = [ordered]@{
    week  = $weekTxt
    month = $monthTxt
    note  = $dlNote
  }
  try {
    $g = Invoke-RestMethod 'https://gitee.com/api/v5/repos/nysjn/dsh-auto-translate' -TimeoutSec 20
    $out.metrics.gitee = "stars $($g.stargazers_count) | forks $($g.forks_count) | watch $($g.watchers_count) | open issues $($g.open_issues_count)"
  } catch {
    $out.metrics.gitee = "$WARN gitee metrics unavailable"
  }
  $out.metrics.views = 'not published by npm or Gitee (repo traffic page is owner-only)'

  # ---- profile install state ----
  $listOut = (& dsh plugin --profile web list 2>$null | Out-String)
  $installed = ($listOut -match [regex]::Escape($name))
  $out.profile = [ordered]@{
    bundle = $(if ($pkg.dsh.bundle.patch) { $pkg.dsh.bundle.patch } else { '(none)' })
    state  = $(if ($installed) { "$OK present in web profile" } else { "$WARN not in web profile" })
    ok     = $installed
  }

  # ---- vendor ----
  $wasm = @(Get-ChildItem (Join-Path $root 'vendor/ort/*.wasm') -ErrorAction SilentlyContinue).Count
  $worker = Test-Path (Join-Path $root 'vendor/worker.v5.js')
  $out.vendor = [ordered]@{
    worker = $worker
    wasm   = $(if ($wasm -gt 0) { "$wasm file(s) - fully offline capable" } else { '0 file(s) - CDN fallback at runtime' })
  }

  return $out
}

function Render($s) {
  Clear-Host
  Write-Host ''
  Write-Host "  $name@$version" -ForegroundColor White -BackgroundColor DarkBlue
  Write-Host "  status panel   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkGray

  Section 'LOCAL REPO'
  Row 'branch' $s.local.branch
  Row 'HEAD' "$($s.local.head)  $($s.local.msg)"
  Row 'committed' $s.local.time
  Row 'worktree' $s.local.dirty $(if ($s.local.clean) { 'Green' } else { 'Yellow' })
  Row 'vs gitee' $s.local.ahead $(if ($s.local.synced) { 'Green' } else { 'Yellow' })

  Section 'GITEE MIRROR'
  Row 'remote sha' $s.gitee.sha
  Row 'state' $s.gitee.state $(if ($s.gitee.ok) { 'Green' } else { 'Yellow' })
  Row 'repo page' $s.gitee.url 'DarkCyan'

  Section 'NPM REGISTRY'
  if ($s.npm.ok) {
    Row 'version' "$name@$($s.npm.version)" 'Green'
    Row 'published' $s.npm.modified
    Row 'files' "$($s.npm.files) file(s)"
    Row 'shasum' $s.npm.shasum
    Row 'pkg page' $s.npm.url 'DarkCyan'
  } else {
    Row 'state' "query failed: $($s.npm.err)" 'Red'
    Row 'pkg page' $s.npm.url 'DarkCyan'
  }
  Row 'local vs npm' $s.npm.drift.msg $s.npm.drift.color

  Section 'USAGE METRICS'
  Row 'dl / week' $s.metrics.week $(if ($s.metrics.week -eq 'n/a') { 'Yellow' } else { 'Green' })
  Row 'dl / month' $s.metrics.month $(if ($s.metrics.month -eq 'n/a') { 'Yellow' } else { 'Green' })
  Row 'gitee' $s.metrics.gitee
  Row 'views' $s.metrics.views 'DarkGray'
  if ($s.metrics.note) {
    Write-Host '  ! ' -NoNewline -ForegroundColor Yellow
    Write-Host $s.metrics.note -ForegroundColor Yellow
  }

  Section 'LOCAL ARTIFACT / INSTALL STATE'
  if ($s.tgz) { Row 'tgz' "$($s.tgz.name)  $($s.tgz.size)  $($s.tgz.time)" }
  else { Row 'tgz' 'not packed yet (run: npm pack)' 'Yellow' }
  Row 'bundle' $s.profile.bundle
  Row 'profile' $s.profile.state $(if ($s.profile.ok) { 'Green' } else { 'Yellow' })
  Row 'worker' $(if ($s.vendor.worker) { "$OK vendor/worker.v5.js" } else { "$WARN missing" }) $(if ($s.vendor.worker) { 'Green' } else { 'Red' })
  Row 'ORT wasm' $s.vendor.wasm

  Section 'INSTALL COMMAND FOR OTHERS'
  Write-Host "    dsh plugin --profile web add $name" -ForegroundColor White
  Write-Host "    dsh plugin --profile web add 'git+https://gitee.com/nysjn/dsh-auto-translate.git#$($s.local.head)'" -ForegroundColor DarkGray
  Write-Host ''
  Write-Host ('  ' + ('-' * 60)) -ForegroundColor DarkGray
  if ($Watch -gt 0) { Write-Host "  auto-refresh every $Watch s (Ctrl+C to quit)" -ForegroundColor DarkGray }
  else { Write-Host "  add -Open to open npm / Gitee pages, -Watch 30 to keep refreshing" -ForegroundColor DarkGray }
}

do {
  try {
    $s = Get-Status
    Render $s
    if ($Open) {
      Start-Process $s.npm.url
      Start-Process $s.gitee.url
      $Open = $false
    }
  } catch {
    Write-Host ("  status collection failed: " + $_.Exception.Message) -ForegroundColor Red
  }
  if ($Watch -gt 0) { Start-Sleep -Seconds $Watch }
} while ($Watch -gt 0)
