#requires -Version 5.1
<#
.SYNOPSIS
    Start both AI backends (Nanoclaw + OpenClaw) for the rts2 game.

.DESCRIPTION
    Idempotent: if a service is already active and healthy, reports OK without
    restarting it. Otherwise starts the relevant systemd user unit in WSL and
    waits for it to become healthy (OpenClaw needs ~60s for acpx runtime).

    Both gateways live in WSL. Nanoclaw spawns Docker per request (Docker
    runs natively inside WSL — no Docker Desktop required).

.EXAMPLE
    PS> .\tools\start-ai.ps1

    Or right-click the file in Explorer and pick "Run with PowerShell".
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# ---- console setup -----------------------------------------------------------

# Force UTF-8 so checkmarks render. Saved to restore on exit.
$prevOutEncoding = [Console]::OutputEncoding
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$OK   = "$([char]0x2713)"   # check mark
$FAIL = "$([char]0x2717)"   # ballot x

function Write-Ok($msg)   { Write-Host "$OK $msg" -ForegroundColor Green }
function Write-Bad($msg)  { Write-Host "$FAIL $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "  $msg" -ForegroundColor DarkGray }

# ---- constants ---------------------------------------------------------------

# Nanoclaw — node service in WSL, port 4500, auth via NANOCLAW_HTTP_TOKEN
$NanoclawUnit       = 'nanoclaw'
$NanoclawPort       = 4500
$NanoclawEnvPath    = '/home/cbkjh/project/nanoclaw/.env'
$NanoclawProjectDir = '/home/cbkjh/project/nanoclaw'

# OpenClaw — gateway in WSL, port 18789, token in ~/.openclaw/openclaw.json
$OpenclawUnit   = 'openclaw-gateway'
$OpenclawPort   = 18789
$OpenclawConfig = '/home/cbkjh/.openclaw/openclaw.json'

# OpenClaw fully ready ≤ 60s after a cold start; HTTP up at ~6s, acpx ~28s
$OpenclawReadyTimeoutSec = 75
$NanoclawReadyTimeoutSec = 30

# ---- helpers -----------------------------------------------------------------

function Invoke-Wsl {
    param([Parameter(Mandatory)][string]$BashCommand)

    # Use -lc so we get a login shell (PATH, nvm, etc.). stderr captured via
    # PowerShell's $LASTEXITCODE check rather than 2>&1 to avoid PS 5.1 quirks.
    $output = wsl.exe bash -lc $BashCommand
    return [PSCustomObject]@{
        ExitCode = $LASTEXITCODE
        Stdout   = ($output -join "`n")
    }
}

function Get-ServiceState {
    param([Parameter(Mandatory)][string]$Unit)

    $r = Invoke-Wsl "systemctl --user is-active $Unit 2>/dev/null || true"
    return ($r.Stdout.Trim())
}

function Start-WslUserService {
    param([Parameter(Mandatory)][string]$Unit)

    $r = Invoke-Wsl "systemctl --user start $Unit"
    return $r.ExitCode -eq 0
}

function Get-NanoclawToken {
    if (-not (Test-Path Variable:script:NanoclawToken)) {
        $r = Invoke-Wsl "cat $NanoclawEnvPath 2>/dev/null"
        if ($r.ExitCode -ne 0) { return $null }
        $line = $r.Stdout -split "`n" | Where-Object { $_ -match '^\s*NANOCLAW_HTTP_TOKEN\s*=' } | Select-Object -First 1
        if (-not $line) { return $null }
        $script:NanoclawToken = ($line -replace '^\s*NANOCLAW_HTTP_TOKEN\s*=', '').Trim().Trim('"').Trim("'")
    }
    return $script:NanoclawToken
}

function Get-OpenclawToken {
    if (-not (Test-Path Variable:script:OpenclawToken)) {
        $r = Invoke-Wsl "cat $OpenclawConfig 2>/dev/null"
        if ($r.ExitCode -ne 0 -or -not $r.Stdout) { return $null }
        try {
            $cfg = $r.Stdout | ConvertFrom-Json
        } catch { return $null }
        $script:OpenclawToken = $cfg.gateway.auth.token
    }
    return $script:OpenclawToken
}

# Probe inside WSL using curl. This works in both NAT and mirrored networking
# modes (Windows-side Invoke-WebRequest fails on NAT for ports without an
# auto-forward). Returns just the HTTP status code as a string, or "000" on
# transport failure.
function Get-WslHttpStatus {
    param(
        [Parameter(Mandatory)][string]$Url,
        [string]$Method = 'GET',
        [string]$AuthHeader = '',
        [string]$ContentType = '',
        [string]$Body = '',
        [int]$TimeoutSec = 3
    )
    $parts = @("curl -sS -o /dev/null -w '%{http_code}' --max-time $TimeoutSec")
    if ($Method -ne 'GET') { $parts += "-X $Method" }
    if ($AuthHeader)       { $parts += "-H " + ("'Authorization: " + $AuthHeader + "'") }
    if ($ContentType)      { $parts += "-H 'Content-Type: $ContentType'" }
    if ($Body)             { $parts += "-d '" + ($Body -replace "'", "'\\''") + "'" }
    $parts += "'$Url'"
    $r = Invoke-Wsl ($parts -join ' ')
    return $r.Stdout.Trim()
}

# Probe Nanoclaw: server is up iff a request without auth returns 401.
# Don't send a real agent-message — that would spawn a Docker container.
function Test-Nanoclaw {
    $code = Get-WslHttpStatus -Url "http://127.0.0.1:$NanoclawPort/api/agent-message" `
        -Method 'POST' -ContentType 'application/json' -Body '{}'
    return ($code -eq '401')
}

# Probe OpenClaw: 200 on /v1/models with bearer token = fully ready.
# A 401 here just means HTTP server bound the port but acpx isn't done yet.
function Test-Openclaw {
    param([Parameter(Mandatory)][string]$Token)
    $code = Get-WslHttpStatus -Url "http://127.0.0.1:$OpenclawPort/v1/models" `
        -AuthHeader "Bearer $Token"
    return ($code -eq '200')
}

function Wait-Until {
    param(
        [Parameter(Mandatory)][scriptblock]$Probe,
        [Parameter(Mandatory)][int]$TimeoutSec,
        [int]$IntervalMs = 1500
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (& $Probe) { return $true }
        Start-Sleep -Milliseconds $IntervalMs
    }
    return $false
}

# ---- main --------------------------------------------------------------------

Write-Host ""
Write-Host "rts2 AI backends — start-ai.ps1" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Sanity: WSL must work at all.
try {
    $null = wsl.exe -l -q 2>$null
    if ($LASTEXITCODE -ne 0) { throw "wsl.exe exit $LASTEXITCODE" }
} catch {
    Write-Bad "WSL not reachable. Install/start WSL2 first (`wsl --install`)."
    exit 1
}

$nanoclawOk  = $false
$openclawOk  = $false
$nanoclawErr = $null
$openclawErr = $null

# ---- Nanoclaw ----------------------------------------------------------------

Write-Host ""
Write-Host "[1/2] Nanoclaw (Claude path)" -ForegroundColor White

$nanoState = Get-ServiceState -Unit $NanoclawUnit
Write-Info "systemd state: $nanoState"

if ($nanoState -ne 'active') {
    if ($nanoState -eq '') {
        $nanoclawErr = "systemd unit '$NanoclawUnit' not installed. Fix: in WSL run ``cd $NanoclawProjectDir && npm run setup``"
    } else {
        Write-Info "starting $NanoclawUnit ..."
        if (-not (Start-WslUserService -Unit $NanoclawUnit)) {
            $nanoclawErr = "systemctl --user start $NanoclawUnit failed. Try: ``wsl bash -lc 'journalctl --user -u $NanoclawUnit -n 50 --no-pager'``"
        }
    }
}

if (-not $nanoclawErr) {
    Write-Info "probing http://127.0.0.1:$NanoclawPort ..."
    # Already active → probe once with no wait. Just-started → poll up to timeout.
    $timeout = if ($nanoState -eq 'active') { 5 } else { $NanoclawReadyTimeoutSec }
    $ready = Wait-Until -Probe { Test-Nanoclaw } -TimeoutSec $timeout
    if ($ready) {
        # Verify token can be read so the user knows realtime calls will auth.
        $tok = Get-NanoclawToken
        if ($tok) {
            $nanoclawOk = $true
        } else {
            $nanoclawErr = "server up but NANOCLAW_HTTP_TOKEN not found in $NanoclawEnvPath. The game can't authenticate."
        }
    } else {
        $nanoclawErr = "no response on port $NanoclawPort within ${timeout}s. Check: ``wsl bash -lc 'journalctl --user -u $NanoclawUnit -n 50 --no-pager'``"
    }
}

if ($nanoclawOk) {
    Write-Ok "Nanoclaw: http://localhost:$NanoclawPort (Claude)"
} else {
    Write-Bad "Nanoclaw failed"
    Write-Info $nanoclawErr
}

# ---- OpenClaw ----------------------------------------------------------------

Write-Host ""
Write-Host "[2/2] OpenClaw (Codex path)" -ForegroundColor White

$openState = Get-ServiceState -Unit $OpenclawUnit
Write-Info "systemd state: $openState"

if ($openState -ne 'active') {
    if ($openState -eq '') {
        $openclawErr = "systemd unit '$OpenclawUnit' not installed. Fix: install openclaw and run ``systemctl --user enable --now $OpenclawUnit``"
    } else {
        Write-Info "starting $OpenclawUnit (cold start, allow up to ~60s for acpx runtime) ..."
        if (-not (Start-WslUserService -Unit $OpenclawUnit)) {
            $openclawErr = "systemctl --user start $OpenclawUnit failed. Try: ``wsl bash -lc 'journalctl --user -u $OpenclawUnit -n 50 --no-pager'``"
        }
    }
}

if (-not $openclawErr) {
    $opTok = Get-OpenclawToken
    if (-not $opTok) {
        $openclawErr = "could not read auth token from $OpenclawConfig. Check the file exists and has gateway.auth.token."
    } else {
        Write-Info "probing http://127.0.0.1:$OpenclawPort/v1/models (waiting for 200 with model list) ..."
        $timeout = if ($openState -eq 'active') { 5 } else { $OpenclawReadyTimeoutSec }
        $ready = Wait-Until -Probe { Test-Openclaw -Token $opTok } -TimeoutSec $timeout -IntervalMs 2000
        if ($ready) {
            $openclawOk = $true
        } else {
            $openclawErr = "no model list within ${timeout}s. Check: ``wsl bash -lc 'journalctl --user -u $OpenclawUnit -n 80 --no-pager'``"
        }
    }
}

if ($openclawOk) {
    Write-Ok "OpenClaw: http://localhost:$OpenclawPort (Codex)"
} else {
    Write-Bad "OpenClaw failed"
    Write-Info $openclawErr
}

# ---- summary -----------------------------------------------------------------

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan

[Console]::OutputEncoding = $prevOutEncoding

if ($nanoclawOk -and $openclawOk) {
    Write-Host "Both backends ready." -ForegroundColor Green
    exit 0
}

Write-Host "One or more backends failed. See messages above." -ForegroundColor Yellow
exit 2
