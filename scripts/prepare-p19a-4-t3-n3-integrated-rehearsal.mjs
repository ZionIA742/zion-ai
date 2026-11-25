import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repairPath = path.join(
  root,
  "supabase/repairs/20261123230000_p19a_4_t3_human_takeover_contract_repair.sql",
);
const fencesPath = path.join(
  root,
  "supabase/repairs/20261124160000_p19a_4_t3_n2_hard_hold_ai_fences.sql",
);

function readSqlWithoutOuterTransaction(filePath) {
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  const beginIndex = lines.findIndex((line) => /^\s*begin;\s*$/i.test(line));
  if (beginIndex < 0) {
    throw new Error(`BEGIN externo ausente: ${filePath}`);
  }
  const commitIndex = lines
    .map((line, index) => ({ line, index }))
    .reverse()
    .find(({ line }) => /^\s*commit;\s*$/i.test(line))?.index ?? -1;
  if (commitIndex <= beginIndex) {
    throw new Error(`COMMIT externo ausente: ${filePath}`);
  }

  const inner = lines.slice(beginIndex + 1, commitIndex).join("\n");
  if (/^\s*(begin|commit);\s*$/im.test(inner)) {
    throw new Error(`Delimitador transacional interno inesperado: ${filePath}`);
  }
  return inner;
}

const integratedPostconditions = String.raw`
do $p19a_4_t3_n3_integrated_postconditions$
declare
  v_p0 text := (
    select pg_catalog.lower(p.prosrc)
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.process_stale_human_conversations()')
  );
  v_release_acl boolean := pg_catalog.has_function_privilege(
    'service_role',
    'public.release_human_takeover_lease_by_system(uuid,text)',
    'EXECUTE'
  );
  v_panel_acl boolean := pg_catalog.has_function_privilege(
    'authenticated',
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)',
    'EXECUTE'
  );
  v_panel_service_acl boolean := pg_catalog.has_function_privilege(
    'service_role',
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)',
    'EXECUTE'
  );
  v_human_release_service_acl boolean := pg_catalog.has_function_privilege(
    'service_role',
    'public.human_release_conversation_to_ai(uuid,text,text)',
    'EXECUTE'
  );
  v_worker text := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.materialize_sales_ai_reply_set_by_worker_by_system(uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,text,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure
  ));
  v_send text := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.validate_or_cancel_whatsapp_external_send_by_system(uuid,uuid,uuid)'::regprocedure
  ));
  v_panel text := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.panel_release_conversation_to_ai_scoped(uuid,uuid,text,text)'::regprocedure
  ));
begin
  if v_p0 is null
     or pg_catalog.regexp_replace(v_p0, '[[:space:]]+', '', 'g') not in ('beginreturn0;end;', 'beginreturn0;end')
     or v_release_acl
     or v_human_release_service_acl
     or not v_panel_acl
     or v_panel_service_acl
     or pg_catalog.strpos(v_worker, 'hard_hold') = 0
     or pg_catalog.strpos(v_worker, 'conversation_human_takeover_leases') = 0
     or pg_catalog.strpos(v_send, 'hard_hold') = 0
     or pg_catalog.strpos(v_send, 'released_at') = 0
     or pg_catalog.strpos(v_panel, 'auth.uid()') = 0
     or pg_catalog.strpos(v_panel, 'human takeover hard hold requires explicit release authority') = 0 then
    raise exception using errcode = 'P0001',
      message = 'P19A_4_T3_N3_INTEGRATED_POSTCONDITION_FAILED';
  end if;
end;
$p19a_4_t3_n3_integrated_postconditions$;
`;

export function buildIntegratedRehearsal() {
  return [
    "-- P19-A / Bloco 4 / 4-T3-N.3 / ensaio integrado somente leitura operacional",
    "-- Reparos e fences sao compostos nesta ordem; somente os delimitadores externos sao removidos.",
    "begin;",
    readSqlWithoutOuterTransaction(repairPath),
    "-- N2 fences dependem das tabelas/funcoes instaladas pelo reparo acima.",
    readSqlWithoutOuterTransaction(fencesPath),
    integratedPostconditions,
    "rollback;",
    "",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(buildIntegratedRehearsal());
}
