import test from "node:test";
import assert from "node:assert/strict";
import { handleReportPost, onRequest, validateReport } from "../functions/api/reports.js";

const REPORT_ID = "123e4567-e89b-42d3-a456-426614174000";
const RATE_LIMIT_SALT = "test-only-rate-limit-salt-32-characters";

class MemoryKv {
  constructor() {
    this.values = new Map();
    this.options = new Map();
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async put(key, value, options = {}) {
    this.values.set(key, value);
    this.options.set(key, options);
  }
}

function environment(store) {
  return { SUPPORT_REPORTS: store, RATE_LIMIT_SALT };
}

function payload(overrides = {}) {
  return {
    reportId: REPORT_ID,
    category: "issue",
    message: "生成失败，希望协助排查。",
    appVersion: "1.0",
    versionCode: 1,
    hasDiagnostics: false,
    diagnostics: null,
    ...overrides,
  };
}

function request(body, headers = {}) {
  return new Request("https://timedrops.example/api/reports", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "X-TimeDrops-Report-Id": REPORT_ID,
      "CF-Connecting-IP": "203.0.113.10",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("校验固定分类、长度和请求头中的幂等编号", () => {
  assert.ok(validateReport(payload(), REPORT_ID).value);
  assert.equal(validateReport(payload({ category: "unknown" }), REPORT_ID).error, "invalid_category");
  assert.equal(validateReport(payload(), "different").error, "invalid_report_id");
  assert.equal(validateReport(payload({ message: "x".repeat(4001) }), REPORT_ID).error, "invalid_payload");
});

test("诊断信息必须显式声明且会在服务端二次脱敏", () => {
  const result = validateReport(payload({
    hasDiagnostics: true,
    diagnostics: "token=secret-value /data/user/0/app/private 123e4567-e89b-42d3-a456-426614174000",
    androidApi: 36,
    deviceManufacturer: "Example",
    deviceModel: "Model",
    abi: "arm64-v8a",
  }), REPORT_ID);

  assert.ok(result.value);
  assert.doesNotMatch(result.value.diagnostics, /secret-value|\/data\/user|123e4567/);
});

test("成功持久化后返回 201，重复编号返回 200 且不重复写入", async () => {
  const store = new MemoryKv();
  const context = { env: environment(store), request: request(payload()) };
  const first = await handleReportPost(context);
  assert.equal(first.status, 201);

  const duplicate = await handleReportPost({ env: context.env, request: request(payload()) });
  assert.equal(duplicate.status, 200);
  assert.equal(JSON.parse(await duplicate.text()).duplicate, true);
  assert.ok(store.values.has(`report:${REPORT_ID}`));
});

test("诊断正文与普通反馈分开保存", async () => {
  const store = new MemoryKv();
  const diagnosticPayload = payload({
    hasDiagnostics: true,
    diagnostics: "[APP_START] 启动完成",
    androidApi: 36,
    deviceManufacturer: "Example",
    deviceModel: "Model",
    abi: "arm64-v8a",
  });

  const response = await handleReportPost({ env: environment(store), request: request(diagnosticPayload) });
  assert.equal(response.status, 201);
  const reportKey = `report:${REPORT_ID}`;
  const diagnosticKey = `diagnostic:${REPORT_ID}`;
  assert.ok(store.values.has(reportKey));
  assert.ok(store.values.has(diagnosticKey));
  assert.equal(store.options.get(reportKey).expirationTtl, 90 * 24 * 60 * 60);
  assert.equal(store.options.get(diagnosticKey).expirationTtl, 30 * 24 * 60 * 60);
});

test("同一来源每小时超过基础额度后返回 429", async () => {
  const store = new MemoryKv();
  for (let index = 0; index < 6; index += 1) {
    const id = `123e4567-e89b-42d3-a456-42661417400${index}`;
    const response = await handleReportPost({
      env: environment(store),
      request: request(payload({ reportId: id }), { "X-TimeDrops-Report-Id": id }),
    });
    assert.equal(response.status, 201);
  }

  const limitedId = "123e4567-e89b-42d3-a456-426614174009";
  const limited = await handleReportPost({
    env: environment(store),
    request: request(payload({ reportId: limitedId }), { "X-TimeDrops-Report-Id": limitedId }),
  });
  assert.equal(limited.status, 429);
});

test("缺少 KV 绑定时失败关闭，其他方法返回 405", async () => {
  const unavailable = await handleReportPost({ env: {}, request: request(payload()) });
  assert.equal(unavailable.status, 503);
  const wrongMethod = await onRequest({
    env: environment(new MemoryKv()),
    request: new Request("https://timedrops.example/api/reports", { method: "GET" }),
  });
  assert.equal(wrongMethod.status, 405);
});
