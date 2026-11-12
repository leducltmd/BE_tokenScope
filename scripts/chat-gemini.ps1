param(
    [SecureString]$ApiKey,
    [switch]$NewKey
)

$ErrorActionPreference = 'Stop'
$model = 'gemini-3.5-flash-lite'
$credentialPath = Join-Path $env:LOCALAPPDATA 'TokenScope-Gemini-key.xml'
$latestCallPath = Join-Path $env:LOCALAPPDATA 'TokenScope-Gemini-last-call.json'
$pendingPath = "$latestCallPath.pending"
$messages = [System.Collections.Generic.List[object]]::new()

if ($NewKey -or (-not $ApiKey -and -not (Test-Path -LiteralPath $credentialPath))) {
    $ApiKey = Read-Host 'Paste Gemini API key' -AsSecureString
}

$saveCredential = $null -ne $ApiKey
$credential = if ($saveCredential) {
    [PSCredential]::new('Gemini API', $ApiKey)
} else {
    Import-Clixml -LiteralPath $credentialPath
}
$headers = @{ 'x-goog-api-key' = $credential.GetNetworkCredential().Password }

New-Item -ItemType Directory -Path $pendingPath -Force | Out-Null
Write-Host 'Gemini chat. Type exit to quit.'

while ($true) {
    $prompt = Read-Host 'You'
    if ($prompt.Trim() -eq 'exit') { break }
    if ([string]::IsNullOrWhiteSpace($prompt)) { continue }

    $question = @{ role = 'user'; parts = @(@{ text = $prompt }) }
    $body = @{
        contents = @($messages.ToArray()) + @($question)
        generationConfig = @{ maxOutputTokens = 1024 }
    } | ConvertTo-Json -Depth 20

    try {
        $result = Invoke-RestMethod -ErrorAction Stop -TimeoutSec 60 -MaximumRedirection 0 `
            -Uri "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent" `
            -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' `
            -Body ([Text.Encoding]::UTF8.GetBytes($body))
    } catch {
        Write-Warning "Gemini request failed. $($_.Exception.Message)"
        continue
    }

    if ($saveCredential) {
        $credential | Export-Clixml -LiteralPath $credentialPath
        $saveCredential = $false
    }

    $candidate = $result.candidates | Select-Object -First 1
    if ($candidate.content) {
        $messages.Add($question)
        $messages.Add($candidate.content)
        $answer = $candidate.content.parts | Where-Object { -not $_.thought } |
            Select-Object -ExpandProperty text -ErrorAction SilentlyContinue
        Write-Host ($answer -join '')
    }

    $usage = $result.usageMetadata
    if ($null -eq $usage.totalTokenCount) {
        Write-Warning 'Gemini did not return token counts for this request.'
        continue
    }

    $entryId = [guid]::NewGuid().ToString('N')
    $call = @{
        model = $result.modelVersion
        responseId = if ($result.responseId) { $result.responseId } else { $entryId }
        usageMetadata = $usage
    } | ConvertTo-Json -Depth 8

    $pendingFile = Join-Path $pendingPath "$entryId.tmp"
    Set-Content -LiteralPath $pendingFile -Value $call -Encoding UTF8
    Rename-Item -LiteralPath $pendingFile -NewName "$entryId.json"
    Set-Content -LiteralPath $latestCallPath -Value $call -Encoding UTF8
    Write-Host "Tokens: $($usage.totalTokenCount) total. Open TokenScope > Lich su to view."
}
