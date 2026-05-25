import OpenAI from "openai";

export type CustomerAudioTranscriptionResult =
  | {
      ok: true;
      transcript: string;
      provider: "openai";
      model: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
      provider: "openai";
      model: string;
    };

export async function transcribeCustomerAudioFromStorage(args: {
  supabase: any;
  bucket: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null | undefined;
}): Promise<CustomerAudioTranscriptionResult> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const model = process.env.ZION_AUDIO_TRANSCRIPTION_MODEL || "whisper-1";

  if (!openaiApiKey) {
    return {
      ok: false,
      error: "OPENAI_ENV_MISSING",
      message: "Verifique OPENAI_API_KEY nas variaveis de ambiente.",
      provider: "openai",
      model,
    };
  }

  const { data: audioBlob, error: downloadError } = await args.supabase.storage
    .from(args.bucket)
    .download(args.storagePath);

  if (downloadError || !audioBlob) {
    return {
      ok: false,
      error: "AUDIO_DOWNLOAD_FAILED",
      message: downloadError?.message || "Nao foi possivel baixar o audio para transcricao.",
      provider: "openai",
      model,
    };
  }

  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioFile = new File([arrayBuffer], args.fileName || "customer-audio.webm", {
    type: args.mimeType || "audio/webm",
  });

  const openai = new OpenAI({ apiKey: openaiApiKey });

  try {
    const response = await openai.audio.transcriptions.create({
      file: audioFile,
      model,
    });

    const transcript = String((response as any)?.text || "").trim();

    if (!transcript) {
      return {
        ok: false,
        error: "EMPTY_AUDIO_TRANSCRIPT",
        message: "A transcricao do audio voltou vazia.",
        provider: "openai",
        model,
      };
    }

    return {
      ok: true,
      transcript,
      provider: "openai",
      model,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: "OPENAI_AUDIO_TRANSCRIPTION_FAILED",
      message: error?.message || "Falha ao transcrever o audio do cliente.",
      provider: "openai",
      model,
    };
  }
}
