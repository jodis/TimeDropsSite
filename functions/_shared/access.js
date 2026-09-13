const CERT_CACHE_TTL_MS = 10 * 60 * 1000;
const certificateCache = new Map();

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function normalizedTeamDomain(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.startsWith("https://") ? value : `https://${value}`);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".cloudflareaccess.com")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function loadAccessKeys(teamDomain, fetcher) {
  const cached = certificateCache.get(teamDomain);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;
  const response = await fetcher(`${teamDomain}/cdn-cgi/access/certs`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("ACCESS_CERTS_UNAVAILABLE");
  const payload = await response.json();
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  if (!keys.length) throw new Error("ACCESS_CERTS_EMPTY");
  certificateCache.set(teamDomain, { keys, expiresAt: Date.now() + CERT_CACHE_TTL_MS });
  return keys;
}

function allowedEmails(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** 对 Cloudflare Access JWT 做独立验签，避免仅信任可伪造的请求头。 */
export async function authenticateAccessRequest(request, env, fetcher = fetch) {
  const teamDomain = normalizedTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const audience = String(env.CF_ACCESS_AUD || "").trim();
  const allowlist = allowedEmails(env.SUPPORT_ADMIN_EMAILS);
  if (!teamDomain || !audience || !allowlist.size) {
    return { response: json(503, { error: "admin_not_configured" }) };
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion") || "";
  const parts = token.split(".");
  if (parts.length !== 3) return { response: json(401, { error: "access_required" }) };

  try {
    const header = decodeJsonPart(parts[0]);
    const claims = decodeJsonPart(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("ACCESS_ALG_INVALID");
    const keys = await loadAccessKeys(teamDomain, fetcher);
    const jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) throw new Error("ACCESS_KEY_NOT_FOUND");
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const validSignature = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(parts[2]),
      signed,
    );
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const issuer = String(claims.iss || "").replace(/\/$/, "");
    const email = String(claims.email || "").trim().toLowerCase();
    const validClaims = validSignature &&
      issuer === teamDomain &&
      audiences.includes(audience) &&
      Number.isFinite(claims.exp) && claims.exp > now &&
      (!Number.isFinite(claims.nbf) || claims.nbf <= now) &&
      allowlist.has(email);
    if (!validClaims) throw new Error("ACCESS_CLAIMS_INVALID");
    return { email };
  } catch {
    return { response: json(403, { error: "access_denied" }) };
  }
}

export function clearAccessCertificateCacheForTest() {
  certificateCache.clear();
}
