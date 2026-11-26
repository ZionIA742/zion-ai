"use client";

import {useLayoutEffect,useRef,useState} from "react";
import {supabase} from "@/lib/supabaseBrowser";
import GeneralQuoteLeadPicker from "./GeneralQuoteLeadPicker";
import type {GeneralQuoteLead} from "./general-quote-model";
import {
  normalizeQuoteSendPhone,
  submitManualQuoteSend,
  type QuoteSendScope,
  type QuoteSendRecipient,
} from "./manual-quote-send";

type SendResult=Awaited<ReturnType<typeof submitManualQuoteSend>>;

type Props={
  scope:QuoteSendScope;
  quoteId:string;
  quoteVersionId:string;
  onClose:()=>void;
  onAccepted?:(recipient:QuoteSendRecipient,result:SendResult)=>void|Promise<void>;
};

export async function loadManualQuotePdfLink(
  quoteId:string,
  quoteVersionId:string,
  fetcher:typeof fetch=fetch
){
  const response=await fetcher(
    "/api/sales-quotes/"+encodeURIComponent(quoteId)+
    "/signed-pdf-url?expectedQuoteVersionId="+
    encodeURIComponent(quoteVersionId),
    {method:"GET",cache:"no-store"}
  );

  const row=await response.json().catch(()=>null);

  if(
    !response.ok ||
    row?.ok!==true ||
    row.quoteId!==quoteId ||
    row.quoteVersionId!==quoteVersionId ||
    row.mimeType!=="application/pdf" ||
    typeof row.signedUrl!=="string"
  ){
    throw new Error("PDF_IDENTITY_NOT_CONFIRMED");
  }

  const url=new URL(row.signedUrl);

  if(url.protocol!=="https:" || url.username || url.password){
    throw new Error("PDF_URL_INVALID");
  }

  const filename=typeof row.originalFilename==="string"
    ? row.originalFilename.replace(/[\\/:*?"<>|\x00-\x1f]/g,"_")
    : "orcamento.pdf";

  return {
    signedUrl:url.href,
    filename:filename.toLowerCase().endsWith(".pdf")
      ? filename
      : "orcamento.pdf",
  };
}

export default function ManualQuoteSuccessPanel(props:Props){
  const key=JSON.stringify([
    props.scope.organizationId,
    props.scope.storeId,
    props.scope.userId,
    props.quoteId,
    props.quoteVersionId
  ]);

  return <SuccessPanel key={key} {...props}/>;
}

function SuccessPanel({
  scope,quoteId,quoteVersionId,onClose,onAccepted
}:Props){

  const [kind,setKind]=useState<QuoteSendRecipient["kind"]|"">("");
  const [lead,setLead]=useState<GeneralQuoteLead|null>(null);
  const [phone,setPhone]=useState("");
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<SendResult|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [previewLink,setPreviewLink]=useState<string|null>(null);

  const mounted=useRef(false);
  const inFlight=useRef(false);

  useLayoutEffect(()=>{
    mounted.current=true;
    return ()=>{mounted.current=false;};
  },[]);

  async function assertScope(){
    if(!mounted.current) return false;

    const {data,error}=await supabase.auth.getUser();

    return mounted.current &&
      !error &&
      data.user?.id===scope.userId;
  }

  function changeKind(next:QuoteSendRecipient["kind"]){
    if(inFlight.current) return;
    setKind(next);
    setLead(null);
    setPhone("");
    setResult(null);
    setError(null);
  }

  function getRecipient():QuoteSendRecipient{

    if(kind==="lead"){
      if(
        !lead ||
        lead.organizationId!==scope.organizationId ||
        lead.storeId!==scope.storeId
      ){
        throw new Error("Selecione um lead da loja.");
      }

      return {kind:"lead",leadId:lead.id};
    }

    if(kind==="phone"){
      return {kind:"phone",phone:normalizeQuoteSendPhone(phone)};
    }

    if(kind==="responsible"){
      return {kind:"responsible"};
    }

    throw new Error("Selecione um destinatario.");
  }

  async function send(newIntent=false){

    if(inFlight.current || !mounted.current) return;

    let recipient:QuoteSendRecipient;

    try{
      recipient=getRecipient();
    }catch{
      setError("Revise o destinatario informado.");
      return;
    }

    const terminal=result &&
      ["accepted","blocked","failed"].includes(result.status);

    if(newIntent){
      if(!terminal || !result) return;

      if(!window.confirm(
        "Confirma uma nova tentativa de envio deste documento?"
      )) return;
    }else if(terminal){
      return;
    }

    inFlight.current=true;
    setBusy(true);
    setError(null);

    try{

      const next=await submitManualQuoteSend({
        scope,
        quoteId,
        quoteVersionId,
        recipient,
        assertScope,
        ...(newIntent && result
          ? {replaceOperationId:result.operationId}
          : {})
      });

      if(!await assertScope()) return;

      setResult(next);

      if(next.providerAccepted && onAccepted){
        try{
          await onAccepted(recipient,next);
        }catch{
          if(mounted.current){
            setError("Envio aceito. Atualize a tela para consultar o CRM.");
          }
        }
      }

    }catch{
      if(mounted.current){
        setError(
          "Nao foi possivel concluir a operacao. Revise a sessao ou consulte a mesma operacao."
        );
      }
    }finally{
      inFlight.current=false;
      if(mounted.current) setBusy(false);
    }
  }

  async function accessPdf(mode:"view"|"download"){

    if(inFlight.current || !mounted.current) return;

    inFlight.current=true;
    setBusy(true);
    setError(null);
    setPreviewLink(null);

    let popup:Window|null=null;

    try{

      if(mode==="view"){
        popup=window.open("about:blank","_blank");
        if(popup) popup.opener=null;
      }

      if(!await assertScope()) throw new Error("SESSION_CHANGED");

      const documentLink=await loadManualQuotePdfLink(
        quoteId,quoteVersionId
      );

      if(!await assertScope()) throw new Error("SESSION_CHANGED");

      if(mode==="view"){
        if(popup && !popup.closed){
          popup.location.replace(documentLink.signedUrl);
        }else{
          setPreviewLink(documentLink.signedUrl);
        }
        return;
      }

      const response=await fetch(documentLink.signedUrl,{
        cache:"no-store",
        credentials:"omit",
        referrerPolicy:"no-referrer"
      });

      if(!response.ok) throw new Error("DOWNLOAD_FAILED");

      const blob=await response.blob();

      if(!blob.size || !await assertScope()){
        throw new Error("DOWNLOAD_NOT_CONFIRMED");
      }

      const objectUrl=URL.createObjectURL(blob);

      try{
        const anchor=document.createElement("a");
        anchor.href=objectUrl;
        anchor.download=documentLink.filename;
        anchor.click();
      }finally{
        window.setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
      }

    }catch{
      if(popup && !popup.closed) popup.close();

      if(mounted.current){
        setError("Nao foi possivel acessar a versao exata do PDF.");
      }
    }finally{
      inFlight.current=false;
      if(mounted.current) setBusy(false);
    }
  }

  const terminal=Boolean(result &&
    ["accepted","blocked","failed"].includes(result.status));

  const buttonClass=
    "rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Orcamento gerado"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 className="text-lg font-bold text-gray-900">
          {"Or\u00e7amento gerado com sucesso!"}
        </h2>

        <p className="mt-1 text-sm text-gray-600">
          Seu documento foi salvo no ZION.
        </p>

        <fieldset disabled={busy} className="mt-4 grid gap-3">

          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={buttonClass}
              onClick={()=>void accessPdf("view")}>
              Visualizar PDF
            </button>
            <button type="button" className={buttonClass}
              onClick={()=>void accessPdf("download")}>
              Baixar PDF
            </button>
          </div>

          {previewLink && !busy ? (
            <a href={previewLink} target="_blank"
              rel="noopener noreferrer" className={buttonClass}>
              Abrir PDF em nova aba
            </a>
          ):null}

          <div className="border-t pt-3 text-sm font-semibold">
            Enviar pelo WhatsApp
          </div>

          {([
            ["lead","Enviar para um lead do CRM"],
            ["phone","Enviar para outro n\u00famero"],
            ["responsible","Enviar para o WhatsApp do respons\u00e1vel"]
          ] as const).map(([value,label])=>(
            <button
              type="button"
              key={value}
              aria-pressed={kind===value}
              onClick={()=>changeKind(value)}
              className={buttonClass+
                (kind===value?" ring-2 ring-gray-900":"")}
            >
              {label}
            </button>
          ))}

          {kind==="lead" && !lead ? (
            <GeneralQuoteLeadPicker
              organizationId={scope.organizationId}
              storeId={scope.storeId}
              disabled={busy}
              onSelect={value=>{
                if(inFlight.current) return;
                if(
                  value.organizationId!==scope.organizationId ||
                  value.storeId!==scope.storeId
                ){
                  setError("Lead fora do escopo da loja.");
                  return;
                }
                setLead(value);
                setResult(null);
                setError(null);
              }}
              onCancel={()=>{if(!inFlight.current)setKind("");}}
            />
          ):null}

          {kind==="lead" && lead ? (
            <div className="rounded-xl bg-gray-50 p-3 text-sm">
              <p>{lead.name || "Lead sem nome"}</p>
              <p>{lead.phone || "Telefone nao informado"}</p>
              <button type="button"
                className="mt-2 underline"
                onClick={()=>changeKind("lead")}>
                Alterar lead
              </button>
            </div>
          ):null}

          {kind==="phone" ? (
            <input
              aria-label="Telefone do destinatario"
              type="tel"
              value={phone}
              maxLength={40}
              placeholder="(11) 99999-9999"
              className="rounded-xl border p-3 text-sm"
              onChange={event=>{
                if(inFlight.current)return;
                setPhone(event.target.value);
                setResult(null);
                setError(null);
              }}
            />
          ):null}

          {kind==="responsible" ? (
            <p className="text-xs text-gray-600">
              O documento sera enviado ao responsavel cadastrado na loja.
            </p>
          ):null}

          {result ? (
            <p role="status" className="rounded-xl bg-gray-50 p-3 text-sm">
              {result.providerAccepted
                ? "Envio aceito pelo WhatsApp. Entrega ainda nao confirmada."
                : result.message}
            </p>
          ):null}

          {error ? (
            <p role="alert" className="text-sm text-red-700">{error}</p>
          ):null}

          <button
            type="button"
            disabled={busy || !kind ||
              (kind==="lead" && !lead) ||
              (kind==="phone" && !phone.trim())}
            onClick={()=>void send(terminal)}
            className="rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy?"Processando...":
              terminal?"Iniciar novo envio":
              result?"Consultar ou retomar a mesma operacao":
              "Enviar orcamento"}
          </button>

          <button type="button" className={buttonClass}
            onClick={()=>{if(!inFlight.current)onClose();}}>
            Deixar salvo
          </button>
        </fieldset>
      </section>
    </div>
  );
}
