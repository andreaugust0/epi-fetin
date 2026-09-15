<#
    Backup do banco do EPI Fetin, com prova de que o arquivo presta.

    Um dump que nunca foi restaurado nao e um backup, e uma esperanca. Por
    isso este script nao para no pg_dump: ele restaura o arquivo recem-criado
    num banco temporario, conta o que voltou, e so entao declara sucesso.

    O dump acontece DENTRO do container e sai por 'docker compose cp'. Nao use
    redirecionamento do PowerShell ('> arquivo.sql'): o PowerShell 5.1 grava em
    UTF-16, o psql nao le isso de volta, e o defeito so aparece no dia em que
    voce precisar restaurar.

    Este arquivo e ASCII puro de proposito. Acento em script .ps1 depende da
    codificacao com que o PowerShell 5.1 le o arquivo, e quando ele erra a
    leitura o script inteiro para de compilar com erros que nao tem relacao
    nenhuma com a causa.

    Uso:
        .\backup.ps1
        .\backup.ps1 -Restaurar backups\epi-20260914-213000.sql
#>
[CmdletBinding()]
param(
    [string]$Restaurar,
    [int]$Manter = 10
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Falhar($mensagem) {
    Write-Host ""
    Write-Host "FALHOU: $mensagem" -ForegroundColor Red
    exit 1
}

# Comando nativo nao levanta excecao no PowerShell; o codigo de saida e o
# unico sinal. Sem esta checagem, um pg_dump que falhou gera arquivo vazio e
# o script segue anunciando sucesso.
function Conferir($oque) {
    if ($LASTEXITCODE -ne 0) { Falhar $oque }
}

$rodando = docker compose ps --status running --services 2>$null
if ($rodando -notcontains 'db') {
    Falhar "o container 'db' nao esta rodando. Rode 'docker compose up -d' antes."
}

$SQL_RESUMO = "select (select count(*) from pessoas) || '|' || (select count(*) from biometrias) || '|' || (select count(*) from identificacoes) || '|' || (select count(*) from verificacoes);"

# --------------------------------------------------------------- restauracao
if ($Restaurar) {
    if (-not (Test-Path $Restaurar)) { Falhar "arquivo nao encontrado: $Restaurar" }
    $completo = (Resolve-Path $Restaurar).Path

    Write-Host "Isto APAGA o banco atual e coloca o conteudo de:" -ForegroundColor Yellow
    Write-Host "  $completo" -ForegroundColor Yellow
    $resposta = Read-Host "Digite RESTAURAR para confirmar"
    if ($resposta -ne 'RESTAURAR') { Write-Host "Cancelado."; exit 0 }

    docker compose cp $completo db:/tmp/restaurar.sql
    Conferir "nao consegui copiar o arquivo para o container"

    # A API segura o banco aberto, e DROP DATABASE falha enquanto houver
    # qualquer conexao viva.
    docker compose stop api worker | Out-Null

    docker compose exec -T db psql -U postgres -c "DROP DATABASE IF EXISTS epi;" | Out-Null
    Conferir "nao consegui apagar o banco atual"
    docker compose exec -T db psql -U postgres -c "CREATE DATABASE epi;" | Out-Null
    Conferir "nao consegui criar o banco"
    docker compose exec -T db psql -U postgres -d epi -f /tmp/restaurar.sql | Out-Null
    Conferir "a restauracao falhou"

    docker compose start api worker | Out-Null

    $linha = docker compose exec -T db psql -U postgres -d epi -t -A -c $SQL_RESUMO
    $n = ($linha | Out-String).Trim() -split '\|'
    Write-Host ""
    Write-Host "Restaurado: $($n[0]) pessoas, $($n[1]) vetores." -ForegroundColor Green
    exit 0
}

# -------------------------------------------------------------------- backup
$pasta = Join-Path $PSScriptRoot 'backups'
if (-not (Test-Path $pasta)) { New-Item -ItemType Directory -Path $pasta | Out-Null }

$carimbo = Get-Date -Format 'yyyyMMdd-HHmmss'
$arquivo = Join-Path $pasta "epi-$carimbo.sql"

Write-Host "1/3  gerando o dump..."
docker compose exec -T db pg_dump -U postgres --clean --if-exists -f /tmp/epi.sql epi
Conferir "pg_dump nao terminou bem"

docker compose cp db:/tmp/epi.sql $arquivo
Conferir "nao consegui trazer o arquivo do container"

$tamanho = (Get-Item $arquivo).Length
if ($tamanho -lt 1024) { Falhar "o arquivo saiu com $tamanho bytes, algo esta errado" }

# ------------------------------------------------------------------ verificar
# Restaura num banco descartavel. E o unico jeito de saber que o arquivo
# funciona sem arriscar o banco de verdade.
Write-Host "2/3  verificando (restaura num banco temporario)..."
# Hifen nao vale em identificador do Postgres sem aspas, e o carimbo tem um.
$temp = "verificar_" + ($carimbo -replace '-', '_')

docker compose exec -T db psql -U postgres -c "DROP DATABASE IF EXISTS $temp;" | Out-Null
docker compose exec -T db psql -U postgres -c "CREATE DATABASE $temp;" | Out-Null
Conferir "nao consegui criar o banco temporario"

docker compose exec -T db psql -U postgres -d $temp -v ON_ERROR_STOP=1 -f /tmp/epi.sql 2>&1 | Out-Null
$restauroOk = ($LASTEXITCODE -eq 0)

$resumo = ""
if ($restauroOk) {
    $linha = docker compose exec -T db psql -U postgres -d $temp -t -A -c $SQL_RESUMO
    $resumo = ($linha | Out-String).Trim()
}

docker compose exec -T db psql -U postgres -c "DROP DATABASE IF EXISTS $temp;" | Out-Null

if (-not $restauroOk -or $resumo -eq "") {
    Falhar "o dump foi criado mas NAO restaura. Nao confie neste arquivo."
}

$n = $resumo -split '\|'
if ([int]$n[0] -eq 0) {
    Falhar "restaurou, mas sem nenhuma pessoa. Confira se e o banco certo."
}

# -------------------------------------------------------------------- limpeza
Write-Host "3/3  limpando backups antigos..."
Get-ChildItem $pasta -Filter 'epi-*.sql' | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Manter | Remove-Item -Force

Write-Host ""
Write-Host "Backup verificado." -ForegroundColor Green
Write-Host "  arquivo ........ $arquivo"
Write-Host "  tamanho ........ $([math]::Round($tamanho/1KB,1)) KB"
Write-Host "  pessoas ........ $($n[0])"
Write-Host "  vetores ........ $($n[1])"
Write-Host "  identificacoes . $($n[2])"
Write-Host "  verificacoes ... $($n[3])"
Write-Host ""
Write-Host "Leve uma copia deste arquivo para fora desta maquina." -ForegroundColor Cyan