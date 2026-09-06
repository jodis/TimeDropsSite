import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onRequestPost } from '../functions/api/recovery.js';

function request(payload, contentType = 'application/json') {
  return new Request('https://example.test/api/recovery', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: JSON.stringify(payload),
  });
}

test('恢复表单在脚本失效时禁止录入且不会通过 URL 提交密码', async () => {
  const html = await readFile(new URL('../recovery/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../recovery/recovery.js', import.meta.url), 'utf8');
  const headers = await readFile(new URL('../_headers', import.meta.url), 'utf8');
  assert.match(html, /<fieldset id="recovery-fields" disabled>/);
  assert.match(html, /<form id="recovery-form" method="post"/);
  assert.doesNotMatch(html, /name="(?:password|confirmation)"/);
  assert.doesNotMatch(script, /form\.hidden = true/);
  assert.match(script, /fields\.hidden = true;[\s\S]*密码已重置/);
  assert.match(headers, /\/recovery\/\*[\s\S]*connect-src 'self'/);
});

test('恢复接口缺少公开客户端配置时失败关闭', async () => {
  const response = await onRequestPost({ request: request({}), env: {} });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, code: 'service_unavailable' });
});

test('恢复接口把 Appwrite 项目配置错误与 token 无效安全区分', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ type: 'project_unknown', message: 'not returned to browser' }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
  try {
    const response = await onRequestPost({
      request: request({ userId: 'test-user', secret: 'test-secret', password: 'valid-password' }),
      env: { APPWRITE_ENDPOINT: 'https://appwrite.example/v1', APPWRITE_PROJECT_ID: 'wrong-project' },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, code: 'service_misconfigured' });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('恢复接口只向 Appwrite 转发合规的一次性凭据', async () => {
  const previousFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, options) => {
    forwarded = { url, options };
    return new Response('{}', { status: 200 });
  };
  try {
    const response = await onRequestPost({
      request: request({ userId: 'test-user', secret: 'test-secret', password: 'valid-password' }),
      env: { APPWRITE_ENDPOINT: 'https://appwrite.example/v1', APPWRITE_PROJECT_ID: 'public-project' },
    });
    assert.equal(response.status, 200);
    assert.equal(forwarded.url, 'https://appwrite.example/v1/account/recovery');
    assert.equal(forwarded.options.method, 'PUT');
    assert.equal(forwarded.options.headers['X-Appwrite-Project'], 'public-project');
    assert.deepEqual(JSON.parse(forwarded.options.body), {
      userId: 'test-user', secret: 'test-secret', password: 'valid-password',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
