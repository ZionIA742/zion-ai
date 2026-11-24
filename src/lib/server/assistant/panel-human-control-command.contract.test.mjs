import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('./panel-human-control-command.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
assert.equal(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const { handlePanelHumanControlCommand: handle, isPanelHumanControlCandidate: candidate } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'));
const id = 'message-1';
const target = '12345678-1234-1234-1234-123456789abc';
const calls = [];
const base = { organizationId: 'org', storeId: 'store', humanMessageId: id,
  readMessage: async () => ({ data: { id, content: 'Libere a IA para Maria Silva', message_type: 'text' }, error: null }),
  execute: async args => { calls.push(['rpc', args]); return { data: [{ outcome: 'applied', command_action: 'release_ai', target_conversation_id: target }], error: null }; },
  persist: async input => { calls.push(['persist', input]); return null; } };
const result = await handle(base);
assert.equal(result.result.ok, true);
assert.match(result.result.aiText, /devolvido/);
assert.deepEqual(calls[0], ['rpc', { p_organization_id: 'org', p_store_id: 'store', p_human_message_id: id }]);
assert.equal(calls[1][1].relatedConversationId, target);
assert.equal(calls[1][1].metadata.command_outcome, 'applied');
calls.length = 0;
const normal = await handle({ ...base, readMessage: async () => ({data:{id,content:'Qual a agenda de hoje?',message_type:'text'},error:null}) });
assert.deepEqual(normal, {handled:false}); assert.equal(calls.length,0);
assert.equal(candidate('Não responda para Maria Silva'),true);
assert.equal(candidate('Pode assumir'),true);
assert.equal(candidate('libere a ia da Maria'),true);
assert.equal(candidate('Não libere a IA para Maria'),false);
assert.equal(candidate('Pode assumir a instalação'),false);
const denied = await handle({ ...base, execute: async () => ({data:null,error:{message:'N30B_COMMAND_HARD_HOLD_ACTIVE'}}) });
assert.match(denied.result.aiText,/continua bloqueado/); assert.equal(calls.at(-1)[1].metadata.command_outcome,'denied');
const replay = await handle({ ...base, execute: async () => ({data:[{outcome:'replayed',command_action:'release_ai',target_conversation_id:target}],error:null}) });
assert.match(replay.result.aiText,/Nao alterei novamente/);
const expired = await handle({ ...base, execute: async () => ({data:null,error:{message:'N30B_COMMAND_EXPIRED'}}) });
assert.match(expired.result.aiText,/expirou/);
const invalid = await handle({ ...base, execute: async () => ({data:[],error:null}) }); assert.equal(invalid.result.ok,false);
const unavailable = await handle({ ...base, execute: async () => ({data:null,error:{message:'network error'}}) }); assert.equal(unavailable.result.ok,false);
const wrong = await handle({ ...base, readMessage: async () => ({data:{id:'other',content:'libere a ia',message_type:'text'},error:null}) }); assert.equal(wrong.result.ok,false);
const saveError = await handle({ ...base, persist:async () => ({message:'fail'}) }); assert.equal(saveError.result.ok,false);
console.log('PASS - N31 PANEL HUMAN CONTROL ROUTING, DENIAL, REPLAY, FAILURE');
