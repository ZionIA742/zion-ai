const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('typescript');
const file=path.join(__dirname,'page.tsx');const src=fs.readFileSync(file,'utf8');
const ast=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);assert.equal(ast.parseDiagnostics.length,0);
function getFunction(name){let matches=[];function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)matches.push(n.getText(ast));ts.forEachChild(n,visit);}visit(ast);assert.equal(matches.length,1);return ts.transpileModule(matches[0],{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;}
const helpers={exports:{}};new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'quote-create-operation.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(helpers.exports,helpers,require);
const h=helpers.exports;
async function run(state,overrides={}){
 let captured=[],errors=[],keys=[];const noop=()=>{};const storage=new Map();
 const env={...h,isGeneratingManualQuote:false,quoteFormMode:'create',lead:{id:'lead-a',organization_id:'org-a',store_id:'store-a',name:'Cliente A',phone:'11999999999'},leadId:'lead-a',conversation:{id:'conv-a'},selectedOpportunity:{id:'opp-a'},quoteCreationState:{originLeadId:'lead-a',linkLead:false,customerName:'',customerPhone:'',...state},canGenerateQuotePdf:true,quoteValidationMessage:null,quoteItems:[{itemType:'custom',name:'Piscina',description:'',quantity:'1',unitPriceReais:'100',discountReais:'0'}],parseQuoteQuantityValue:Number,convertReaisToCents:v=>Math.round(Number(v)*100),quoteTitle:'Piscina',quoteCustomerNotes:'',quoteWarrantyTerms:'',quoteValidityDays:'15',setQuoteFormError:e=>{if(e)errors.push(e)},setQuoteFormSuccess:noop,setIsGeneratingManualQuote:noop,setStatusText:noop,window:{sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{keys.push(k);storage.set(k,v)},removeItem:k=>storage.delete(k)}},crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},fetch:async (url,opts)=>{captured.push({url,body:JSON.parse(opts.body)});throw Error('TEST_STOP_BEFORE_NETWORK');},...overrides};
 const f=new Function(...Object.keys(env),getFunction('generateManualQuotePdf')+'\nreturn generateManualQuotePdf;')(...Object.values(env));await f();return {captured,errors,keys};
}
(async()=>{
 const cases=[
  ['sem vinculo',{},[null,null,null,null,null]],
  ['vinculado',{linkLead:true},['lead-a','conv-a','opp-a','Cliente A','11999999999']],
  ['dados manuais',{customerName:' Outro ',customerPhone:' 123 '},[null,null,null,'Outro','123']],
  ['vinculado nao usa dados manuais',{linkLead:true,customerName:'Outro',customerPhone:'123'},['lead-a','conv-a','opp-a','Cliente A','11999999999']]
 ];
 for(const [name,state,want] of cases){const r=await run(state);assert.equal(r.captured.length,1);assert.equal(r.captured[0].url,'/api/sales-quotes/create');const b=r.captured[0].body;assert.deepEqual(['leadId','conversationId','commercialOpportunityId','customer_name','customer_phone'].map(k=>b[k]),want);assert.equal(b.storeId,'store-a');assert.equal(b.organizationId,'org-a');assert.equal(r.keys.length,1);assert.equal(r.keys[0].includes(':origin:lead-a'),!state.linkLead);assert.equal(r.errors.at(-1),'TEST_STOP_BEFORE_NETWORK');console.log('ok - '+name);}
 for(const [name,state,overrides] of [['origem divergente',{originLeadId:'lead-b'},{}],['rota divergente',{}, {leadId:'lead-b'}]]){const r=await run(state,overrides);assert.equal(r.captured.length,0);assert.equal(r.keys.length,0);assert.match(r.errors.at(-1),/contexto do editor mudou/);console.log('ok - '+name);}
 assert.match(getFunction('resetQuoteForm'),/linkLead: false, customerName: "", customerPhone: ""/);assert.match(src,/Vincular lead ao orçamento/);assert.match(src,/Desvincular lead/);assert.match(src,/linkLead: !current.linkLead,\s*customerName: "", customerPhone: ""/);assert.match(src,/quoteCreationCustomerName: quoteCreationState.linkLead \? ""/);assert.match(src,/typeof parsed\?\.quoteCreationLinkLead === "boolean"/);console.log('ok - contrato estatico reset, interface e rascunho');
 console.log('OPTIONAL_LEAD_CRM: 7/7 PASS');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
