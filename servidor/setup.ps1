# Preparação do ambiente no Windows.
#
# Uso, no PowerShell, dentro da pasta do projeto:
#
#     .\setup.ps1
#
# Se o Windows recusar por política de execução, rode antes:
#
#     Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== EPI Server - preparacao ===" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------- 1. Docker
Write-Host "[1/3] Verificando o Docker..."

$dockerOk = $false
try {
    docker version --format '{{.Server.Version}}' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
} catch { }

if (-not $dockerOk) {
    Write-Host ""
    Write-Host "  O motor do Docker nao esta respondendo." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  O Docker Desktop precisa estar ABERTO E RODANDO - nao basta"
    Write-Host "  estar instalado. Abra o Docker Desktop pelo menu Iniciar e"
    Write-Host "  espere o icone da baleia ficar estavel (ele mostra"
    Write-Host "  'Engine running' quando esta pronto). Depois rode este"
    Write-Host "  script de novo."
    Write-Host ""
    exit 1
}
Write-Host "      Docker respondendo." -ForegroundColor Green

# ------------------------------------------------------------------ 2. .env
Write-Host "[2/3] Preparando o arquivo .env..."

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "      .env criado a partir do .env.example."
} else {
    Write-Host "      .env ja existe; mantendo."
}

# Gera 48 bytes aleatorios e converte para base64url - equivalente ao
# secrets.token_urlsafe(48) do Python, sem precisar de Python instalado.
$conteudo = Get-Content ".env" -Raw
if ($conteudo -match "troque-isto-por-um-segredo") {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $segredo = [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_').TrimEnd('=')

    $conteudo = $conteudo -replace "JWT_SECRET=.*", "JWT_SECRET=$segredo"
    Set-Content ".env" $conteudo -NoNewline
    Write-Host "      JWT_SECRET gerado." -ForegroundColor Green
} else {
    Write-Host "      JWT_SECRET ja foi trocado; mantendo."
}

# ------------------------------------------------------------------ 3. subir
Write-Host "[3/3] Subindo os conteineres (a primeira vez demora)..."
Write-Host ""

docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  Falhou. Rode 'docker compose logs' para ver o motivo." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "=== Pronto ===" -ForegroundColor Green
Write-Host ""
Write-Host "  API      http://localhost:8000/docs"
Write-Host "  MinIO    http://localhost:9090   (minioadmin / minioadmin)"
Write-Host ""
Write-Host "  Ver os logs:        docker compose logs -f api worker"
Write-Host "  Espiar o MQTT:      docker compose exec broker mosquitto_sub -h localhost -t 'epi/#' -v"
Write-Host "  Rodar os testes:    docker compose exec api python -m scripts.testar_fluxo"
Write-Host "  Derrubar:           docker compose down"
Write-Host ""
