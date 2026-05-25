export type ClassifiedMediaPurpose =
  | "customer_location_photo"
  | "customer_product_or_pool_photo"
  | "payment_proof"
  | "conversation_or_document_screenshot"
  | "catalog_file"
  | "unknown_image"
  | "customer_audio"
  | "customer_video";

export type MediaClassificationConfidence = "high" | "medium" | "low";

export type IncomingMediaClassificationInput = {
  messageType?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  content?: string | null;
  explicitPurpose?: string | null;
  sender?: string | null;
  direction?: string | null;
  sourceChannel?: string | null;
  recentConversationText?: string[];
};

export type MediaClassificationResult = {
  mediaPurpose: ClassifiedMediaPurpose;
  confidence: MediaClassificationConfidence;
  reason: string;
  requiresAiAnalysis: boolean;
  requiresHumanReview: boolean;
};

function normalizeLooseText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function includesAny(source: string, terms: string[]) {
  return terms.some((term) => source.includes(term));
}

function isDocumentMimeType(mimeType: string) {
  return [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ].includes(mimeType);
}

function inferFromExplicitPurpose(
  explicitPurpose: string,
): MediaClassificationResult | null {
  const normalizedPurpose = normalizeLooseText(explicitPurpose);

  if (normalizedPurpose === "customer_location_photo") {
    return {
      mediaPurpose: "customer_location_photo",
      confidence: "high",
      reason: "purpose explicito indica foto do local.",
      requiresAiAnalysis: false,
      requiresHumanReview: false,
    };
  }

  if (normalizedPurpose === "customer_product_photo") {
    return {
      mediaPurpose: "customer_product_or_pool_photo",
      confidence: "high",
      reason: "purpose explicito indica foto de produto ou piscina.",
      requiresAiAnalysis: false,
      requiresHumanReview: false,
    };
  }

  if (normalizedPurpose === "payment_receipt") {
    return {
      mediaPurpose: "payment_proof",
      confidence: "high",
      reason: "purpose explicito indica comprovante de pagamento.",
      requiresAiAnalysis: false,
      requiresHumanReview: true,
    };
  }

  if (normalizedPurpose === "screenshot") {
    return {
      mediaPurpose: "conversation_or_document_screenshot",
      confidence: "high",
      reason: "purpose explicito indica print ou documento.",
      requiresAiAnalysis: false,
      requiresHumanReview: true,
    };
  }

  if (normalizedPurpose === "operational_image") {
    return {
      mediaPurpose: "unknown_image",
      confidence: "medium",
      reason: "purpose operacional ainda nao possui classificacao dedicada.",
      requiresAiAnalysis: false,
      requiresHumanReview: true,
    };
  }

  if (normalizedPurpose === "unknown") {
    return {
      mediaPurpose: "unknown_image",
      confidence: "low",
      reason: "purpose explicito marcado como desconhecido.",
      requiresAiAnalysis: false,
      requiresHumanReview: false,
    };
  }

  return null;
}

export function classifyIncomingMediaMessage(
  input: IncomingMediaClassificationInput,
): MediaClassificationResult {
  const messageType = normalizeLooseText(input.messageType);
  const mimeType = normalizeLooseText(input.mimeType);
  const explicitPurpose = normalizeLooseText(input.explicitPurpose);
  const combinedText = normalizeLooseText(
    [
      input.fileName,
      input.content,
      input.sender,
      input.direction,
      input.sourceChannel,
      ...(input.recentConversationText || []),
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (
    messageType === "audio" ||
    mimeType.startsWith("audio/") ||
    combinedText.includes("audio")
  ) {
    return {
      mediaPurpose: "customer_audio",
      confidence: "high",
      reason: "tipo de mensagem ou mime indica audio.",
      requiresAiAnalysis: true,
      requiresHumanReview: false,
    };
  }

  if (
    messageType === "video" ||
    mimeType.startsWith("video/") ||
    combinedText.includes("video")
  ) {
    return {
      mediaPurpose: "customer_video",
      confidence: "high",
      reason: "tipo de mensagem ou mime indica video.",
      requiresAiAnalysis: true,
      requiresHumanReview: false,
    };
  }

  if (isDocumentMimeType(mimeType)) {
    if (
      includesAny(combinedText, [
        "comprovante",
        "pix",
        "pagamento",
        "pago",
        "transferencia",
        "boleto",
        "recibo",
        "receipt",
      ])
    ) {
      return {
        mediaPurpose: "payment_proof",
        confidence: "high",
        reason: "mime de documento com texto ou nome sugerindo comprovante.",
        requiresAiAnalysis: false,
        requiresHumanReview: true,
      };
    }

    if (
      includesAny(combinedText, [
        "catalogo",
        "tabela",
        "lista de produtos",
        "lista-precos",
        "lista de precos",
        "produtos",
        "pdf catalogo",
      ])
    ) {
      return {
        mediaPurpose: "catalog_file",
        confidence: "high",
        reason: "mime de documento com texto ou nome sugerindo catalogo.",
        requiresAiAnalysis: false,
        requiresHumanReview: true,
      };
    }

    return {
      mediaPurpose: "conversation_or_document_screenshot",
      confidence: "medium",
      reason: "mime de documento sem contexto suficiente para classificacao mais especifica.",
      requiresAiAnalysis: false,
      requiresHumanReview: true,
    };
  }

  const explicitPurposeClassification = inferFromExplicitPurpose(explicitPurpose);

  if (explicitPurposeClassification) {
    return explicitPurposeClassification;
  }

  if (
    includesAny(combinedText, [
      "comprovante",
      "pix",
      "pagamento",
      "pago",
      "transferencia",
      "boleto",
      "recibo",
      "receipt",
    ])
  ) {
    return {
      mediaPurpose: "payment_proof",
      confidence: "medium",
      reason: "texto ou nome do arquivo sugere comprovante de pagamento.",
      requiresAiAnalysis: false,
      requiresHumanReview: true,
    };
  }

  if (
    includesAny(combinedText, [
      "catalogo",
      "tabela",
      "lista de produtos",
      "lista-precos",
      "lista de precos",
      "produtos",
      "pdf catalogo",
    ])
  ) {
    return {
      mediaPurpose: "catalog_file",
      confidence: "medium",
      reason: "texto ou nome do arquivo sugere catalogo ou lista comercial.",
      requiresAiAnalysis: false,
      requiresHumanReview: true,
    };
  }

  if (
    includesAny(combinedText, [
      "print",
      "screenshot",
      "captura",
      "conversa",
      "orcamento",
      "proposta",
      "documento",
    ])
  ) {
    return {
      mediaPurpose: "conversation_or_document_screenshot",
      confidence: "medium",
      reason: "texto ou nome do arquivo sugere print ou documento.",
      requiresAiAnalysis: false,
      requiresHumanReview: true,
    };
  }

  if (
    includesAny(combinedText, [
      "foto do local",
      "meu quintal",
      "quintal",
      "terreno",
      "espaco",
      "area",
      "onde quero instalar",
      "local da piscina",
    ])
  ) {
    return {
      mediaPurpose: "customer_location_photo",
      confidence: "medium",
      reason: "texto ou contexto sugere foto do local de instalacao.",
      requiresAiAnalysis: false,
      requiresHumanReview: false,
    };
  }

  if (
    includesAny(combinedText, [
      "essa piscina",
      "essa aqui",
      "modelo",
      "referencia",
      "gostei dessa",
      "produto",
      "piscina",
    ])
  ) {
    return {
      mediaPurpose: "customer_product_or_pool_photo",
      confidence: "medium",
      reason: "texto ou contexto sugere foto de produto ou referencia.",
      requiresAiAnalysis: false,
      requiresHumanReview: false,
    };
  }

  return {
    mediaPurpose: "unknown_image",
    confidence: "low",
    reason: "faltou contexto suficiente para classificar a imagem com seguranca.",
    requiresAiAnalysis: false,
    requiresHumanReview: false,
  };
}
