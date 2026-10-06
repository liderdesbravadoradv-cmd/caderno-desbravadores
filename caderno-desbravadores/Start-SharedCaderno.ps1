$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$allowedFile = Join-Path $project 'allowed-emails.txt'
$serverFile = Join-Path $project 'server.mjs'
$dataFolder = Join-Path $project 'local-data'
$bundledCloudflared = Join-Path $project 'tools\cloudflared.exe'
$port = 8787

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js não foi encontrado. Instale o Node.js 24 ou mais recente e tente novamente.'
}
$nodeVersion = (node -p "process.versions.node").Split('.')[0]
if ([int]$nodeVersion -lt 24) { throw 'Este servidor precisa do Node.js 24 ou mais recente.' }
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared -and (Test-Path -LiteralPath $bundledCloudflared)) {
  $cloudflared = [pscustomobject]@{ Source = $bundledCloudflared }
}
if (-not $cloudflared) {
  throw 'cloudflared não foi encontrado. Instale o cliente oficial do Cloudflare Tunnel e abra esta janela novamente.'
}
if (-not (Test-Path -LiteralPath $allowedFile)) {
  throw "Crie o arquivo $allowedFile com um e-mail autorizado em cada linha. Ele fica fora do GitHub."
}
$emails = @(Get-Content -LiteralPath $allowedFile | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
$invalidEmails = @($emails | Where-Object { $_ -notmatch '^[^@ ]+@[^@ ]+[.][^@ ]+$' })
if ($emails.Count -eq 0 -or $invalidEmails.Count -gt 0) {
  throw 'A lista de e-mails está vazia ou contém um endereço inválido. Corrija allowed-emails.txt.'
}
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  throw "A porta $port já está em uso. Feche o Caderno servidor que estiver aberto e tente novamente."
}

New-Item -ItemType Directory -Path $dataFolder -Force | Out-Null
$env:CADERNO_DATA_DIR = $dataFolder
$env:PORT = "$port"
$node = (Get-Command node).Source
$server = Start-Process -FilePath $node -ArgumentList @('server.mjs') -WorkingDirectory $project -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
if ($server.HasExited) { throw 'O servidor não iniciou. Confira a instalação do Node.js e os arquivos do projeto.' }

try {
  Write-Host 'Caderno servidor ativo. Esta janela mostra o endereço temporário do Cloudflare.' -ForegroundColor Green
  Write-Host 'Para encerrar o acesso, pressione Ctrl+C. O banco permanece salvo em local-data.'
  $argsTunnel = @('tunnel', '--url', "http://127.0.0.1:$port")
  foreach ($email in $emails) { $argsTunnel += @('--allowed-mail', $email) }
  & $cloudflared.Source @argsTunnel
}
finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
