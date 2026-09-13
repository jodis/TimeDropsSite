import test from "node:test";
import assert from "node:assert/strict";
import { sendReportNotification } from "../functions/_shared/report-notification.js";

const report = {
  reportId: "123e4567-e89b-42d3-a456-426614174000",
  category: "issue",
  message: "这里是用户反馈正文，不应进入通知",
  diagnostics: "这里是诊断，不应进入通知",
  appVersion: "1.0",
  hasDiagnostics: true,
  createdAt: "2026-09-13T10:00:00.000Z",
};

test("未配置 Webhook 时静默跳过", async () => {
  const result = await sendReportNotification({}, report, async () => {
    throw new Error("不应调用网络");
  });
  assert.equal(result.skipped, true);
});

test("Webhook 只发送受控短摘要", async () => {
  let deliveredBody = "";
  let authorization = "";
  const result = await sendReportNotification({
    SUPPORT_NOTIFICATION_WEBHOOK_URL: "https://hooks.example.test/timedrops",
    SUPPORT_NOTIFICATION_WEBHOOK_TOKEN: "test-token",
  }, report, async (_url, init) => {
    deliveredBody = init.body;
    authorization = init.headers.authorization;
    return new Response(null, { status: 204 });
  });

  const payload = JSON.parse(deliveredBody);
  assert.equal(result.delivered, true);
  assert.equal(payload.reportShortId, "123e4567");
  assert.equal(payload.category, "issue");
  assert.equal(payload.hasDiagnostics, true);
  assert.equal(authorization, "Bearer test-token");
  assert.doesNotMatch(deliveredBody, /用户反馈正文|诊断，不应进入通知/);
});

test("非 HTTPS Webhook 地址不会发送", async () => {
  const result = await sendReportNotification({
    SUPPORT_NOTIFICATION_WEBHOOK_URL: "http://hooks.example.test/timedrops",
  }, report, async () => new Response(null, { status: 204 }));
  assert.equal(result.skipped, true);
});
