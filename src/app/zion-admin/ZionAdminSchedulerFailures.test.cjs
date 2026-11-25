const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), ts=require('typescript');
function load(file,deps={},extra={},suffix='') {
 const source=fs.readFileSync(file,'utf8');
 const compiled=ts.transpileModule(source+suffix,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 const module={exports:{}};
 vm.runInNewContext(compiled.outputText,{module,exports:module.exports,require(name){if(Object.hasOwn(deps,name))return deps[name];throw Error('UNEXPECTED_IMPORT:'+name);},Request,Response,URL,AbortSignal,AbortController,Date,Intl,console,...extra},{filename:file,timeout:10000});
 return module.exports;
}
const contract=load('src/lib/diagnostics/scheduler-failure-contract.ts');
const {projectSchedulerFailures:project}=contract;
const row={job_id:7,run_id:123,component:'whatsapp_inbox',job_active:true,failed_started_at:'2026-11-25T16:42:00.123456+00:00',failed_ended_at:'2026-11-25T16:42:11.123456+00:00',technical_error_code:'CRON_EXECUTION_FAILED',reported_reason:'scheduler_reported_connection_failure',subsequent_success_started_at:'2026-11-25T16:43:00+00:00',subsequent_success_ended_at:'2026-11-25T16:43:01+00:00'};
const ui=load('src/app/zion-admin/ZionAdminSchedulerFailures.tsx',{'react':{},'react/jsx-runtime':{},'@/lib/diagnostics/scheduler-failure-contract':contract},{},'\nexport {buildSchedulerText};\n');
function setup(options={}) {
 const calls=[];const env={NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'FAKE',ZION_ADMIN_DIAGNOSTIC_UNIFIED_READER_ENABLED:options.flag??'true'};
 const route=load('src/app/api/zion-admin/diagnostics/scheduler/route.ts',{
  '@supabase/supabase-js':{createClient(){calls.push('client');return {rpc(name,args){calls.push([name,args.p_limit]);return {abortSignal(signal){assert(signal instanceof AbortSignal);return Promise.resolve(options.rpc??{data:[row],error:null});}};}};}},
  '@/lib/server/zion-admin-api-access':{async resolveZionAdminApiAccess(args){assert.equal(args.requiredCapability,'manage_accounts');calls.push('auth');return {ok:options.authorized!==false};}},
  '@/lib/server/zion-admin-api-response':{createZionAdminApiDeniedResponse(){return Response.json({ok:false},{status:403});},createZionAdminApiJsonResponse(body,status){return Response.json(body,{status});}},
  '@/lib/diagnostics/scheduler-failure-contract':contract
 },{process:{env},AbortSignal:{timeout(ms){options.onTimeout?.(ms);return options.signal??AbortSignal.timeout(ms);}}});
 return {calls,get:(query='')=>route.GET(new Request('https://fixture.invalid/api/zion-admin/diagnostics/scheduler'+query))};
}
test('known catalog and exact ten-field projection strips private extras',()=>{assert.equal(contract.SCHEDULER_COMPONENTS.length,19);const result=project([{...row,command:'PRIVATE',return_message:'PRIVATE'}],50);assert.equal(Object.keys(result[0]).length,10);assert(!JSON.stringify(result).includes('PRIVATE'));});
test('rejects unknown component, reason, code, unsafe IDs and duplicate runs',()=>{for(const r of [{component:'PRIVATE'},{reported_reason:'PRIVATE'},{technical_error_code:'PRIVATE'},{run_id:0},{job_id:Number.MAX_SAFE_INTEGER+1}])assert.equal(project([{...row,...r}],50),null);assert.equal(project([row,row],50),null);});
test('rejects malformed dates and nonchronological or partial success',()=>{for(const r of [{failed_started_at:'PRIVATE'},{failed_ended_at:'2026-11-24T00:00:00Z'},{subsequent_success_started_at:null},{subsequent_success_started_at:'2026-11-24T00:00:00Z'},{subsequent_success_ended_at:'2026-11-25T16:42:00Z'}])assert.equal(project([{...row,...r}],50),null);});
test('null evidence is preserved and no success invented',()=>{const r=project([{...row,failed_ended_at:null,subsequent_success_started_at:null,subsequent_success_ended_at:null}],50)[0];assert.equal(r.failed_ended_at,null);assert.match(ui.buildSchedulerText(r),/Primeiro sucesso posterior \(fim\): Não comprovado/);});
test('technical report distinguishes scheduler success from recovery',()=>{const text=ui.buildSchedulerText(project([row],50)[0]);assert.match(text,/CRON_EXECUTION_FAILED/);assert.match(text,/Recuperação comercial: não comprovada/);assert.match(text,/16:43:01/);assert.match(text,/Causa raiz: não comprovada/);});
test('authorization precedes all RPC operations',async()=>{const s=setup({authorized:false});assert.equal((await s.get()).status,403);assert.deepEqual(s.calls,['auth']);});
test('strict feature gate, no RPC when disabled',async()=>{for(const flag of ['false','TRUE','']){const s=setup({flag});assert.equal((await s.get()).status,404);assert.deepEqual(s.calls,['auth']);}});
test('invalid limits, extras and duplicate params rejected',async()=>{for(const q of ['?limit=0','?limit=51','?limit=01','?limit=1.5','?limit=1&limit=2','?store_id=x','?limit=']){const s=setup();assert.equal((await s.get(q)).status,400);assert.deepEqual(s.calls,['auth']);}});
test('exact RPC, bounded result and no extra private metadata',async()=>{const s=setup({rpc:{data:[{...row,return_message:'PRIVATE'}],error:null}});const res=await s.get('?limit=50');assert.equal(res.status,200);const body=await res.json();assert.equal(body.source,'pg_cron');assert.equal(body.window_days,7);assert.equal(body.limit,50);assert(!JSON.stringify(body).includes('PRIVATE'));assert.deepEqual(s.calls,['auth','client',['list_zion_admin_scheduler_failures_by_system',50]]);});
test('RPC errors, malformed and oversized rows fail closed',async()=>{for(const rpc of [{data:null,error:{message:'PRIVATE'}},{data:[{...row,reported_reason:'PRIVATE'}],error:null},{data:[row,row],error:null}]){const s=setup({rpc});const res=await s.get('?limit=1');assert.equal(res.status,503);assert(!(await res.text()).includes('PRIVATE'));}});
test('empty history is distinct from an unavailable query',async()=>{const s=setup({rpc:{data:[],error:null}});const res=await s.get();assert.equal(res.status,200);assert.deepEqual((await res.json()).items,[]);});
test('integration is mounted once with unified readers only and manual refresh',()=>{const src=fs.readFileSync('src/app/zion-admin/ZionAdminDiagnosticIncidents.tsx','utf8');assert.equal((src.match(/<ZionAdminSchedulerFailures \/>/g)||[]).length,1);assert(src.includes('result?.source === "unified" || result?.source === "unified_v2" ? <ZionAdminSchedulerFailures />'));const component=fs.readFileSync('src/app/zion-admin/ZionAdminSchedulerFailures.tsx','utf8');assert(component.includes('navigator.clipboard.writeText(buildSchedulerText(item))'));assert(!component.includes('setInterval'));assert(component.includes('Consulta geral, independente dos filtros'));});

test('scheduler RPC deadline is bounded at 20 seconds',async()=>{
 const deadlines=[];
 const s=setup({onTimeout(ms){deadlines.push(ms);}});
 assert.equal((await s.get('?limit=50')).status,200);
 assert.deepEqual(deadlines,[20000]);
});

test('scheduler RPC timeout has a safe reason',async()=>{
 const s=setup({
  signal:AbortSignal.abort(),
  rpc:{data:null,error:{message:'PRIVATE'}}
 });
 const res=await s.get();
 assert.equal(res.status,503);
 const body=await res.json();
 assert.equal(body.reason,'SCHEDULER_RPC_TIMEOUT');
 assert(!JSON.stringify(body).includes('PRIVATE'));
});

test('scheduler other RPC failures have a safe reason',async()=>{
 const s=setup({
  rpc:{data:null,error:{message:'PRIVATE'}}
 });
 const res=await s.get();
 assert.equal(res.status,503);
 const body=await res.json();
 assert.equal(body.reason,'SCHEDULER_RPC_FAILED');
 assert(!JSON.stringify(body).includes('PRIVATE'));
});

test('scheduler invalid projection has a safe reason',async()=>{
 const s=setup({
  rpc:{data:[{...row,component:'PRIVATE'}],error:null}
 });
 const res=await s.get();
 assert.equal(res.status,503);
 const body=await res.json();
 assert.equal(body.reason,'SCHEDULER_INVALID_RESPONSE');
 assert(!JSON.stringify(body).includes('PRIVATE'));
});

test('browser deadline is 45 seconds and cleanup aborts',()=>{
 let effect,deadline,requestSignal;
 const component=load(
  'src/app/zion-admin/ZionAdminSchedulerFailures.tsx',
  {
   react:{
    useState(initial){return [initial,()=>{}];},
    useEffect(callback){effect=callback;}
   },
   'react/jsx-runtime':{
    jsx(){return null;},
    jsxs(){return null;}
   },
   '@/lib/diagnostics/scheduler-failure-contract':contract
  },
  {
   setTimeout(callback,ms){deadline=ms;return 1;},
   clearTimeout(){},
   fetch(url,options){
    requestSignal=options.signal;
    return new Promise(()=>{});
   }
  }
 );
 component.default();
 assert.equal(typeof effect,'function');
 const cleanup=effect();
 assert.equal(deadline,45000);
 assert.equal(requestSignal.aborted,false);
 cleanup();
 assert.equal(requestSignal.aborted,true);
});
