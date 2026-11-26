& {
    $ErrorActionPreference = 'Stop'
    $psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
    $root = 'C:\Users\brian\pool-ai-saas'
    $report = New-Object 'System.Collections.Generic.List[string]'
    $sessions = New-Object 'System.Collections.Generic.List[object]'
    $orgA = [guid]::NewGuid().Guid
    $orgB = [guid]::NewGuid().Guid
    $actor = [guid]::NewGuid().Guid
    $verdict = 'FAIL'
    $behaviorPass = $false
    $recoveryPass = $false
    $recoveryGuardPass = $false
    $explicitRollback = $false
    $baseline = $null
    $postPass = $false
    $cleanupPass = $true
    $senha = $null
    $remoteAttempted = $false
    $saved = @{}
    foreach ($name in @('PGPASSWORD','PGSSLMODE','PGCONNECT_TIMEOUT')) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name,'Process')
    }

    function Log([string]$line) {
        $report.Add($line)
        Write-Host $line
    }
    function Start-Session([string]$label) {
        $si = New-Object System.Diagnostics.ProcessStartInfo
        $si.FileName = $psql
        $si.Arguments = '-X -w -q -A -t -F "|" -P pager=off -v ON_ERROR_STOP=1 -h aws-1-us-east-1.pooler.supabase.com -p 5432 -U postgres.bcrvbdyfxdarmftwsgxk -d postgres -f -'
        $si.UseShellExecute = $false
        $si.CreateNoWindow = $true
        $si.RedirectStandardInput = $true
        $si.RedirectStandardOutput = $true
        $si.RedirectStandardError = $true
        $p = New-Object System.Diagnostics.Process
        $p.StartInfo = $si
        if (-not $p.Start()) { throw "PSQL_START_FAILED:$label" }
        $s = [pscustomobject]@{ Label=$label; P=$p; Err=$p.StandardError.ReadToEndAsync(); Closed=$false }
        $sessions.Add($s)
        return $s
    }
    function Send($s,[string]$sql) {
        if ($s.P.HasExited) { throw "PSQL_ALREADY_EXITED:$($s.Label)" }
        $s.P.StandardInput.WriteLine($sql)
        $s.P.StandardInput.Flush()
    }
    function Read-Marker($s,[string]$marker,[int]$seconds=60) {
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $lines = New-Object 'System.Collections.Generic.List[string]'
        while ($true) {
            $remaining = [int]($seconds*1000 - $clock.ElapsedMilliseconds)
            if ($remaining -le 0) { throw "MARKER_TIMEOUT:$($s.Label):$marker" }
            $task = $s.P.StandardOutput.ReadLineAsync()
            if (-not $task.Wait($remaining)) { throw "READ_TIMEOUT:$($s.Label):$marker" }
            $line = $task.Result
            if ($null -eq $line) { throw "PSQL_EOF:$($s.Label):$marker" }
            $lines.Add($line)
            Log "$($s.Label)|$line"
            if ($line -eq $marker -or ($marker.EndsWith('|') -and $line.StartsWith($marker))) {
                return ,($lines.ToArray())
            }
        }
    }
    function Close-Session($s) {
        if ($null -eq $s -or $s.Closed) { return }
        try {
            if (-not $s.P.HasExited) {
                try { $s.P.StandardInput.Close() } catch {}
                if (-not $s.P.WaitForExit(2000)) {
                    $s.P.Kill()
                    if (-not $s.P.WaitForExit(10000)) { throw 'PROCESS_STILL_RUNNING' }
                }
            }
            Log "$($s.Label)_EXIT=$($s.P.ExitCode)"
            if ($s.Err.Wait(5000) -and $s.Err.Result) { Log "$($s.Label)_STDERR=$($s.Err.Result.Trim())" }
            elseif (-not $s.Err.IsCompleted) { throw 'STDERR_NOT_COMPLETED' }
            $s.Closed = $true
            $s.P.Dispose()
        } catch {
            Log "CLEANUP_ERROR:$($s.Label):$($_.Exception.Message)"
            throw
        }
    }
    function End-Session($s,[string]$marker) {
        Send $s ("rollback;`nselect '$marker';`n\q")
        $null = Read-Marker $s $marker 20
        if (-not $s.P.WaitForExit(15000)) { throw "PSQL_EXIT_TIMEOUT:$($s.Label)" }
        if ($s.P.ExitCode -ne 0) { throw "PSQL_EXIT_FAILURE:$($s.Label)" }
        Close-Session $s
    }
    function Get-ApprovedBody([string]$path,[string]$expected) {
        if (-not (Test-Path -LiteralPath $path)) { throw "FILE_MISSING:$path" }
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        Log "SOURCE_SHA256|$([IO.Path]::GetFileName($path))|$hash"
        if ($hash -ne $expected) { throw "SOURCE_HASH_MISMATCH:$path" }
        $lines = (Get-Content -LiteralPath $path -Raw) -split '\r?\n'
        $starts = @(for ($i=0;$i -lt $lines.Count;$i++) { if ($lines[$i].Trim() -eq 'begin;') { $i } })
        $endWord = if ($path -like '*atomic_commercial_memory_promotion.sql') { 'commit;' } else { 'rollback;' }
        $ends = @(for ($i=0;$i -lt $lines.Count;$i++) { if ($lines[$i].Trim() -eq $endWord) { $i } })
        if ($starts.Count -ne 1 -or $ends.Count -ne 1 -or $starts[0] -ge $ends[0]) { throw "INVALID_BOUNDARIES:$path" }
        $body = $lines[($starts[0]+1)..($ends[0]-1)] -join "`n"
        if ($body -match '(?im)^[ \t]*(begin|commit|rollback)\s*;[ \t]*\r?$' -or $body -match '(?m)^[ \t]*\\') { throw "UNEXPECTED_SQL_BOUNDARY:$path" }
        return $body
    }

    try {
        Set-Location -LiteralPath $root
        Log '===== ZION | PILAR 9 | BLOCO 11 ====='
        Log 'ETAPA=1/3'
        Log 'MICROETAPA=1.5'
        Log 'MODE=ATOMIC_PROMOTION_TWO_BACKEND_ROLLBACK'
        Log "HEAD_INITIAL=$(git rev-parse HEAD)"
        Log "SYNTHETIC_ORG_TARGET=$orgA"
        Log "SYNTHETIC_ORG_FOREIGN=$orgB"
        Log "SYNTHETIC_ACTOR=$actor"
        if (-not (Test-Path -LiteralPath $psql)) { throw 'PSQL_NOT_FOUND' }
        $fixture = Get-ApprovedBody 'supabase/homologation/20261125020001_p9_10_4_d_recovery_fixture_runner.sql' '943FA05D514D89A6EDA675665BC17A40152302B093EB7D91BB193BCF2DBE8BA7'
        $migration = Get-ApprovedBody 'supabase/migrations/20261126180000_p9_b11_atomic_commercial_memory_promotion.sql' '6F25049C1AEFAEA8D92B77800DDA0831FA557B20662F7BC145E1530ABCD7DF9A'
        $pattern = [regex]::new('(?m)^  gen_random_uuid\(\),[ \t]*\r?$')
        if (-not $pattern.IsMatch($fixture)) { throw 'FIXTURE_UUID_GENERATOR_NOT_FOUND' }
        $fixture = $pattern.Replace($fixture,"  case when fixture_name='target' then '$orgA'::uuid else '$orgB'::uuid end,",1)
        $senha = Read-Host 'Digite somente a senha do banco Supabase' -AsSecureString
        $env:PGPASSWORD = [System.Net.NetworkCredential]::new('', $senha).Password
        $env:PGSSLMODE = 'require'
        $env:PGCONNECT_TIMEOUT = '15'
        $remoteAttempted = $true
        $catalogSql = @'
begin read only;
set local statement_timeout='30s';
select 'CATALOG|'||md5(coalesce(string_agg(p.oid::text||':'||p.proowner::text||':'||coalesce(p.proacl::text,'<default>')||':'||pg_get_functiondef(p.oid),'|' order by p.oid),''))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f' and (p.proname like '%commercial%qualification%fact%' or p.proname like '%human%decision%evidence%' or p.proname like 'p9_10_4_d_%recovery%authority' or p.proname='p9_10_4_d_write_recovery_qualification_fact_by_system' or p.proname='promote_commercial_memory_fact_if_absent_by_system');
select 'RPC_COUNT|'||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='promote_commercial_memory_fact_if_absent_by_system';
select 'REGISTRY_COUNT|'||count(*) from supabase_migrations.schema_migrations where version='20261126180000';
select 'ACTIVATION|'||md5(coalesce(jsonb_agg(to_jsonb(a))::text,'[]')) from public.zion_p9_recovery_activation a;
select 'RECOVERY_ARGUMENTS|'||pg_get_function_identity_arguments('public.p9_10_4_d_write_recovery_qualification_fact_by_system(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure);
select 'RECOVERY_ORDER_RISK|'||case when
  pg_get_functiondef('public.p9_10_4_d_assert_recovery_write_authority(uuid,uuid,uuid,uuid)'::regprocedure) ~* 'commercial_opportunities[^;]+for update'
  and pg_get_functiondef('public.apply_commercial_opportunity_qualification_fact_internal(uuid,uuid,uuid,text,text,jsonb,text,text,uuid,uuid,text,boolean)'::regprocedure) ~* 'pg_advisory_xact_lock.*commercial_opportunities[^;]+for key share'
  then 'OPPORTUNITY_BEFORE_FACT_VS_FACT_BEFORE_OPPORTUNITY' else 'NOT_DETERMINED' end;
select 'CATALOG_DONE';
'@
        $preSession = Start-Session 'PRE'
        Send $preSession $catalogSql
        $preLines = Read-Marker $preSession 'CATALOG_DONE' 45
        $baseline = @($preLines | Where-Object { $_ -match '^(CATALOG|RPC_COUNT|REGISTRY_COUNT|ACTIVATION|RECOVERY_ARGUMENTS|RECOVERY_ORDER_RISK)\|' })
        End-Session $preSession 'PRE_ROLLBACK_OK'
        if ($baseline.Count -ne 6 -or $baseline -notcontains 'RPC_COUNT|0' -or $baseline -notcontains 'REGISTRY_COUNT|0') { throw 'BASELINE_NOT_SAFE_FOR_TEMPORARY_INSTALL' }
        $b = Start-Session 'B'
        Send $b @'
begin;
set local statement_timeout='60s';
set local lock_timeout='5s';
set local idle_in_transaction_session_timeout='120s';
set local search_path=pg_catalog,public,auth,extensions;
do $pre$ begin
 if current_user <> 'postgres' or session_user <> 'postgres' or current_database() <> 'postgres' then raise exception 'DATABASE_IDENTITY_MISMATCH'; end if;
end; $pre$;
select 'B_PREFLIGHT_OK';
'@
        $null = Read-Marker $b 'B_PREFLIGHT_OK' 45
        Log 'PREFLIGHT=PASS'
        $identity = @'
insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data)
values ('__ACTOR__'::uuid,'zion-b11-__ACTOR__@example.invalid','authenticated','authenticated','{}'::jsonb,'{"name":"ZION synthetic actor","full_name":"ZION synthetic actor"}'::jsonb);
insert into public.memberships(id,organization_id,user_id,role,is_active)
select gen_random_uuid(),organization_id,'__ACTOR__'::uuid,'owner',true
from pg_temp.p9_recovery_fixture where fixture_name='target';
select 'B_PID|'||pg_backend_pid();
select 'TARGET|'||organization_id||'|'||store_id||'|'||opportunity_id
from pg_temp.p9_recovery_fixture where fixture_name='target';
select 'B_READY';
'@
        Send $b ($fixture + "`n" + $migration + "`n" + $identity.Replace('__ACTOR__',$actor))
        $ready = Read-Marker $b 'B_READY' 90
        $pidLine = @($ready | Where-Object { $_ -match '^B_PID\|[0-9]+$' })
        $target = @($ready | Where-Object { $_ -match '^TARGET\|' })
        if ($pidLine.Count -ne 1 -or $target.Count -ne 1) { throw 'FIXTURE_IDENTITY_MISSING' }
        $bPid = [int]($pidLine[0].Split('|')[1])
        $parts = $target[0].Split('|')
        if ($parts.Count -ne 4 -or $parts[1] -ne $orgA) { throw 'FIXTURE_ORG_MISMATCH' }
        $store = ([guid]$parts[2]).Guid
        $opp = ([guid]$parts[3]).Guid
        Log 'SYNTHETIC_FIXTURE_READY=PASS'
        $a = Start-Session 'A'
        Send $a @"
begin;
set local statement_timeout='20s';
set local lock_timeout='5s';
set local idle_in_transaction_session_timeout='120s';
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('zion:p9:qfact:${orgA}:${store}:${opp}:budget_text',0));
select 'A_LOCKED|'||pg_backend_pid();
"@
        $aReady = Read-Marker $a 'A_LOCKED|' 30
        $aPid = [int](($aReady | Where-Object { $_ -match '^A_LOCKED\|[0-9]+$' } | Select-Object -First 1).Split('|')[1])
        if ($aPid -eq $bPid) { throw 'BACKEND_PID_NOT_DISTINCT' }
        Log "DISTINCT_BACKEND_PIDS=PASS|A=$aPid|B=$bPid"
        $contention = @'
set local lock_timeout='2s';
set local statement_timeout='15s';
do $contention$
declare
  f record;
  k bigint;
  st text;
  ctx text;
begin
  select * into strict f from pg_temp.p9_recovery_fixture where fixture_name='target';
  if exists(select 1 from public.commercial_opportunity_qualification_facts_current where organization_id=f.organization_id and commercial_opportunity_id=f.opportunity_id) then raise exception 'FIXTURE_FACTS_NOT_EMPTY'; end if;
  k := pg_catalog.hashtextextended('zion:p9:qfact:'||f.organization_id||':'||f.store_id||':'||f.opportunity_id||':budget_text',0);
  if not exists(select 1 from pg_locks where locktype='advisory' and pid=__A_PID__ and granted and objsubid=1 and classid::bigint=((k >> 32) & 4294967295::bigint) and objid::bigint=(k & 4294967295::bigint)) then raise exception 'A_CANONICAL_LOCK_NOT_HELD'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role','',true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','__ACTOR__')::text,true);
  begin
    perform public.write_commercial_qualification_fact_by_user_if_current(f.organization_id,f.store_id,f.opportunity_id,'p9b11_lock_human:'||f.opportunity_id,'budget_text',to_jsonb('synthetic blocked human'::text),null,null,null,false);
    raise exception 'HUMAN_WRITER_DID_NOT_WAIT';
  exception when lock_not_available then
    get stacked diagnostics st=returned_sqlstate,ctx=pg_exception_context;
    if st is distinct from '55P03' or coalesce(ctx,'') not ilike '%pg_advisory_xact_lock%' then raise exception 'HUMAN_LOCK_CONTEXT_INVALID:%:%',st,ctx; end if;
  end;
  raise notice 'HUMAN_CONTENTION=PASS|SQLSTATE=55P03';
  execute 'set local role service_role';
  perform set_config('request.jwt.claim.role','',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  begin
    perform public.promote_commercial_memory_fact_if_absent_by_system(f.organization_id,f.store_id,f.opportunity_id,'p9b11_lock_system:'||f.opportunity_id,'  budget_text  ',to_jsonb('synthetic blocked system'::text),'confirmed','incoming_customer_message',f.anchor_message_id,f.conversation_id,'p9b11_lock_test',false);
    raise exception 'SYSTEM_WRITER_DID_NOT_WAIT';
  exception when lock_not_available then
    get stacked diagnostics st=returned_sqlstate,ctx=pg_exception_context;
    if st is distinct from '55P03' or coalesce(ctx,'') not ilike '%pg_advisory_xact_lock%' then raise exception 'SYSTEM_LOCK_CONTEXT_INVALID:%:%',st,ctx; end if;
  end;
  raise notice 'SYSTEM_CONTENTION=PASS|SQLSTATE=55P03';
  execute 'reset role';
  if not exists(select 1 from pg_locks where locktype='advisory' and pid=__A_PID__ and granted and objsubid=1 and classid::bigint=((k >> 32) & 4294967295::bigint) and objid::bigint=(k & 4294967295::bigint)) then raise exception 'A_LOCK_LOST_DURING_PROOF'; end if;
  if exists(select 1 from public.commercial_opportunity_qualification_fact_events where organization_id=f.organization_id and commercial_opportunity_id=f.opportunity_id) or exists(select 1 from public.commercial_human_decision_evidence where organization_id=f.organization_id and commercial_opportunity_id=f.opportunity_id) or exists(select 1 from public.commercial_opportunity_qualification_facts_current where organization_id=f.organization_id and commercial_opportunity_id=f.opportunity_id) then raise exception 'BLOCKED_WRITER_LEFT_CHANGES'; end if;
end;
$contention$;
reset role;
select 'B_CONTENTION_OK';
'@
        Send $b ($contention.Replace('__A_PID__',[string]$aPid).Replace('__ACTOR__',$actor))
        $null = Read-Marker $b 'B_CONTENTION_OK' 30
        Log 'PROMOTION_AND_HUMAN_CAS_CONTENTION=PASS'
        End-Session $a 'A_ROLLBACK_OK'
        $checks = @'
reset role;
set local statement_timeout='60s';
set local lock_timeout='5s';
do $checks$
declare f record; x record; r record; h record; first_id uuid; h_id uuid; conflict_id uuid; st text; msg text;
begin
 select * into strict f from pg_temp.p9_recovery_fixture where fixture_name='target';
 select * into strict x from pg_temp.p9_recovery_fixture where fixture_name='foreign';
 execute 'set local role service_role';
 perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 select * into strict r from public.promote_commercial_memory_fact_if_absent_by_system(f.organization_id,f.store_id,f.opportunity_id,f.operation_prefix||':atomic-empty','  location_text  ',to_jsonb('Campinas, SP'::text),'confirmed','incoming_customer_message',f.anchor_message_id,f.conversation_id,'commercial_memory_promotion_v1',false);
 if r.outcome is distinct from 'promoted_created' or r.event_id is null or r.current_value_json is distinct from to_jsonb('Campinas, SP'::text) then raise exception 'EMPTY_PROMOTION_FAILED'; end if;
 first_id:=r.event_id;
 select * into strict r from public.promote_commercial_memory_fact_if_absent_by_system(f.organization_id,f.store_id,f.opportunity_id,f.operation_prefix||':atomic-empty','location_text',to_jsonb('Campinas, SP'::text),'confirmed','incoming_customer_message',f.anchor_message_id,f.conversation_id,'commercial_memory_promotion_v1',false);
 if r.outcome is distinct from 'ignored_existing_current' or r.event_id is distinct from first_id then raise exception 'REPLAY_FAILED'; end if;
 execute 'set local role authenticated';
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','__ACTOR__')::text,true);
 st:=null;
 begin
  perform public.promote_commercial_memory_fact_if_absent_by_system(f.organization_id,f.store_id,f.opportunity_id,f.operation_prefix||':acl','decision_context',to_jsonb('invalid'::text),'confirmed','incoming_customer_message',f.anchor_message_id,f.conversation_id,'commercial_memory_promotion_v1',false);
 exception when others then get stacked diagnostics st=returned_sqlstate,msg=message_text; end;
 if st is distinct from '42501' or msg not like 'permission denied for function%' then raise exception 'ACL_FAILED:%:%',st,msg; end if;
 select * into strict h from public.write_commercial_qualification_fact_by_user_if_current(f.organization_id,f.store_id,f.opportunity_id,f.operation_prefix||':human-first','budget_text',to_jsonb('human-confirmed'::text),null,null,null,false);
 if h.changed is distinct from true or h.current_state is distinct from 'confirmed' then raise exception 'HUMAN_FIRST_FAILED'; end if;
 h_id:=h.current_last_event_id;
 execute 'set local role service_role'; perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 select * into strict r from public.promote_commercial_memory_fact_if_absent_by_system(f.organization_id,f.store_id,f.opportunity_id,f.operation_prefix||':ignored-human','budget_text',to_jsonb('ai-different'::text),'confirmed','incoming_customer_message',f.anchor_message_id,f.conversation_id,'commercial_memory_promotion_v1',false);
 if r.outcome is distinct from 'ignored_existing_current' or r.event_id is distinct from h_id or r.current_value_json is distinct from to_jsonb('human-confirmed'::text) then raise exception 'HUMAN_CONFIRMATION_NOT_PRESERVED'; end if;
 execute 'set local role authenticated'; perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','__ACTOR__')::text,true);
 select * into strict h from public.write_commercial_qualification_fact_by_user_if_current(f.organization_id,f.store_id,f.opportunity_id,f.operation_prefix||':human-conflict','location_text',to_jsonb('human-corrected'::text),first_id,null,null,false);
 if h.current_state is distinct from 'conflict' then raise exception 'EXPECTED_CANONICAL_CONFLICT_NOT_CREATED'; end if;
 conflict_id:=h.current_last_event_id;
 execute 'set local role service_role'; perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 select * into strict r from public.promote_commercial_memory_fact_if_absent_by_system(f.organization_id,f.store_id,f.opportunity_id,f.operation_prefix||':ignored-conflict','location_text',to_jsonb('ai-different'::text),'confirmed','incoming_customer_message',f.anchor_message_id,f.conversation_id,'commercial_memory_promotion_v1',false);
 if r.outcome is distinct from 'ignored_existing_current' or r.current_state is distinct from 'conflict' or r.event_id is distinct from conflict_id then raise exception 'CONFLICT_NOT_PRESERVED'; end if;
 execute 'set local role authenticated'; perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','__ACTOR__')::text,true);
 select * into strict h from public.write_commercial_qualification_fact_by_user_if_current(f.organization_id,f.store_id,f.opportunity_id,f.operation_prefix||':human-resolve','location_text',to_jsonb('human-corrected'::text),conflict_id,null,null,true);
 if h.current_state is distinct from 'confirmed' or h.current_value_json is distinct from to_jsonb('human-corrected'::text) then raise exception 'HUMAN_RESOLUTION_FAILED'; end if;
 execute 'set local role service_role'; perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 st:=null; msg:=null;
 begin
  perform public.promote_commercial_memory_fact_if_absent_by_system(f.organization_id,x.store_id,x.opportunity_id,f.operation_prefix||':cross','decision_context',to_jsonb('bad'::text),'confirmed','incoming_customer_message',x.anchor_message_id,x.conversation_id,'commercial_memory_promotion_v1',false);
 exception when others then get stacked diagnostics st=returned_sqlstate,msg=message_text; end;
 if st is distinct from '23514' or msg is distinct from 'commercial opportunity scope mismatch' then raise exception 'CROSS_TENANT_FAILED:%:%',st,msg; end if;
 st:=null; msg:=null;
 begin
  perform public.promote_commercial_memory_fact_if_absent_by_system(f.organization_id,f.store_id,f.opportunity_id,f.operation_prefix||':bad-source','decision_context',to_jsonb('bad'::text),'confirmed','human_message',f.anchor_message_id,f.conversation_id,'commercial_memory_promotion_v1',false);
 exception when others then get stacked diagnostics st=returned_sqlstate,msg=message_text; end;
 if st is distinct from '23514' or msg is distinct from 'ZION_QFACT_HUMAN_PROVENANCE_INVALID' then raise exception 'PROVENANCE_FAILED:%:%',st,msg; end if;
 st:=null; msg:=null;
 begin
  perform public.promote_commercial_memory_fact_if_absent_by_system(f.organization_id,f.store_id,f.opportunity_id,f.operation_prefix||':bad-recovery','decision_context',to_jsonb('bad'::text),'confirmed','incoming_customer_message',f.anchor_message_id,f.conversation_id,'commercial_memory_promotion_v1',false,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),f.anchor_message_id,f.conversation_id,f.lead_id);
 exception when others then get stacked diagnostics st=returned_sqlstate,msg=message_text; end;
 if st is distinct from '42501' then raise exception 'INVALID_RECOVERY_FAILED:%:%',st,msg; end if;
 execute 'reset role';
 perform set_config('request.jwt.claims','{}',true);
 if (select count(*) from public.commercial_opportunity_qualification_fact_events where organization_id=f.organization_id and commercial_opportunity_id=f.opportunity_id)<>4 then raise exception 'EVENT_COUNT_INVALID'; end if;
 if (select count(*) from public.commercial_human_decision_evidence where organization_id=f.organization_id and commercial_opportunity_id=f.opportunity_id and actor_user_id='__ACTOR__'::uuid)<>3 then raise exception 'EVIDENCE_COUNT_INVALID'; end if;
 if exists(select 1 from public.commercial_opportunity_qualification_fact_events where organization_id=x.organization_id) then raise exception 'FOREIGN_WRITE'; end if;
 if not exists(select 1 from public.commercial_opportunity_qualification_fact_events where id=first_id and source_message_id=f.anchor_message_id and source_conversation_id=f.conversation_id and source_type='incoming_customer_message') then raise exception 'SOURCE_EVIDENCE_INVALID'; end if;
 if exists(select 1 from public.ai_run_queue where organization_id in (f.organization_id,x.organization_id)) then raise exception 'UNEXPECTED_QUEUE'; end if;
end;
$checks$;
select 'B_BEHAVIOR_OK|EVENTS=4|EVIDENCE=3|QUEUES=0';
'@
        Send $b ($checks.Replace('__ACTOR__',$actor))
        $null = Read-Marker $b 'B_BEHAVIOR_OK|EVENTS=4|EVIDENCE=3|QUEUES=0' 90
        $behaviorPass = $true
        $recovery = @'
reset role;
set local statement_timeout='60s';
set local lock_timeout='5s';
do $recovery$
declare f record; r record; c record; qid uuid; outrow record; original_id uuid; st text; msg text;
begin
 select * into strict f from pg_temp.p9_recovery_fixture where fixture_name='target';
 begin
  -- The activation and every synthetic row remain in this uncommitted transaction.
  update public.zion_p9_recovery_activation set automatic_enqueue_enabled=true,compatible_consumers_deployed=true where singleton;
  if not found then raise exception 'RECOVERY_ACTIVATION_ROW_MISSING'; end if;
  execute 'set local role service_role';
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select * into strict r from public.materialize_sales_ai_reply_set_by_system(f.organization_id,f.store_id,f.conversation_id,f.lead_id,f.anchor_message_id,f.opportunity_id,'Synthetic internal recovery B11','reactive_ai_reply',false,'[]'::jsonb,null::jsonb,jsonb_build_object('runner',true,'synthetic',true,'operational_follow_up_decision',jsonb_build_object('kind','schedule_resume','reason','customer_requested_tomorrow'),'last_customer_message_at',clock_timestamp(),'last_ai_message_at',clock_timestamp()));
  execute 'reset role';
  if r.replayed is distinct from false or r.response_set_id is null or r.text_message_id is null then raise exception 'RECOVERY_MATERIALIZATION_FAILED'; end if;
  select id into strict qid from public.ai_run_queue where organization_id=f.organization_id and store_id=f.store_id and queue_key='sales-ai-post-materialization:'||r.response_set_id::text and claim_token is null and processed_at is null;
  if not exists(select 1 from public.messages where id=r.text_message_id and external_message_id is null and outbound_delivery_state is null and metadata->>'send_external'='false') then raise exception 'EXTERNAL_DELIVERY_FORBIDDEN'; end if;
  execute 'set local role service_role';
  select * into strict c from public.claim_ai_run_queue_tasks_by_system(f.organization_id,f.store_id,1,'p9-synthetic-recovery-homologation',600,3);
  if c.id is distinct from qid or c.claim_token is null or c.claim_expires_at<=clock_timestamp() then raise exception 'RECOVERY_CLAIM_INVALID'; end if;
  perform public.p9_10_4_d_assert_recovery_set_claim_authority(r.response_set_id,qid,c.claim_token,f.organization_id,f.store_id,f.conversation_id,f.anchor_message_id,f.lead_id,f.opportunity_id);
  select * into strict outrow from public.promote_commercial_memory_fact_if_absent_by_system(f.organization_id,f.store_id,f.opportunity_id,f.operation_prefix||':valid-recovery','decision_context',to_jsonb('synthetic recovery'::text),'confirmed','incoming_customer_message',f.anchor_message_id,f.conversation_id,'commercial_memory_promotion_v1',false,r.response_set_id,qid,c.claim_token,f.anchor_message_id,f.conversation_id,f.lead_id);
  if outrow.outcome is distinct from 'promoted_created' or outrow.event_id is null then raise exception 'RECOVERY_PROMOTION_FAILED'; end if;
  original_id:=outrow.event_id;
  select * into strict outrow from public.promote_commercial_memory_fact_if_absent_by_system(f.organization_id,f.store_id,f.opportunity_id,f.operation_prefix||':valid-recovery','decision_context',to_jsonb('synthetic recovery'::text),'confirmed','incoming_customer_message',f.anchor_message_id,f.conversation_id,'commercial_memory_promotion_v1',false,r.response_set_id,qid,c.claim_token,f.anchor_message_id,f.conversation_id,f.lead_id);
  if outrow.outcome is distinct from 'ignored_existing_current' or outrow.event_id is distinct from original_id then raise exception 'RECOVERY_REPLAY_FAILED'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.role','',true); perform set_config('request.jwt.claims','{}',true);
  if (select count(*) from public.commercial_opportunity_qualification_fact_events where organization_id=f.organization_id and operation_key=f.operation_prefix||':valid-recovery')<>1 then raise exception 'RECOVERY_EVENT_COUNT_INVALID'; end if;
  perform set_config('zion.b11.recovery_test_result','PASS',true);
 exception when others then
  get stacked diagnostics st=returned_sqlstate,msg=message_text;
  perform set_config('zion.b11.recovery_test_result','FAIL|SQLSTATE='||st||'|MESSAGE='||msg,true);
 end;
 -- A failed recovery subtransaction has already rolled back its own changes.
 execute 'reset role';
 perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims','{}',true);
end;
$recovery$;
select 'VALID_RECOVERY|'||current_setting('zion.b11.recovery_test_result',true);
select 'B_RECOVERY_DONE';
'@
        $a2 = Start-Session 'A2'
        Send $a2 @"
begin;
set local statement_timeout='20s';
set local lock_timeout='5s';
set local idle_in_transaction_session_timeout='120s';
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'zion:p9:qfact:${orgA}:${store}:${opp}:decision_context',0
  )
);
select 'A2_LOCKED|'||pg_backend_pid();
"@

        $a2Ready = Read-Marker $a2 'A2_LOCKED|' 30
        $a2Pid = [int]((
            $a2Ready | Where-Object {
                $_ -match '^A2_LOCKED\|[0-9]+$'
            } | Select-Object -First 1
        ).Split('|')[1])

        if ($a2Pid -eq $bPid) {
            throw 'RECOVERY_BACKEND_NOT_DISTINCT'
        }

        Log "RECOVERY_DISTINCT_BACKENDS=PASS|A2=$a2Pid|B=$bPid"

        Send $b $recovery
        $blockedRecovery = Read-Marker $b 'B_RECOVERY_DONE' 90

        if ($blockedRecovery -notcontains 'VALID_RECOVERY|FAIL|SQLSTATE=55P03|MESSAGE=P9_B11_RECOVERY_FACT_LOCK_BUSY') {
            throw 'RECOVERY_NONBLOCKING_GUARD_NOT_PROVEN'
        }

        Send $b @"
do `$guardcheck`$
begin
  if exists(
    select 1 from public.ai_run_queue
    where organization_id='$orgA'::uuid
  ) or exists(
    select 1 from public.commercial_opportunity_qualification_fact_events
    where organization_id='$orgA'::uuid
      and fact_key='decision_context'
  ) then
    raise exception 'FAILED_RECOVERY_LEFT_CHANGES';
  end if;
end;
`$guardcheck`$;
select 'RECOVERY_GUARD_NO_CHANGES';
"@

        $null = Read-Marker $b 'RECOVERY_GUARD_NO_CHANGES' 30

        End-Session $a2 'A2_ROLLBACK_OK'

        $recoveryGuardPass = $true

        Log 'RECOVERY_FACT_LOCK_INVERSION_GUARD=PASS'

        Send $b $recovery
        $recoveryLines = Read-Marker $b 'B_RECOVERY_DONE' 90
        $recoveryPass = $recoveryLines -contains 'VALID_RECOVERY|PASS'
        End-Session $b 'B_ROLLBACK_OK'
        $explicitRollback = $true
        Log 'ROLLBACK_EXPLICIT=PASS'
    } catch {
        Log "ERROR=$($_.Exception.Message)"
    } finally {
        foreach ($s in $sessions) {
            try { Close-Session $s } catch { $cleanupPass = $false }
        }
        if ($remoteAttempted -and $cleanupPass) {
            try {
                $post = Start-Session 'POST'
                $postSql = @'
begin read only;
set local statement_timeout='30s';
do $post$
declare tbl text; residue boolean; checked integer:=0;
begin
  foreach tbl in array array['stores','customers','customer_store_links','leads','conversations','commercial_opportunities','conversation_sessions','lead_customer_links','commercial_session_context_links','messages','commercial_opportunity_lifecycle_events','commercial_opportunity_qualification_fact_events','commercial_opportunity_qualification_facts_current','commercial_human_decision_evidence','ai_run_queue','ai_sales_action_queue','ai_runs','store_assistant_notification_queue','store_assistant_operational_task_queue','store_assistant_operational_tasks','memberships','p19a_sales_ai_reply_sets','conversation_ai_window_state','conversation_human_takeover_leases'] loop
    execute format('select exists(select 1 from public.%I where organization_id in ($1,$2))',tbl) into residue using '__ORG_A__'::uuid,'__ORG_B__'::uuid;
    if residue then raise exception 'SYNTHETIC_RESIDUE:%',tbl; end if;
    checked:=checked+1;
  end loop;
  if exists(select 1 from public.organizations where id in ('__ORG_A__'::uuid,'__ORG_B__'::uuid)) or exists(select 1 from auth.users where id='__ACTOR__'::uuid) or exists(select 1 from public.memberships where user_id='__ACTOR__'::uuid) then raise exception 'IDENTITY_RESIDUE'; end if;
  raise notice 'SCOPED_TABLES_CHECKED=%',checked+2;
end;
$post$;
select 'POST_RESIDUE_ZERO';
'@
                Send $post ($postSql.Replace('__ORG_A__',$orgA).Replace('__ORG_B__',$orgB).Replace('__ACTOR__',$actor))
                $null = Read-Marker $post 'POST_RESIDUE_ZERO' 45
                End-Session $post 'POST_READ_ONLY_ROLLBACK_OK'
                $cat = Start-Session 'POSTCAT'
                Send $cat $catalogSql
                $catLines = Read-Marker $cat 'CATALOG_DONE' 45
                $after = @($catLines | Where-Object { $_ -match '^(CATALOG|RPC_COUNT|REGISTRY_COUNT|ACTIVATION|RECOVERY_ARGUMENTS|RECOVERY_ORDER_RISK)\|' })
                End-Session $cat 'POSTCAT_ROLLBACK_OK'
                if ($null -eq $baseline -or ($baseline -join "`n") -cne ($after -join "`n") -or $after -notcontains 'RPC_COUNT|0') { throw 'CATALOG_OR_ACTIVATION_CHANGED' }
                Log 'CATALOG_EQUIVALENCE_AND_RPC_ABSENCE=PASS'
                $postPass = $true
            } catch {
                Log "POSTCHECK_ERROR=$($_.Exception.Message)"
            }
        } else { Log 'POSTCHECK_NOT_EXECUTED' }
        foreach ($s in $sessions) {
            try { Close-Session $s } catch { $cleanupPass = $false }
        }
        foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name,$saved[$name],'Process') }
        if ($null -ne $senha) { $senha.Dispose() }
        # The prior source shows a reverse lock order in recovery vs canonical writes.
        # Do not claim full readiness even if the sequential recovery succeeds.
        if ($behaviorPass -and $recoveryPass -and $recoveryGuardPass -and $explicitRollback -and $postPass -and $cleanupPass) { $verdict = 'PASS_SCOPED' }
        Log "RECOVERY_NONBLOCKING_GUARD_PASS=$recoveryGuardPass"
        Log "VALID_RECOVERY_PASS=$recoveryPass"
        Log "EXPLICIT_ROLLBACK_PASS=$explicitRollback"
        Log 'GLOBAL_LOCK_ORDER_SAFETY=NOT_PROVEN_SCOPED_GUARD_ONLY'
        Log 'CONCURRENCY_SCOPE=SHARED_ADVISORY_LOCK_NOT_COMMITTED_INTERLEAVING'
        Log 'AUTH_SCOPE=SQL_SIMULATED_CLAIMS_NOT_REAL_POSTGREST'
        Log "BEHAVIOR_PASS=$behaviorPass"
        Log "POSTCHECK_PASS=$postPass"
        Log "PROCESS_CLEANUP_PASS=$cleanupPass"
        Log "HEAD_FINAL=$(git rev-parse HEAD)"
        Log 'PERMANENT_INSTALLATION_REQUESTED=NO'
        Log 'MIGRATION_APPLICATION_FILES_CHANGED=NO'
        Log 'COMMIT_PUSH_DEPLOY_FLAG_CHANGE=NO'
        Log "FINAL_VERDICT=$verdict"
        Log '===== FIM ====='
        Set-Clipboard -Value ($report -join "`r`n")
        Write-Host 'RELATORIO COPIADO' -ForegroundColor Green
    }
}
