// Ported 1:1 from public/shared.js's authHeaders()/apiFetch()/postJson() —
// same precedence (session token wins over legacy admin key), same 401
// handling contract. Kept as free functions (not a class) to match the
// original's shape exactly, so behavior stays easy to diff against it.

export function authHeaders(): Record<string, string> {
  const sessionToken = localStorage.getItem("sessionToken");
  if (sessionToken) return { Authorization: `Bearer ${sessionToken}` };
  const key = localStorage.getItem("adminApiKey");
  return key ? { "x-api-key": key } : {};
}

// Set by AuthProvider — mirrors window.onAuthRequired in the vanilla app.
let onAuthRequired: (() => void) | null = null;
export function setOnAuthRequired(handler: (() => void) | null) {
  onAuthRequired = handler;
}

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers as Record<string, string> | undefined), ...authHeaders() },
  });
  if (response.status === 401) {
    onAuthRequired?.();
    // Same "never resolves" contract as the original — the caller is left
    // pending while the auth-required redirect takes over the page.
    return new Promise<Response>(() => {});
  }
  return response;
}

export async function postJson<T = unknown>(url: string, payload: unknown): Promise<T> {
  const response = await apiFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok && response.status !== 202) {
    throw new Error(body.error || JSON.stringify(body));
  }
  return body as T;
}

export async function getJson<T = unknown>(url: string): Promise<T> {
  const response = await apiFetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || JSON.stringify(body));
  return body as T;
}
