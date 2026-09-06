const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

/**
 * 密码恢复代理不记录或存储 userId、secret、密码及 Appwrite 响应正文。
 * 通过 Pages 环境变量提供公开客户端配置，仓库和浏览器均不包含管理 API Key。
 */
export async function onRequestPost({ request, env }) {
  if (!env.APPWRITE_ENDPOINT || !env.APPWRITE_PROJECT_ID) {
    return response(503, { ok: false, code: 'service_unavailable' });
  }
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return response(415, { ok: false, code: 'invalid_request' });
  }

  const input = await request.json().catch(() => null);
  if (!isRecoveryPayload(input)) {
    return response(400, { ok: false, code: 'invalid_request' });
  }

  try {
    const upstream = await fetch(`${env.APPWRITE_ENDPOINT.replace(/\/$/, '')}/account/recovery`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': env.APPWRITE_PROJECT_ID,
      },
      body: JSON.stringify({
        userId: input.userId,
        secret: input.secret,
        password: input.password,
      }),
    });
    // 一次性链接无效、过期、已使用及上游拒绝均返回同一结果，避免暴露恢复状态细节。
    return upstream.ok
      ? response(200, { ok: true })
      : response(400, { ok: false, code: 'invalid_or_expired_link' });
  } catch {
    return response(503, { ok: false, code: 'service_unavailable' });
  }
}

function isRecoveryPayload(value) {
  return value &&
    typeof value.userId === 'string' && inRange(value.userId.length, 1, 256) &&
    typeof value.secret === 'string' && inRange(value.secret.length, 1, 2048) &&
    typeof value.password === 'string' && inRange(value.password.length, 8, 256);
}

function inRange(length, min, max) {
  return length >= min && length <= max;
}

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
