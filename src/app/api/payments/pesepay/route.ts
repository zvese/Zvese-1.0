import { authenticCallback, validReference } from "@/lib/payments/pesepay";
import { paymentConfiguration, verifySavedPayment } from "@/lib/payments/server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { integrationKey } = paymentConfiguration();
    if (!authenticCallback(request.headers.get("authorization"), integrationKey)) return new Response(null, { status: 401 });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 415 });
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 16384) { await reader.cancel(); return new Response(null, { status: 413 }); }
      chunks.push(part.value);
    }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return new Response(null, { status: 400 }); }
    if (!value || !validReference(value.referenceNumber)) return new Response(null, { status: 400 });
    // Ignore all callback status/amount fields; independently query the provider.
    await verifySavedPayment({ reference: value.referenceNumber });
    return new Response(null, { status: 204 });
  } catch {
    // Never return/log provider payloads, credentials, or customer records.
    return new Response(null, { status: 503 });
  }
}
