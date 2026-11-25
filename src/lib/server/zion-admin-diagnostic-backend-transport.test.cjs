const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const transportPath =
 'src/lib/server/zion-admin-diagnostic-backend-transport.ts';

const adapterPath =
 'src/lib/server/zion-admin-diagnostic-backend-next.ts';

const args = Object.freeze({
 p_event_id:'00000000-0000-4000-8000-000000000001'
});

function setup() {
 let timer;
 let deadline;
 let cleared = false;

 const source = fs.readFileSync(transportPath,'utf8');

 const compiled = ts.transpileModule(source,{
  fileName:transportPath,
  reportDiagnostics:true,
  compilerOptions:{
   target:ts.ScriptTarget.ES2022,
   module:ts.ModuleKind.CommonJS
  }
 });

 assert.equal(
  (compiled.diagnostics || []).filter(
   d => d.category === ts.DiagnosticCategory.Error
  ).length,
  0
 );

 const module = {exports:{}};

 vm.runInNewContext(compiled.outputText,{
  module,
  exports:module.exports,
  require(name){
   if(name === './zion-admin-diagnostic-backend-identity'){
    return {};
   }
   throw Error('UNEXPECTED_IMPORT:'+name);
  },
  AbortController,
  setTimeout(fn,ms){
   timer = fn;
   deadline = ms;
   return 1;
  },
  clearTimeout(){
   cleared = true;
  }
 });

 return {
  send:module.exports.sendBackendDiagnostic,
  fireTimeout(){timer();},
  deadline(){return deadline;},
  cleared(){return cleared;}
 };
}

function success() {
 return {
  error:null,
  data:{
   source_system:'backend_api',
   event_id:args.p_event_id,
   incident_id:'00000000-0000-4000-8000-000000000002',
   occurrence_id:'00000000-0000-4000-8000-000000000003',
   new_incident:true,
   new_occurrence:true
  }
 };
}

test('both production collectors use the 20 second deadline',()=>{
 const source = fs.readFileSync(adapterPath,'utf8');

 assert.equal(
  source.split('timeoutMs: 20000,').length-1,
  2
 );

 assert.equal(
  source.split('schedule: task => after(task),').length-1,
  2
 );

 assert(!source.includes('timeoutMs: 2000,'));
});

test('20 second timeout permits successful registration',async()=>{
 const s = setup();
 let calls = 0;

 const result = await s.send(args,async(a,signal)=>{
  calls++;
  assert.equal(a,args);
  assert.equal(signal.aborted,false);
  return success();
 },20000);

 assert.equal(result.status,'registered');
 assert.equal(result.eventId,args.p_event_id);
 assert.equal(s.deadline(),20000);
 assert.equal(calls,1);
 assert.equal(s.cleared(),true);
});

test('timeout aborts once without automatic retry',async()=>{
 const s = setup();
 let calls = 0;
 let signal;

 const pending = s.send(args,(a,sig)=>{
  calls++;
  assert.equal(a,args);
  signal = sig;
  return new Promise(()=>{});
 },20000);

 await Promise.resolve();

 assert.equal(calls,1);
 assert.equal(signal.aborted,false);

 s.fireTimeout();

 const result = await pending;

 assert.equal(result.status,'unconfirmed');
 assert.equal(result.reason,'timeout');
 assert.equal(signal.aborted,true);
 assert.equal(s.cleared(),true);
 assert.equal(calls,1);
});

test('invalid deadlines never invoke RPC',async()=>{
 for(const value of [0,-1,1.5,20001,Infinity,NaN]){
  const s = setup();
  let calls = 0;

  const result = await s.send(args,()=>{
   calls++;
   return Promise.resolve(success());
  },value);

  assert.equal(result.status,'not_attempted');
  assert.equal(result.reason,'invalid_timeout');
  assert.equal(calls,0);
 }
});

test('generic transport default remains two seconds',async()=>{
 const s = setup();

 const result = await s.send(
  args,
  async()=>success()
 );

 assert.equal(result.status,'registered');
 assert.equal(s.deadline(),2000);
});

test('RPC errors remain unconfirmed without private data',async()=>{
 const s = setup();

 const result = await s.send(
  args,
  async()=>({
   error:{message:'PRIVATE'},
   data:null
  }),
  20000
 );

 assert.equal(result.status,'unconfirmed');
 assert.equal(result.reason,'rpc_error');
 assert(!JSON.stringify(result).includes('PRIVATE'));
});

test('transport rejection remains fail open',async()=>{
 const s = setup();

 const result = await s.send(
  args,
  async()=>{throw Error('PRIVATE');},
  20000
 );

 assert.equal(result.status,'unconfirmed');
 assert.equal(result.reason,'transport_error');
 assert(!JSON.stringify(result).includes('PRIVATE'));
});

test('mismatched event identity cannot confirm persistence',async()=>{
 const s = setup();

 const result = await s.send(args,async()=>{
  const response = success();
  response.data.event_id =
   '00000000-0000-4000-8000-000000000009';
  return response;
 },20000);

 assert.equal(result.status,'unconfirmed');
 assert.equal(result.reason,'invalid_response');
});
