if (-not $env:SEEDANCE_API_KEY) {
  Write-Host "Warning: SEEDANCE_API_KEY is not set. The page will open, but video generation will fail until the key is set."
  Write-Host "To set it in this PowerShell window:"
  Write-Host '$env:SEEDANCE_API_KEY="your_api_key_here"'
}

$nodeExe = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if (Test-Path $nodeExe) {
  & $nodeExe .\seedance_server.js
} else {
  node .\seedance_server.js
}

Write-Host ""
Write-Host "Seedance tool stopped. If this was unexpected, copy the error above and send it to Codex."
Read-Host "Press Enter to close"
