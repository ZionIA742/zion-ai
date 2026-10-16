import {
  createWhatsappPinRecoveryGetHandler,
  createWhatsappPinRecoveryPostHandler,
} from "@/lib/server/whatsapp-pin-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createWhatsappPinRecoveryPostHandler();
export const GET = createWhatsappPinRecoveryGetHandler();
