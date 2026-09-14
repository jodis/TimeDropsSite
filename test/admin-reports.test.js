import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { authenticateAccessRequest, clearAccessCertificateCacheForTest } from "../functions/_shared/access.js";
import { deleteReport, getReport, listReports } from "../functions/api/admin/reports.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const REPORT_ID = "123e4567-e89b-42d3-a456-426614174000";

class MemoryKv {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }
  async get(key) { return this.values.get(key) ?? null; }
  async delete(key) { this.values.delete(key); }
  async list({ prefix, limit }) {
    const keys = [...this.values.keys()].filter((key) => key.startsWith(prefix)).slice(0, limit);
    return { keys: keys.map((name) => ({ name })), list_complete: true };
  }
}

function report(overrides = {}) {
  return {
    reportId: REPORT_ID,
    category: "suggestion",
    message: "希望增加批量操作。",
    contactEmail: "tester@example.test",
    appVersion: "1.0",
    versionCode: 1,
    hasDiagnostics: true,
    createdAt: "2026-09-13T10:00:00.000Z",
    expiresAt: "2026-12-12T10:00:00.000Z",
    ...overrides,
  };
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function accessFixture(email = "owner@example.test") {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  const teamDomain = "https://timedrops-test.cloudflareaccess.com";
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: "test-key" }));
  const claims = base64Url(JSON.stringify({
    iss: teamDomain,
    aud: ["test-audience"],
    email,
    exp: Math.floor(Date.now() / 1000) + 300,
  }));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return {
    token: `${header}.${claims}.${Buffer.from(signature).toString("base64url")}`,
    env: {
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: "test-audience",
      SUPPORT_ADMIN_EMAILS: email,
    },
    fetcher: async () => new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 }),
  };
}

test("Cloudflare Access JWT 验签并限制管理员邮箱", async () => {
  clearAccessCertificateCacheForTest();
  const fixture = await accessFixture();
  const request = new Request("https://timedrops.example/api/admin/reports", {
    headers: { "Cf-Access-Jwt-Assertion": fixture.token },
  });
  const authenticated = await authenticateAccessRequest(request, fixture.env, fixture.fetcher);
  assert.equal(authenticated.email, "owner@example.test");

  const denied = await authenticateAccessRequest(request, {
    ...fixture.env,
    SUPPORT_ADMIN_EMAILS: "different@example.test",
  }, fixture.fetcher);
  assert.equal(denied.response.status, 403);
});

test("管理配置或 Access JWT 缺失时失败关闭", async () => {
  const missingConfig = await authenticateAccessRequest(new Request("https://timedrops.example"), {});
  assert.equal(missingConfig.response.status, 503);
  const missingToken = await authenticateAccessRequest(new Request("https://timedrops.example"), {
    CF_ACCESS_TEAM_DOMAIN: "https://timedrops-test.cloudflareaccess.com",
    CF_ACCESS_AUD: "audience",
    SUPPORT_ADMIN_EMAILS: "owner@example.test",
  });
  assert.equal(missingToken.response.status, 401);
});

test("管理接口列出详情、按需读取诊断并可同时删除", async () => {
  const store = new MemoryKv({
    [`report:${REPORT_ID}`]: JSON.stringify(report()),
    [`diagnostic:${REPORT_ID}`]: JSON.stringify({ reportId: REPORT_ID, diagnostics: "[APP_START] 启动" }),
  });
  const listResponse = await listReports(store, new Request("https://timedrops.example/api/admin/reports?limit=25"));
  const listPayload = await listResponse.json();
  assert.equal(listPayload.reports.length, 1);
  assert.equal(listPayload.reports[0].message, "希望增加批量操作。");
  assert.equal(listPayload.reports[0].contactEmail, "tester@example.test");

  const detailResponse = await getReport(store, new Request(`https://timedrops.example/api/admin/reports?id=${REPORT_ID}&includeDiagnostics=1`));
  const detailPayload = await detailResponse.json();
  assert.equal(detailPayload.report.contactEmail, "tester@example.test");
  assert.equal(detailPayload.diagnostic.diagnostics, "[APP_START] 启动");

  const deleteResponse = await deleteReport(store, new Request(`https://timedrops.example/api/admin/reports?id=${REPORT_ID}`, { method: "DELETE" }));
  assert.equal(deleteResponse.status, 200);
  assert.equal(await store.get(`report:${REPORT_ID}`), null);
  assert.equal(await store.get(`diagnostic:${REPORT_ID}`), null);
});
