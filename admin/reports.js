const listElement = document.querySelector("#report-list");
const statusElement = document.querySelector("#admin-status");
const refreshButton = document.querySelector("#refresh-reports");
const limitSelect = document.querySelector("#report-limit");
const template = document.querySelector("#report-template");

const categoryLabels = {
  issue: "问题",
  suggestion: "建议",
  other: "其他",
};

function setStatus(message, failed = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("admin-error", failed);
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN");
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
  return payload;
}

async function loadDiagnostics(reportId, output, button) {
  button.disabled = true;
  try {
    const payload = await requestJson(
      `/api/admin/reports?id=${encodeURIComponent(reportId)}&includeDiagnostics=1`,
    );
    const diagnostic = payload.diagnostic;
    output.textContent = diagnostic?.diagnostics || "诊断内容已到期或不存在。";
    output.hidden = false;
    button.textContent = "已加载诊断";
  } catch {
    output.textContent = "诊断加载失败，请确认 Access 会话和服务配置。";
    output.hidden = false;
    button.disabled = false;
  }
}

async function deleteReport(reportId, card) {
  if (!window.confirm("确认删除这条反馈及其诊断信息？此操作无法撤销。")) return;
  const button = card.querySelector(".report-delete");
  button.disabled = true;
  try {
    await requestJson(`/api/admin/reports?id=${encodeURIComponent(reportId)}`, { method: "DELETE" });
    card.remove();
    setStatus("反馈已删除");
  } catch {
    button.disabled = false;
    setStatus("删除失败，请稍后重试", true);
  }
}

function renderReport(report) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".report-card");
  fragment.querySelector(".report-category").textContent = categoryLabels[report.category] || "其他";
  fragment.querySelector(".report-id").textContent = `#${String(report.reportId).slice(0, 8)}`;
  fragment.querySelector(".report-time").textContent = formatTime(report.createdAt);
  fragment.querySelector(".report-message").textContent = report.message;
  fragment.querySelector(".report-version").textContent = `${report.appVersion} (${report.versionCode})`;
  fragment.querySelector(".report-diagnostic-state").textContent = report.hasDiagnostics ? "用户已附带" : "未附带";
  fragment.querySelector(".report-expiry").textContent = formatTime(report.expiresAt);
  const diagnostics = fragment.querySelector(".report-diagnostics");
  const diagnosticButton = fragment.querySelector(".report-load-diagnostics");
  diagnosticButton.hidden = !report.hasDiagnostics;
  diagnosticButton.addEventListener("click", () => loadDiagnostics(report.reportId, diagnostics, diagnosticButton));
  fragment.querySelector(".report-delete").addEventListener("click", () => deleteReport(report.reportId, card));
  return fragment;
}

async function loadReports() {
  refreshButton.disabled = true;
  setStatus("正在读取反馈…");
  try {
    const payload = await requestJson(`/api/admin/reports?limit=${encodeURIComponent(limitSelect.value)}`);
    listElement.replaceChildren();
    for (const report of payload.reports || []) listElement.append(renderReport(report));
    if (!payload.reports?.length) {
      const empty = document.createElement("p");
      empty.className = "notice";
      empty.textContent = "当前没有反馈。";
      listElement.append(empty);
    }
    setStatus(payload.truncated ? "已显示最近反馈；KV 数量较多，列表已截断" : `共显示 ${payload.reports?.length || 0} 条`);
  } catch {
    listElement.replaceChildren();
    setStatus("读取失败，请确认 Cloudflare Access、KV 和环境变量配置", true);
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", loadReports);
limitSelect.addEventListener("change", loadReports);
loadReports();
