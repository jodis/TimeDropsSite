const ALLOWED_CATEGORIES = new Set(["issue", "suggestion", "other"]);

function validWebhookUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 可选 Webhook 只发送受控摘要，不发送用户正文、设备信息或诊断内容。
 * 通知失败不得改变已经成功持久化的反馈结果。
 */
export async function sendReportNotification(env, report, fetcher = fetch) {
  const endpoint = validWebhookUrl(env.SUPPORT_NOTIFICATION_WEBHOOK_URL);
  if (!endpoint) return { skipped: true };
  const category = ALLOWED_CATEGORIES.has(report.category) ? report.category : "other";
  const reportShortId = String(report.reportId || "").slice(0, 8);
  const payload = {
    event: "timedrops.support.report.created",
    category,
    reportShortId,
    createdAt: report.createdAt,
    appVersion: String(report.appVersion || "").slice(0, 64),
    hasDiagnostics: report.hasDiagnostics === true,
  };
  const headers = { "content-type": "application/json; charset=utf-8" };
  const token = String(env.SUPPORT_NOTIFICATION_WEBHOOK_TOKEN || "").trim();
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    return { delivered: response.ok, statusCode: response.status };
  } catch {
    return { delivered: false, statusCode: null };
  }
}
