export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { GET as observedGET } from "./route-handler";
export { POST } from "./route-handler";

export function GET(request: Request) {
  return observedGET(request);
}
