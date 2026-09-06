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
    if (upstream.ok) return response(200, { ok: true });

    // 只解析稳定错误类型用于区分部署配置与一次性 token；不记录或回传 Appwrite 响应正文。
    const upstreamError = await upstream.json().catch(() => null);
    const upstreamType = typeof upstreamError?.type === 'string' ? upstreamError.type : '';
    if (upstream.status >= 500 || upstream.status === 401 || upstream.status === 403 || upstreamType.includes('project')) {
      return response(503, { ok: false, code: 'service_misconfigured' });
    }
    if (upstreamType === 'general_argument_invalid') {
      return response(400, { ok: false, code: 'password_rejected' });
    }
    return response(400, { ok: false, code: 'invalid_or_expired_link' });
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
