export interface ResendEmailRequest {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}

export type ResendEmailResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; safeError: string };

function getProviderMessageId(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
  ) {
    return value.id;
  }

  return null;
}

export async function sendEmailViaResend(
  request: ResendEmailRequest,
  fetchImplementation: typeof fetch = fetch
): Promise<ResendEmailResult> {
  try {
    const response = await fetchImplementation("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": request.idempotencyKey,
      },
      body: JSON.stringify({
        from: request.from,
        to: [request.to],
        subject: request.subject,
        text: request.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        ok: false,
        safeError: `Resend request failed with HTTP ${response.status}.`,
      };
    }

    const responseBody: unknown = await response.json().catch(() => null);

    return {
      ok: true,
      providerMessageId: getProviderMessageId(responseBody),
    };
  } catch {
    return {
      ok: false,
      safeError: "Email provider request failed.",
    };
  }
}
