const AUTH_PATHS = new Set(["/sign-in", "/sign-up", "/auth/verify"]);

export function defaultSignedInPath(sellerStatus?: string | null) {
  return sellerStatus === "active" ? "/account#seller-dashboard" : "/marketplace";
}

export function safeNextPath(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  if (/[\\\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }

  let decoded = value;
  try {
    decoded = decodeURIComponent(decoded);
    decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }

  if (
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(decoded)
  ) {
    return null;
  }

  const url = new URL(value, "https://zvese.internal");
  if (url.origin !== "https://zvese.internal" || AUTH_PATHS.has(url.pathname)) {
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function signInPath(next: string, message: string) {
  const params = new URLSearchParams({ message });
  const safeNext = safeNextPath(next);
  if (safeNext) params.set("next", safeNext);
  return `/sign-in?${params.toString()}`;
}

export function withAuthParams(
  path: "/sign-in" | "/sign-up" | "/auth/verify",
  values: Record<string, string | null | undefined>
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (!value) continue;
    if (key === "next") {
      const safeNext = safeNextPath(value);
      if (safeNext) params.set(key, safeNext);
    } else {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
