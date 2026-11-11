import { createWhatsappNumberChangeLinkRouteHandler } from "./route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createWhatsappNumberChangeLinkRouteHandler();
export const GET = handlers.GET;
export const POST = handlers.POST;
