const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const REPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_CATEGORIES = new Set(["issue", "suggestion", "other"]);
// 客户端上限按字符计算；预留 UTF-8 四字节字符和 JSON 转义开销，避免合法诊断被字节门槛误拒绝。
const MAX_BODY_BYTES = 600 * 1024;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_DIAGNOSTIC_CHARS = 128 * 1024;
const NORMAL_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const DIAGNOSTIC_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const RATE_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT = 6;

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function cleanText(value, maxChars) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!cleaned || cleaned.length > maxChars) return null;
  return cleaned;
}

function optionalText(value, maxChars) {
  if (value === undefined || value === null) return null;
  return cleanText(value, maxChars);
}

function redactDiagnostics(value) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:token|session|secret|password|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[ID_REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL_REDACTED]")
    .replace(/https?:\/\/[^\s\r\n]*/gi, "[URL_REDACTED]")
    .replace(/\b[A-Z]:\\[^\r\n]*/gi, "[PATH_REDACTED]")
    .replace(/\/(?:data|storage|sdcard|mnt)\/[^\s\r\n]*/gi, "[PATH_REDACTED]");
}

export function validateReport(payload, reportIdHeader) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "invalid_payload" };
  }

  const reportId = typeof payload.reportId === "string" ? payload.reportId : "";
  if (!REPORT_ID_PATTERN.test(reportId) || reportIdHeader !== reportId) {
    return { error: "invalid_report_id" };
  }
  if (!ALLOWED_CATEGORIES.has(payload.category)) {
    return { error: "invalid_category" };
  }

  const message = cleanText(payload.message, MAX_MESSAGE_CHARS);
  const appVersion = cleanText(payload.appVersion, 64);
  const versionCode = Number.isSafeInteger(payload.versionCode) && payload.versionCode >= 1
    ? payload.versionCode
    : null;
  if (!message || !appVersion || versionCode === null || typeof payload.hasDiagnostics !== "boolean") {
    return { error: "invalid_payload" };
  }

  let diagnostics = null;
  const device = {};
  if (payload.hasDiagnostics) {
    diagnostics = optionalText(payload.diagnostics, MAX_DIAGNOSTIC_CHARS);
    const androidApi = Number.isSafeInteger(payload.androidApi) && payload.androidApi >= 1 && payload.androidApi <= 10_000
      ? payload.androidApi
      : null;
    const manufacturer = optionalText(payload.deviceManufacturer, 120);
    const model = optionalText(payload.deviceModel, 120);
    const abi = optionalText(payload.abi, 80);
    if (!diagnostics || androidApi === null || !manufacturer || !model || !abi) {
      return { error: "invalid_diagnostics" };
    }
    device.androidApi = androidApi;
    device.deviceManufacturer = manufacturer;
    device.deviceModel = model;
    device.abi = abi;
    diagnostics = redactDiagnostics(diagnostics);
  } else if (payload.diagnostics !== undefined && payload.diagnostics !== null) {
    return { error: "unexpected_diagnostics" };
  }

  return {
    value: {
      reportId,
      category: payload.category,
      message,
      appVersion,
      versionCode,
      hasDiagnostics: payload.hasDiagnostics,
      device,
      diagnostics,
    },
  };
}

async function hashIp(ip, salt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(ip || "missing"));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function enforceRateLimit(store, request, salt) {
  const ipHash = await hashIp(request.headers.get("CF-Connecting-IP"), salt);
  const window = Math.floor(Date.now() / (RATE_WINDOW_SECONDS * 1000));
  const key = `rate:${ipHash}:${window}`;
  const current = Number.parseInt((await store.get(key)) || "0", 10);
  if (Number.isFinite(current) && current >= RATE_LIMIT) return false;
  await store.put(key, String((Number.isFinite(current) ? current : 0) + 1), {
    expirationTtl: RATE_WINDOW_SECONDS + 120,
  });
  return true;
}

export async function handleReportPost(context) {
  const store = context.env.SUPPORT_REPORTS;
  const rateLimitSalt = context.env.RATE_LIMIT_SALT;
  if (!store || typeof rateLimitSalt !== "string" || rateLimitSalt.length < 32) {
    return json(503, { error: "service_unavailable" });
  }

  const contentType = context.request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return json(415, { error: "unsupported_media_type" });
  }
  const declaredLength = Number.parseInt(context.request.headers.get("content-length") || "0", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json(413, { error: "payload_too_large" });
  }
  if (!(await enforceRateLimit(store, context.request, rateLimitSalt))) {
    return json(429, { error: "rate_limited" }, { "retry-after": String(RATE_WINDOW_SECONDS) });
  }

  let rawBody;
  let payload;
  try {
    rawBody = await context.request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json(413, { error: "payload_too_large" });
    }
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const reportIdHeader = context.request.headers.get("X-TimeDrops-Report-Id") || "";
  const validated = validateReport(payload, reportIdHeader);
  if (validated.error) return json(400, { error: validated.error });

  const report = validated.value;
  const reportKey = `report:${report.reportId}`;
  if (await store.get(reportKey)) {
    return json(200, { reportId: report.reportId, duplicate: true });
  }

  const createdAt = new Date().toISOString();
  const diagnosticKey = `diagnostic:${report.reportId}`;
  try {
    if (report.hasDiagnostics) {
      await store.put(diagnosticKey, JSON.stringify({
        reportId: report.reportId,
        createdAt,
        ...report.device,
        diagnostics: report.diagnostics,
      }), { expirationTtl: DIAGNOSTIC_RETENTION_SECONDS });
    }

    await store.put(reportKey, JSON.stringify({
      reportId: report.reportId,
      category: report.category,
      message: report.message,
      appVersion: report.appVersion,
      versionCode: report.versionCode,
      hasDiagnostics: report.hasDiagnostics,
      diagnosticKey: report.hasDiagnostics ? diagnosticKey : null,
      createdAt,
      expiresAt: new Date(Date.now() + NORMAL_RETENTION_SECONDS * 1000).toISOString(),
    }), { expirationTtl: NORMAL_RETENTION_SECONDS });
  } catch {
    return json(503, { error: "service_unavailable" });
  }

  return json(201, { reportId: report.reportId });
}

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { allow: "POST" });
  }
  return handleReportPost(context);
}
