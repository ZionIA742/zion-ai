[CmdletBinding()]
param(
    [string]$Repository = 'C:\Users\brian\pool-ai-saas',
    [string]$DataDirectory = 'C:\Users\brian\AppData\Local\Temp\zion_pg17_probe_1887bf062b52442d9fa30f6d6a8b6274\data',
    [string]$HostAddress = '127.0.0.1',
    [int]$Port = 55433,
    [string]$User = 'zion_probe',
    [string]$MaintenanceDatabase = 'postgres'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Port -ne 55433) { throw 'ABORTADO: este procedimento aceita exclusivamente a porta 55433.' }
if ($HostAddress -ne '127.0.0.1') { throw 'ABORTADO: este procedimento aceita exclusivamente 127.0.0.1.' }
if (-not (Test-Path -LiteralPath $Repository)) { throw "Repositório inexistente: $Repository" }
if (-not (Test-Path -LiteralPath $DataDirectory)) { throw "Diretório de dados inexistente: $DataDirectory" }

$Psql = Join-Path $env:ProgramFiles 'PostgreSQL\17\bin\psql.exe'
$PgCtl = Join-Path $env:ProgramFiles 'PostgreSQL\17\bin\pg_ctl.exe'
if (-not (Test-Path -LiteralPath $Psql)) { throw "Pré-requisito ausente: $Psql" }
if (-not (Test-Path -LiteralPath $PgCtl)) { throw "Pré-requisito ausente: $PgCtl" }

$MigrationDirectory = Join-Path $Repository 'supabase\migrations'
if (-not (Test-Path -LiteralPath $MigrationDirectory)) { throw "Diretório de migrations inexistente: $MigrationDirectory" }
$Migrations = @(Get-ChildItem -LiteralPath $MigrationDirectory -File -Filter '*.sql' | Sort-Object Name)
if ($Migrations.Count -ne 444) {
    throw "ABORTADO: esperadas 444 migrations atuais; encontradas $($Migrations.Count). Nenhuma migration foi executada."
}

$P19aNames = @(
    '20261114000000_p19a_whatsapp_pin_materialization_atomicity.sql',
    '20261114030000_p19a_whatsapp_pin_replay_waba_scope.sql',
    '20261114170000_p19a_whatsapp_cutover_connection_mode_persistence.sql',
    '20261114180000_p19a_whatsapp_signup_connection_mode_preservation.sql',
    '20261114183000_p19a_whatsapp_first_connection_mode_writer.sql'
)
foreach ($name in $P19aNames) {
    if (-not (Test-Path -LiteralPath (Join-Path $MigrationDirectory $name))) {
        throw "ABORTADO: migration P19-A ausente: $name"
    }
}

$RunId = Get-Date -Format 'yyyyMMdd_HHmmss'
$LogDirectory = Join-Path $DataDirectory 'zion_etapa6_homologation_logs'
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$RunLog = Join-Path $LogDirectory "etapa6_$RunId.log"
$ServerLog = Join-Path $LogDirectory "postgres_$RunId.log"
$Report = Join-Path $LogDirectory "report_$RunId.txt"
$Database = "zion_etapa6_$([guid]::NewGuid().ToString('N').Substring(0, 12))"
$QuotedDatabase = '"' + $Database.Replace('"', '""') + '"'
$StartedByScript = $false
$DatabaseCreated = $false

function Write-Log([string]$Message) {
    $line = "$(Get-Date -Format o) $Message"
    Add-Content -LiteralPath $RunLog -Value $line
    Write-Host $line
}

function Invoke-Psql([string]$DatabaseName, [string]$Sql, [switch]$AllowFailure) {
    $out = & $Psql -X -w -h $HostAddress -p $Port -U $User -d $DatabaseName -v ON_ERROR_STOP=1 -Atc $Sql 2>&1
    $code = $LASTEXITCODE
    if ($out) { $out | Add-Content -LiteralPath $RunLog }
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "psql falhou no banco '$DatabaseName' (exit $code): $($out -join ' ')"
    }
    return @($out)
}

function Invoke-PsqlFile([string]$DatabaseName, [string]$Path) {
    $out = & $Psql -X -w -h $HostAddress -p $Port -U $User -d $DatabaseName -v ON_ERROR_STOP=1 -f $Path 2>&1
    $code = $LASTEXITCODE
    if ($out) { $out | Add-Content -LiteralPath $RunLog }
    if ($code -ne 0) {
        throw "migration falhou (exit $code): $Path`n$($out -join "`n")"
    }
}

try {
    Set-Content -LiteralPath $RunLog -Value "ZION/P19-A Etapa 6; porta exclusiva=$Port; host=$HostAddress"
    Write-Log "Pré-voo: não será usado Start-Process -Wait, porta 5432, rede remota, instalação, deploy ou alteração de arquivos SQL."

    $status = & $PgCtl status -D $DataDirectory 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log 'Cluster desligado; iniciando somente o diretório de dados fornecido.'
        & $PgCtl start -D $DataDirectory -l $ServerLog -o "-p $Port" -w 2>&1 | Tee-Object -FilePath $RunLog -Append
        if ($LASTEXITCODE -ne 0) { throw "Não foi possível iniciar o cluster. Consulte $ServerLog" }
        $StartedByScript = $true
    } else {
        Write-Log 'Cluster já estava ativo; não será reiniciado.'
    }

    $identity = Invoke-Psql $MaintenanceDatabase "select json_build_object('host',host(inet_server_addr()),'port',inet_server_port(),'data_directory',current_setting('data_directory'),'database',current_database(),'user',current_user,'version',version());"
    $identityText = $identity -join ''
    Write-Log "Identidade SQL: $identityText"
    if ($identityText -notmatch '"host"\s*:\s*"127\.0\.0\.1"' -or $identityText -notmatch '"port"\s*:\s*55433' -or $identityText -notmatch [regex]::Escape($DataDirectory.Replace('\','/'))) {
        throw 'ABORTADO: identidade SQL não correspondeu exatamente ao host, porta ou data_directory fornecidos.'
    }

    $dependencySql = @"
select json_build_object(
  'missing_roles', coalesce((select json_agg(x) from (select r from (values ('anon'),('authenticated'),('service_role')) v(r) where not exists (select 1 from pg_roles p where p.rolname=v.r) order by r) x), '[]'::json),
  'missing_schemas', coalesce((select json_agg(x) from (select s from (values ('auth'),('extensions'),('public')) v(s) where not exists (select 1 from pg_namespace n where n.nspname=v.s) order by s) x), '[]'::json),
  'installed_extensions', coalesce((select json_agg(extname order by extname) from pg_extension), '[]'::json),
  'server_version', current_setting('server_version')
);
"@
    $deps = Invoke-Psql $MaintenanceDatabase $dependencySql
    $depsText = $deps -join ''
    Write-Log "Dependências do cluster: $depsText"
    if ($depsText -match 'missing_roles.*(anon|authenticated|service_role)' -or $depsText -match 'missing_schemas.*(auth|extensions)') {
        throw "ABORTADO: PostgreSQL puro não fornece a estrutura Supabase necessária (roles/schemas auth/extensions). Não serão criados stubs nem banco descartável. Diagnóstico: $depsText"
    }

    $testDirectory = Join-Path $Repository 'supabase\tests'
    $testFiles = @(Get-ChildItem -LiteralPath $testDirectory -File -Filter '*.sql' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)p19a.*(pin|binding|connection|mode)' })
    if ($testFiles.Count -eq 0) {
        throw 'ABORTADO: não existem testes SQL correspondentes às cinco migrations P19-A. Não serão inventados testes ou dados.'
    }
    $categoryPatterns = @{
        grants = '(?i)(grant|privilege|acl)'
        rls = '(?i)(rls|row.security|policy)'
        replay = '(?i)replay'
        rollback = '(?i)rollback'
        concurrency = '(?i)(concurr|race|lock)'
        tenantIsolation = '(?i)(tenant|multi.?tenant|isolation|cross.?tenant)'
    }
    $missingCategories = @($categoryPatterns.Keys | Where-Object {
        -not ($testFiles.Name -match $categoryPatterns[$_])
    })
    if ($missingCategories.Count -gt 0) {
        throw "ABORTADO: faltam testes P19-A explícitos para: $($missingCategories -join ', '). A existência de testes de outras migrations não prova esta Etapa 6."
    }

    Write-Log "Criando banco descartável $Database."
    Invoke-Psql $MaintenanceDatabase "create database $QuotedDatabase;" | Out-Null
    $DatabaseCreated = $true
    Invoke-Psql $Database "select current_database();" | Out-Null

    Write-Log 'Executando as 444 migrations em ordem lexical.'
    foreach ($migration in $Migrations) {
        Write-Log "migration=$($migration.Name)"
        Invoke-PsqlFile $Database $migration.FullName
    }

    Write-Log 'Validando presença das cinco migrations P19-A no histórico de arquivos e no catálogo resultante.'
    foreach ($name in $P19aNames) {
        $path = Join-Path $MigrationDirectory $name
        $sha = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        Add-Content -LiteralPath $Report -Value "$name sha256=$sha"
    }

    $catalog = Invoke-Psql $Database @"
select json_build_object(
  'rls_tables', (select count(*) from pg_class where relrowsecurity),
  'policies', (select count(*) from pg_policies),
  'service_role', (select exists(select 1 from pg_roles where rolname='service_role')),
  'auth_uid', (select to_regprocedure('auth.uid()') is not null),
  'auth_role', (select to_regprocedure('auth.role()') is not null)
);
"@
    $catalogText = $catalog -join ''
    Write-Log "Catálogo pós-migrations: $catalogText"

    foreach ($test in $testFiles) {
        Write-Log "teste=$($test.Name)"
        Invoke-PsqlFile $Database $test.FullName
    }
    Write-Log 'VEREDITO: PASS - migrations, grants, RLS, replay, rollback, concorrencia e isolamento multi-tenant aprovados pelos testes SQL explicitos.'
}
catch {
    Write-Log "VEREDITO: BLOQUEADO - $($_.Exception.Message)"
    Write-Log "Logs: $RunLog; servidor: $ServerLog"
    throw
}
finally {
    if ($DatabaseCreated) {
        try {
            $terminateSql = 'select pg_terminate_backend(pid) from pg_stat_activity where datname = ''{0}'' and pid <> pg_backend_pid();' -f $Database
            Invoke-Psql $MaintenanceDatabase $terminateSql -AllowFailure | Out-Null
            Invoke-Psql $MaintenanceDatabase "drop database if exists $QuotedDatabase;" -AllowFailure | Out-Null
            Write-Log "Banco descartável removido: $Database"
        } catch { Write-Log "Falha ao remover banco descartável; intervenção manual necessária: $Database" }
    }
    if ($StartedByScript) {
        & $PgCtl stop -D $DataDirectory -m fast -w 2>&1 | Tee-Object -FilePath $RunLog -Append
        Write-Log "Cluster temporário encerrado; logs preservados em $LogDirectory"
    }
}
