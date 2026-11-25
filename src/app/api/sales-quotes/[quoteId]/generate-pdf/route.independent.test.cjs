const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const dir=__dirname;
const routeFile=path.join(dir,'route.ts');
const provenanceFile=path.resolve('src/lib/server/sales-quotes/human-quote-edit-provenance.ts');
function load(file,req){const m={exports:{}};const src=fs.readFileSync(file,'utf8');const ast=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true);assert.equal(ast.parseDiagnostics.length,0);const code=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;new Function('require','module','exports',code)(req,m,m.exports);return m.exports;}
const prov=load(provenanceFile,require);
const human={created_via:'api_sales_quotes_create',creation_actor_kind:'user',creation_actor_user_id:'00000000-0000-4000-8000-000000000001'};
const legacy={created_via:'api_sales_quotes_create',legacy_human_edit_eligible:true};
const op='00000000-0000-4000-8000-000000000002';const claim='00000000-0000-4000-8000-000000000003';
async function run(opts={}){
 const calls=[], filters=[], payloads=[];let rendered=false;const quote={id:'q',organization_id:'o',store_id:'s',metadata:opts.metadata??human,lead_id:opts.link?'l':null,conversation_id:opts.link?'c':null,commercial_opportunity_id:opts.link?'opp':null,quote_number:'Q1',updated_at:'2026-11-24T00:00:00Z',current_version_id:null,total_cents:100};
 const record={operation_id:op,quote_id:'q',quote_version_id:'v',store_file_id:'f',storage_path:'p',original_filename:'a.pdf'};
 const rpc=async(name,p)=>{calls.push(name);payloads.push([name,p]);let outcome;
 switch(name){case 'get_sales_quote_pdf_generation_replay_by_system':outcome=opts.lookup??'not_found';break;case 'begin_sales_quote_pdf_generation_by_system':outcome=opts.begin??'claimed';break;case 'claim_recoverable_sales_quote_pdf_generation_by_system':outcome='reclaimed';break;case 'start_sales_quote_pdf_generation_by_system':outcome='processing';break;case 'materialize_sales_quote_pdf_generation_by_system':outcome='materialized';break;case 'mark_sales_quote_pdf_generation_recoverable_by_system':outcome='recoverable';break;default:throw Error('unexpected RPC '+name);}
 if(name==='get_sales_quote_pdf_generation_replay_by_system'){
  if(opts.lookupError)return {data:null,error:{message:'lookup failed'}};
  const operation_id=opts.wrongIdentity?claim:op;
  if(outcome==='existing_operation'){
   const data={outcome,status:'recoverable',operation_id};
   if(!opts.omitKind)data.quote_kind=Object.prototype.hasOwnProperty.call(opts,'savedKind')?opts.savedKind:null;
   return {data,error:null};
  }
  if(outcome==='not_found')return {data:{outcome,operation_id},error:null};
  return {data:{...record,outcome,status:'materialized',operation_id},error:null};
 }
 return {data:{...record,outcome,claim_token:claim},error:null};};
 const supabase={rpc,from(table){calls.push('from:'+table);if(table==='sales_quote_pdf_generation_operations')throw Error('PROTECTED_TABLE_DIRECT_ACCESS');const q={select(){return q;},eq(k,v){filters.push([table,k,v]);return q;},contains(){return q;},limit(){return q;},order(){return Promise.resolve({data:opts.empty?[]:[{name:'item'}],error:null});},maybeSingle(){if(table==='conversation_events')return Promise.resolve({data:null,error:null});throw Error('unexpected table '+table);}};return q;}};
 class QuoteAccessError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
 const mocks={'next/server':{NextResponse:{json:(body,init)=>({body,status:init?.status??200})}},'node:crypto':require('node:crypto'),
 'store-brand-visual-policy':{loadStoreBrandVisualPolicy:async()=>({configured:true,useLogoOnQuotes:false})},
 'build-quote-pdf':{buildQuotePdf:async()=>{calls.push('render');if(opts.failRender)throw Error('render fail');rendered=true;return Buffer.from('%PDF-test');},loadStoreLogoForPdf:async()=>{throw Error('unexpected logo');}},
 'quote-events':{canInsertQuoteConversationEvent:async()=>{calls.push('guard');return {allowed:!opts.block};},insertQuoteConversationEvent:async()=>{calls.push('event');return {deduped:false};}},
 'quote-conversation-readiness':{ensureQuoteConversationReadyForQuoteEvent:async()=>{calls.push('transition');}},
 'quote-auth':{QuoteAccessError,resolveAuthorizedExistingQuote:async()=>{calls.push('auth');if(opts.deny)throw new QuoteAccessError(403,'DENIED','denied');return {quote,organizationId:'o',store:{id:'s'},user:{id:'u'},supabase,sessionSupabase:supabase,lead:opts.link?{id:'l'}:null,conversation:opts.link?{id:'c'}:null};}},
 'quote-settings':{loadStoreQuoteSettings:async()=>({settings:{}})},
 'quote-storage':{buildQuotePdfFileName:()=> 'a.pdf',storeQuotePdfFile:async()=>{calls.push('store');return {storeFileId:'f',storageBucket:'b',storagePath:'p',originalFilename:'a.pdf',sizeBytes:9};}},
 'document-review-messages':{pushAssistantDocumentReviewMessage:async()=>{calls.push('review');}},
 'quote-versioning':{buildQuoteKindNotice:()=>null,buildQuoteSnapshot:({quoteKind})=>({quote:{id:'q',status:'draft',quoteKind},items:[{}]})},
 'canonical-payload-v1':{sha256CanonicalPayloadV1:()=>({fingerprint:'fp',canonicalPayload:'payload'}),withoutVolatileQuoteSnapshotFields:s=>s},
 'quote-kind':{resolveSalesQuoteKindForVersion:async()=>{calls.push('kind');return 'preliminary';}},
 'human-quote-edit-provenance':prov,'zion-admin-diagnostic-backend-next':{withBackendDiagnosticRoute:(_r,_m,h)=>h}};
 const mod=load(routeFile,name=>{const key=name==='next/server'||name==='node:crypto'?name:name.split('/').at(-1);if(!(key in mocks))throw Error('unexpected import '+name);return mocks[key];});
 const response=await mod.POST({json:async()=>({quoteKind:'definitive',independentHuman:true}),headers:{get:()=>opts.badId?'bad':op}},{params:Promise.resolve({quoteId:'q'})});
 assert.ok(!calls.includes('from:sales_quote_pdf_generation_operations'),'DIRECT_PROTECTED_TABLE_ACCESS');
 return {calls,filters,payloads,response,rendered};
}
const side=['transition','guard','kind','event','review'];const noSide=r=>{for(const k of side)assert.ok(!r.calls.includes(k),k);};const begin=r=>r.payloads.find(([n])=>n==='begin_sales_quote_pdf_generation_by_system')?.[1];
(async()=>{let count=0;async function test(name,fn){await fn();count++;console.log('ok - '+name);}
 await test('human unlinked ignores client kind',async()=>{const r=await run();assert.equal(r.response.body.ok,true);assert.equal(r.response.body.status,'pending_review');assert.equal(begin(r).p_quote_kind,null);assert.equal(r.rendered,true);noSide(r);});
 await test('human linked no commercial effects',async()=>{const r=await run({link:true});assert.equal(r.response.body.ok,true);assert.equal(begin(r).p_quote_kind,null);noSide(r);});
 await test('recognized historical eligibility',async()=>{const r=await run({metadata:legacy,link:true});assert.equal(r.response.body.ok,true);noSide(r);});
 await test('AI unchanged commercial path',async()=>{const r=await run({metadata:{creation_actor_kind:'system'},link:true});assert.equal(r.response.body.ok,true);for(const k of side)assert.ok(r.calls.includes(k),k);assert.equal(begin(r).p_quote_kind,'preliminary');});
 await test('forged request flag does not bypass AI guard',async()=>{const r=await run({metadata:{created_via:'api_sales_quotes_create',creation_actor_kind:'user',creation_actor_user_id:'invalid'},link:true,block:true});assert.equal(r.response.status,409);assert.equal(r.rendered,false);assert.ok(r.calls.includes('guard'));assert.equal(begin(r),undefined);});
 await test('human lookup replay no side effects or render',async()=>{const r=await run({link:true,lookup:'idempotent_replay'});assert.equal(r.response.body.replayed,true);assert.equal(r.rendered,false);noSide(r);assert.equal(begin(r),undefined);});
 await test('human begin replay no side effects',async()=>{const r=await run({link:true,begin:'idempotent_replay'});assert.equal(r.response.body.replayed,true);noSide(r);assert.equal(r.rendered,false);});
 for(const savedKind of [null,'preliminary','definitive']){
  await test('human recovery preserves persisted kind '+String(savedKind),async()=>{
   const r=await run({link:true,lookup:'existing_operation',begin:'recoverable',savedKind});
   assert.equal(r.response.body.ok,true);
   assert.equal(begin(r).p_quote_kind,savedKind);
   assert.equal(begin(r).p_quote_snapshot.quote.quoteKind,savedKind);
   assert.equal(r.rendered,true);
   noSide(r);
   const lookupCalls=r.payloads.filter(([n])=>n==='get_sales_quote_pdf_generation_replay_by_system');
   assert.equal(lookupCalls.length,1);
   assert.deepEqual(lookupCalls[0][1],{p_operation_id:op,p_organization_id:'o',p_store_id:'s',p_quote_id:'q'});
   const claims=r.payloads.filter(([n])=>n==='claim_recoverable_sales_quote_pdf_generation_by_system');
   assert.equal(claims.length,1);
   assert.deepEqual(claims[0][1],{p_operation_id:op,p_organization_id:'o',p_store_id:'s',p_request_fingerprint:begin(r).p_request_fingerprint});
   assert.equal(r.calls.filter(n=>n==='materialize_sales_quote_pdf_generation_by_system').length,1);
  });
 }
 await test('missing persisted kind fails closed',async()=>{
  const r=await run({lookup:'existing_operation',omitKind:true});
  assert.equal(r.response.status,500);
  assert.equal(begin(r),undefined);
  assert.equal(r.rendered,false);
  assert.ok(!r.calls.includes('claim_recoverable_sales_quote_pdf_generation_by_system'));
  noSide(r);
 });
 await test('invalid persisted kinds fail closed',async()=>{
  for(const savedKind of ['', 'PRELIMINARY', 'unexpected', false, 0, {}, []]){
   const r=await run({lookup:'existing_operation',savedKind});
   assert.equal(r.response.status,500);
   assert.equal(begin(r),undefined);
   assert.equal(r.rendered,false);
   assert.ok(!r.calls.includes('claim_recoverable_sales_quote_pdf_generation_by_system'));
   noSide(r);
  }
 });
 await test('wrong lookup identity fails closed',async()=>{
  const r=await run({lookup:'existing_operation',wrongIdentity:true});
  assert.equal(r.response.status,500);
  assert.equal(begin(r),undefined);
  assert.equal(r.rendered,false);
  noSide(r);
 });
 await test('lookup RPC failure has no fallback table access',async()=>{
  const r=await run({lookup:'existing_operation',lookupError:true});
  assert.equal(r.response.status,500);
  assert.equal(begin(r),undefined);
  assert.equal(r.rendered,false);
  noSide(r);
 });
 await test('in progress does not materialize',async()=>{const r=await run({begin:'in_progress'});assert.equal(r.response.status,409);assert.equal(r.rendered,false);noSide(r);});
 await test('render failure marks recoverable',async()=>{const r=await run({failRender:true});assert.equal(r.response.status,500);assert.ok(r.calls.includes('mark_sales_quote_pdf_generation_recoverable_by_system'));noSide(r);});
 await test('no items rejected',async()=>{const r=await run({empty:true});assert.equal(r.response.status,400);assert.equal(begin(r),undefined);noSide(r);});
 await test('auth failure no DB calls',async()=>{const r=await run({deny:true});assert.equal(r.response.status,403);assert.deepEqual(r.calls,['auth']);});
 await test('AI replay preserves review/event',async()=>{const r=await run({metadata:{},link:true,lookup:'idempotent_replay'});assert.equal(r.response.body.replayed,true);assert.ok(r.calls.includes('event')&&r.calls.includes('review'));assert.equal(r.rendered,false);});
 assert.equal(count,19,'UNEXPECTED_TEST_COUNT');
 console.log('PDF_INDEPENDENT: '+count+'/19 PASS');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
