param([switch]$WebOnly)

$ErrorActionPreference = 'Stop'
$backend = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path (Split-Path -Parent $backend) 'FE_tokenScope\build\web'
$webUrl = 'http://127.0.0.1:8100/'
$apiUrl = 'http://127.0.0.1:3000/api/health'
$node = (Get-Command node.exe -ErrorAction Stop).Source

function Test-LocalHttp([string]$Url) {
    try {
        return (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200
    } catch {
        return $false
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $frontend 'index.html'))) {
    throw "TokenScope Web build is missing: $frontend"
}

$startApi = -not (Test-LocalHttp $apiUrl)
$startWeb = -not (Test-LocalHttp $webUrl)
if ($startApi -or $startWeb) {
    $program = @'
const path = require('node:path');
const [startApi, startWeb] = process.argv.slice(1);
(async () => {
  if (startApi === 'True') {
    const { prisma } = require('./src/config/prisma.ts');
    const { createApp } = require('./src/app.ts');
    await prisma.$connect();
    createApp().listen(3000, '127.0.0.1');
  }
  if (startWeb === 'True') {
    const express = require('express');
    const web = express();
    web.use(express.static(path.resolve('../FE_tokenScope/build/web')));
    web.listen(8100, '127.0.0.1');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
'@
    $inlineProgram = '"' + ($program -replace '\r?\n', ' ') + '"'
    $logPath = Join-Path $env:LOCALAPPDATA 'TokenScope-startup.log'
    $server = Start-Process -FilePath $node -WorkingDirectory $backend -WindowStyle Hidden `
        -ArgumentList @('--env-file=.env', '--import', 'tsx', '-e', $inlineProgram, "$startApi", "$startWeb") `
        -RedirectStandardError $logPath -PassThru

    $ready = $false
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        if ((Test-LocalHttp $apiUrl) -and (Test-LocalHttp $webUrl)) {
            $ready = $true
            break
        }
        if ($server.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
        throw "TokenScope could not start. Check $logPath"
    }
}

Write-Host "TokenScope Web: $webUrl"
if (-not $WebOnly) {
    & (Join-Path $PSScriptRoot 'chat-gemini.ps1')
}
