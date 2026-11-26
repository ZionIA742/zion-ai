export type QuoteSendScope={
  organizationId:string;
  storeId:string;
  userId:string;
};

export type QuoteSendRecipient=
  | {kind:"lead";leadId:string}
  | {kind:"phone";phone:string}
  | {kind:"responsible"};

type StorageLike=Pick<Storage,"getItem"|"setItem">;

type SendStatus=
  | "registered" | "attempt_started" | "accepted"
  | "blocked" | "failed" | "uncertain" | "unconfirmed";

type SendResult={
  operationId:string;
  status:SendStatus;
  message:string;
  providerAccepted:boolean;
  crmProjection?:string;
  historyProjection?:string;
  inboxReconciliation?:string;
};

type WithLock=(
  key:string,
  work:()=>Promise<SendResult>
)=>Promise<SendResult>;

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value:unknown):string{
  if(
    typeof value!=="string" ||
    !UUID.test(value) ||
    value==="00000000-0000-0000-0000-000000000000"
  ){
    throw new Error("Identidade de envio invalida.");
  }
  return value.toLowerCase();
}

export function normalizeQuoteSendPhone(input:string):string{

  const raw=input.trim();

  if(!raw || raw.length>40 || !/^\+?[0-9 ()-]+$/.test(raw)){
    throw new Error("Informe um telefone valido.");
  }

  let digits=raw.replace(/\D/g,"");

  if(raw.startsWith("+")){
    if(!/^[1-9][0-9]{7,14}$/.test(digits)){
      throw new Error("Telefone internacional invalido.");
    }
  }else if(/^[1-9][0-9]{9,10}$/.test(digits)){
    digits="55"+digits;
  }else if(!/^55[1-9][0-9]{9,10}$/.test(digits)){
    throw new Error("Informe o codigo do pais.");
  }

  if(digits.startsWith("55") && !/^55[1-9][0-9]{9,10}$/.test(digits)){
    throw new Error("Telefone brasileiro invalido.");
  }

  return "+"+digits;
}

function normalizeRecipient(value:QuoteSendRecipient):QuoteSendRecipient{
  switch(value.kind){
    case "lead":return {kind:"lead",leadId:uuid(value.leadId)};
    case "phone":return {kind:"phone",phone:normalizeQuoteSendPhone(value.phone)};
    case "responsible":return {kind:"responsible"};
    default:throw new Error("Destinatario invalido.");
  }
}

const statuses:SendStatus[]=[
  "registered","attempt_started","accepted",
  "blocked","failed","uncertain","unconfirmed"
];

const terminal:SendStatus[]=["accepted","blocked","failed"];

async function browserLock(
  key:string,
  work:()=>Promise<SendResult>
):Promise<SendResult>{

  if(!navigator.locks){
    throw new Error("Protecao de envio indisponivel neste navegador.");
  }

  return navigator.locks.request(
    key,{ifAvailable:true},
    async lock=>{
      if(!lock){
        throw new Error("Ja existe um envio em andamento.");
      }
      return work();
    }
  );
}

async function operationKey(
  scope:QuoteSendScope,
  quoteId:string,
  versionId:string,
  recipient:QuoteSendRecipient
){
  const identity=JSON.stringify([
    uuid(scope.organizationId),
    uuid(scope.storeId),
    uuid(scope.userId),
    quoteId,versionId,recipient
  ]);

  const digest=await crypto.subtle.digest(
    "SHA-256",new TextEncoder().encode(identity)
  );

  return "zion:quote-send:v1:"+Array.from(
    new Uint8Array(digest),
    byte=>byte.toString(16).padStart(2,"0")
  ).join("");
}

export async function submitManualQuoteSend(args:{
  scope:QuoteSendScope;
  quoteId:string;
  quoteVersionId:string;
  recipient:QuoteSendRecipient;
  assertScope:()=>Promise<boolean>;
  storage?:StorageLike;
  createUuid?:()=>string;
  fetcher?:typeof fetch;
  withLock?:WithLock;
  replaceOperationId?:string;
}):Promise<SendResult>{

  const quoteId=uuid(args.quoteId);
  const quoteVersionId=uuid(args.quoteVersionId);
  const recipient=normalizeRecipient(args.recipient);

  const storage=args.storage ?? window.localStorage;
  const fetcher=args.fetcher ?? fetch;
  const lock=args.withLock ?? browserLock;

  const key=await operationKey(
    args.scope,quoteId,quoteVersionId,recipient
  );

  return lock(key,async()=>{

    if(!await args.assertScope()){
      throw new Error("O contexto da sessao mudou.");
    }

    const raw=storage.getItem(key);

    let previous:{
      operationId:string;
      status:SendStatus;
    }|null=null;

    if(raw!==null){
      const row=JSON.parse(raw);

      if(!row || !statuses.includes(row.status)){
        throw new Error("Registro local de envio invalido.");
      }

      previous={
        operationId:uuid(row.operationId),
        status:row.status
      };
    }

    if(args.replaceOperationId!==undefined){
      if(
        !previous ||
        previous.operationId!==uuid(args.replaceOperationId) ||
        !terminal.includes(previous.status)
      ){
        throw new Error("A operacao anterior precisa ser reconciliada.");
      }
    }

    const operationId=
      previous && args.replaceOperationId===undefined
        ? previous.operationId
        : uuid((args.createUuid ?? (()=>crypto.randomUUID()))());

    const persist=(status:SendStatus)=>{
      const value=JSON.stringify({operationId,status});
      storage.setItem(key,value);

      if(storage.getItem(key)!==value){
        throw new Error("Nao foi possivel preservar a identidade do envio.");
      }
    };

    if(!await args.assertScope()){
      throw new Error("O contexto da sessao mudou.");
    }

    // Persist before making any external request.
    persist("unconfirmed");

    const unknown:SendResult={
      operationId,
      status:"unconfirmed",
      providerAccepted:false,
      message:"Resultado nao confirmado. Consulte a mesma operacao antes de reenviar."
    };

    let result:SendResult;

    try{

      const response=await fetcher(
        "/api/sales-quotes/"+encodeURIComponent(quoteId)+"/send-human",
        {
          method:"POST",
          cache:"no-store",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            operationId,quoteVersionId,recipient
          })
        }
      );

      const row=await response.json().catch(()=>null);

      if(
        !row ||
        row.operationId!==operationId ||
        row.quoteId!==quoteId ||
        row.quoteVersionId!==quoteVersionId ||
        !statuses.includes(row.status)
      ){
        if(
          row?.operationId===operationId &&
          row?.ok===false &&
          typeof row.error==="string" &&
          typeof row.message==="string" &&
          row.message.length<=300
        ){
          return {...unknown,message:row.message};
        }

        return unknown;
      }

      const accepted=row.status==="accepted";
      const processing=["registered","attempt_started"].includes(row.status);

      if(
        row.ok!==accepted ||
        row.providerAccepted!==accepted ||
        response.status!==(accepted?200:processing?202:409)
      ){
        return unknown;
      }

      result={
        operationId,
        status:row.status,
        providerAccepted:accepted,
        message:typeof row.message==="string" && row.message.length<=300
          ? row.message
          : accepted
            ? "Envio aceito pelo WhatsApp."
            : unknown.message
      };

      for(const field of [
        "crmProjection","historyProjection","inboxReconciliation"
      ] as const){
        if([
          "moved","unchanged","skipped","pending",
          "recorded","reconciled","not_applicable"
        ].includes(row[field])){
          result[field]=row[field];
        }
      }

    }catch{
      return unknown;
    }

    try{
      persist(result.status);
    }catch{
      // The original operation identity remains the recovery key.
      // Never replace confirmed provider acceptance with a failure.
    }

    return result;
  });
}
