import { authenticateAccessRequest } from "../../_shared/access.js";

const REPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LISTED_REPORTS = 1_000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function reportIdFromRequest(request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  return REPORT_ID_PATTERN.test(id) ? id : null;
}

async function readJson(store, key) {
  const raw = await store.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function listReports(store, request) {
  const requestedLimit = Number.parseInt(new URL(request.url).searchParams.get("limit") || "", 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const listed = await store.list({ prefix: "report:", limit: MAX_LISTED_REPORTS });
  const reports = (await Promise.all(
    listed.keys.map((entry) => readJson(store, entry.name)),
  ))
    .filter(Boolean)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, limit)
    .map((report) => ({
      reportId: report.reportId,
      category: report.category,
      message: report.message,
      contactEmail: report.contactEmail ?? null,
      appVersion: report.appVersion,
      versionCode: report.versionCode,
      hasDiagnostics: report.hasDiagnostics === true,
      createdAt: report.createdAt,
      expiresAt: report.expiresAt,
    }));
  return json(200, { reports, truncated: listed.list_complete === false });
}

async function getReport(store, request) {
  const reportId = reportIdFromRequest(request);
  if (!reportId) return json(400, { error: "invalid_report_id" });
  const report = await readJson(store, `report:${reportId}`);
  if (!report) return json(404, { error: "report_not_found" });
  const includeDiagnostics = new URL(request.url).searchParams.get("includeDiagnostics") === "1";
  const diagnostic = includeDiagnostics && report.hasDiagnostics
    ? await readJson(store, `diagnostic:${reportId}`)
    : null;
  return json(200, {
    report: {
      reportId: report.reportId,
      category: report.category,
      message: report.message,
      contactEmail: report.contactEmail ?? null,
      appVersion: report.appVersion,
      versionCode: report.versionCode,
      hasDiagnostics: report.hasDiagnostics === true,
      createdAt: report.createdAt,
      expiresAt: report.expiresAt,
    },
    diagnostic,
  });
}

async function deleteReport(store, request) {
  const reportId = reportIdFromRequest(request);
  if (!reportId) return json(400, { error: "invalid_report_id" });
  const reportKey = `report:${reportId}`;
  if (!(await store.get(reportKey))) return json(404, { error: "report_not_found" });
  await Promise.all([
    store.delete(reportKey),
    store.delete(`diagnostic:${reportId}`),
  ]);
  return json(200, { deleted: true });
}

/** 管理接口必须同时经过 Cloudflare Access 和函数内 JWT 验签/邮箱白名单。 */
export async function onRequest(context) {
  if (!context.env.SUPPORT_REPORTS) return json(503, { error: "service_unavailable" });
  const authentication = await authenticateAccessRequest(context.request, context.env);
  if (authentication.response) return authentication.response;

  if (context.request.method === "GET") {
    return new URL(context.request.url).searchParams.has("id")
      ? getReport(context.env.SUPPORT_REPORTS, context.request)
      : listReports(context.env.SUPPORT_REPORTS, context.request);
  }
  if (context.request.method === "DELETE") {
    return deleteReport(context.env.SUPPORT_REPORTS, context.request);
  }
  return json(405, { error: "method_not_allowed" });
}

export { deleteReport, getReport, listReports };
