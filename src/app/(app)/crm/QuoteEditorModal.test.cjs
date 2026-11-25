const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(file, resolve) {
  const source = fs.readFileSync(file,"utf8");
  const output = ts.transpileModule(source,{
    compilerOptions:{
      target:ts.ScriptTarget.ES2022,
      module:ts.ModuleKind.CommonJS,
      jsx:ts.JsxEmit.ReactJSX
    }
  }).outputText;

  const m = {exports:{}};

  new Function("require","module","exports",output)(
    resolve,m,m.exports
  );

  return m.exports;
}

const model = load(
  path.join(__dirname,"quote-editor-model.ts"),
  require
);

const jsx = (type,props,key)=>({type,props,key});
const Picker = ()=>null;

const Editor = load(
  path.join(__dirname,"QuoteEditorModal.tsx"),
  name=>{
    if(name==="react/jsx-runtime")
      return {jsx,jsxs:jsx,Fragment:Symbol("fragment")};
    if(name==="./quote-editor-model")return model;
    if(name.endsWith("/QuoteCatalogPrefillPicker"))
      return {default:Picker};
    throw Error("Unexpected import: "+name);
  }
).default;

function nodes(value) {
  if(Array.isArray(value))return value.flatMap(nodes);
  if(!value || typeof value!=="object")return [];
  return [value,...nodes(value.props?.children)];
}

function text(value) {
  if(Array.isArray(value))return value.map(text).join("");
  if(typeof value==="string" || typeof value==="number")
    return String(value);
  return value && typeof value==="object"
    ? text(value.props?.children)
    : "";
}

function setup(overrides={}) {
  const actions=[];
  const noop=()=>{};
  const item={
    ...model.createEmptyQuoteFormItem(),
    name:"Piscina",
    quantity:"2",
    unitPriceReais:"50,00",
    discountReais:"10,00"
  };

  const props={
    isEditingQuote:false,
    humanQuoteEditView:null,
    editingQuoteNumber:null,
    isGeneratingManualQuote:false,
    closeQuoteModalAndReset:()=>actions.push("close"),
    creationLinkSection:jsx("link-slot",{}),
    quoteTitle:"Teste",
    setQuoteTitle:noop,
    quoteWarrantyTerms:"",
    setQuoteWarrantyTerms:noop,
    quoteValidityDays:"",
    setQuoteValidityDays:noop,
    quoteCustomerNotes:"",
    setQuoteCustomerNotes:noop,
    quoteItems:[item],
    removeQuoteItem:()=>actions.push("remove"),
    updateQuoteItem:noop,
    addQuoteItem:()=>actions.push("add"),
    quoteServiceOptionEnabled:true,
    catalogScope:{organizationId:"org",storeId:"store"},
    quoteTechnicalServicesPolicy:null,
    applyCatalogPrefillToQuoteItem:noop,
    quoteFormError:null,
    quoteFormSuccess:null,
    quoteValidationMessage:null,
    quoteSubtotalReais:100,
    quoteDiscountTotalReais:10,
    quoteGlobalDiscountReais:0,
    quoteTotalReais:90,
    canGenerateQuotePdf:true,
    onSubmit:()=>actions.push("submit"),
    ...overrides
  };

  const tree=Editor(props);
  const all=nodes(tree);

  return {
    tree,all,actions,
    button:name=>all.find(n=>
      n.type==="button" &&
      text(n.props.children).trim()===name
    )
  };
}

let count=0;

function test(name,fn) {
  fn();
  count++;
  console.log("ok - "+name);
}

test("original money helpers are reusable",()=>{
  assert.equal(model.convertReaisToCents("10,25"),1025);
  assert.equal(model.parseQuoteMoneyValue("-1"),0);
  assert.equal(model.parseQuoteQuantityValue("2,5"),2.5);
  assert.equal(model.createEmptyQuoteFormItem().quantity,"1");
});

test("creation editor works without a lead",()=>{
  const r=setup({creationLinkSection:null});
  assert.ok(r.button("Gerar PDF"));
  const picker=r.all.find(n=>n.type===Picker);
  assert.ok(picker);
  assert.equal(picker.props.organizationId,"org");
  assert.equal(picker.props.storeId,"store");
  assert.ok(text(r.tree).includes(model.formatCurrencyBRL(90)));
});

test("creation link section is provided by caller",()=>{
  const r=setup();
  assert.ok(r.all.some(n=>n.type==="link-slot"));
});

test("missing store scope hides catalog",()=>{
  const r=setup({catalogScope:null});
  assert.ok(!r.all.some(n=>n.type===Picker));
});

test("existing edit mode remains separate",()=>{
  const r=setup({
    isEditingQuote:true,
    humanQuoteEditView:new Map(),
    editingQuoteNumber:"Q-100"
  });

  assert.ok(r.button("Salvar"));
  assert.ok(!r.all.some(n=>n.type===Picker));
  assert.ok(!r.all.some(n=>n.type==="link-slot"));
  assert.ok(text(r.tree).includes("Q-100"));
});

test("callbacks are delegated to the original controller",()=>{
  const r=setup();

  r.button("Gerar PDF").props.onClick();
  r.button("Adicionar item").props.onClick();
  r.button("Remover").props.onClick();
  r.button("Fechar").props.onClick();

  assert.deepEqual(
    r.actions,
    ["submit","add","remove","close"]
  );
});

test("busy or invalid form blocks generation",()=>{
  assert.equal(
    setup({canGenerateQuotePdf:false})
      .button("Gerar PDF").props.disabled,
    true
  );

  assert.equal(
    setup({isGeneratingManualQuote:true})
      .button("Gerando...").props.disabled,
    true
  );
});

assert.equal(count,7);
console.log("SHARED_QUOTE_EDITOR: "+count+"/7 PASS");
