function isLocalhostApiUrl(url: string): boolean {
  const s = url.replace(/\/$/, "");
  if (!s) return false;
  try {
    const u = new URL(s.startsWith("http") ? s : `http://${s}`);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Base URL for the Node API (e.g. http://localhost:3001 or https://api.example.com). */
export function apiBaseUrl(): string {
  const u = import.meta.env.VITE_API_URL as string | undefined;
  const raw = (u ?? "").trim();
  if (!raw) {
    throw new Error("VITE_API_URL is not set");
  }
  // Netlify (HTTPS) → EB (HTTP) via netlify.toml / _redirects proxy: call same origin in the browser.
  if (raw === "same-origin") {
    if (typeof window === "undefined") {
      throw new Error("VITE_API_URL=same-origin only works in the browser");
    }
    return window.location.origin.replace(/\/$/, "");
  }
  // Production build often still has localhost from .env; on Netlify that points at the user's PC, not the API.
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const onDeployedHost = host !== "localhost" && host !== "127.0.0.1";
    if (onDeployedHost && isLocalhostApiUrl(raw)) {
      return window.location.origin.replace(/\/$/, "");
    }
  }
  return raw.replace(/\/$/, "");
}

/** Shared secret; must match server API_BEARER_TOKEN when set. */
export function apiBearerToken(): string {
  return (import.meta.env.VITE_API_BEARER_TOKEN as string | undefined) ?? "";
}

export function authHeadersJson(): HeadersInit {
  return {
    Authorization: `Bearer ${apiBearerToken()}`,
    "Content-Type": "application/json",
  };
}

export function authUrl(action: string): string {
  return `${apiBaseUrl()}/auth?action=${encodeURIComponent(action)}`;
}

export function uploadUrl(): string {
  return `${apiBaseUrl()}/upload`;
}

export async function parseJsonResponse(response: Response): Promise<any> {
  const raw = await response.text();
  if (!raw || !raw.trim()) {
    throw new Error(`Server returned empty response (HTTP ${response.status}). Please try again.`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Server returned invalid JSON (HTTP ${response.status}). Please retry.`);
  }
}
