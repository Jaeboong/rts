#requires -Version 5.1
<#
.SYNOPSIS
    Start the Nanoclaw (Claude) bridge only.

.DESCRIPTION
    Thin wrapper that converts the .sh path to a WSL path and runs it.
    All real logic lives in start-claude.sh — keeping bash out of a PowerShell
    here-string avoids CRLF/encoding mangling on the pipe to wsl.exe.

.EXAMPLE
    PS> .\tools\start-claude.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$prevOutEncoding = [Console]::OutputEncoding
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Write-Host ""
Write-Host "Nanoclaw (Claude) bridge" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan

try {
    $null = wsl.exe -l -q 2>$null
    if ($LASTEXITCODE -ne 0) { throw "wsl exit $LASTEXITCODE" }
} catch {
    Write-Host "[FAIL] WSL not reachable. Run ``wsl --install`` first." -ForegroundColor Red
    [Console]::OutputEncoding = $prevOutEncoding
    exit 1
}

# Manually convert C:\...\start-claude.sh -> /mnt/c/.../start-claude.sh.
# `wsl wslpath` mangles backslashes through the PowerShell→wsl arg pass.
$winPath = Join-Path $PSScriptRoot 'start-claude.sh'
$drive = $winPath.Substring(0, 1).ToLower()
$wslPath = "/mnt/$drive" + $winPath.Substring(2).Replace('\', '/')

wsl.exe bash -l "$wslPath"
$rc = $LASTEXITCODE

[Console]::OutputEncoding = $prevOutEncoding
exit $rc
