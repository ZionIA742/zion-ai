'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const file='src/app/zion-admin/ZionAdminDashboardClient.tsx';
const source=fs.readFileSync(file,'utf8');
const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const tags=[];
function walk(n){if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(ast)==='ZionAdminDiagnosticIncidents')tags.push(n);ts.forEachChild(n,walk);}
walk(ast);
const categories=['critical','ai','whatsapp','settings','structural'];
function category(n){if(!ts.isJsxExpression(n)||!n.expression||!ts.isConditionalExpression(n.expression))return null;const c=n.expression.condition;if(!ts.isBinaryExpression(c)||c.operatorToken.kind!==ts.SyntaxKind.EqualsEqualsEqualsToken||c.left.getText(ast)!=='category'||!ts.isStringLiteral(c.right))return null;return c.right.text;}
test('dashboard compila sintaticamente',()=>{assert.equal(ast.parseDiagnostics.length,0);const r=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});assert.equal((r.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);});
test('um unico leitor persistido com stores reais',()=>{assert.equal(tags.length,1);assert.match(tags[0].getText(ast),/^<ZionAdminDiagnosticIncidents\s+stores=\{stores\}\s*\/>$/);assert.equal(ast.statements.filter(n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='./ZionAdminDiagnosticIncidents').length,1);});
test('leitor comum e todas as cinco categorias preservadas',()=>{const p=tags[0].parent;assert(ts.isJsxElement(p)||ts.isJsxFragment(p));for(const key of categories){const matching=p.children.filter(n=>category(n)===key);assert.equal(matching.length,1,key);assert(p.children.indexOf(tags[0])<p.children.indexOf(matching[0]),key);}for(let n=p;n;n=n.parent){if(ts.isJsxExpression(n)&&n.expression)assert(!/\bcategory\s*===/.test(n.expression.getText(ast).split('?')[0]));}});
test('consultas complementares continuam presentes',()=>{assert(source.includes('selectRecentAiErrors(stores)'));assert(source.includes('aiErrors.slice(0,limit)'));assert(source.includes('channel_whatsapp_inbox'));assert(source.includes('getOperationalSummary(store)'));});
