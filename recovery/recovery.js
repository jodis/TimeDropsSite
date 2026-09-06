(() => {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get('userId');
  const secret = params.get('secret');
  // 一次性凭据只存在当前页面内存；尽早清除地址栏，避免复制、历史记录和 Referer 泄露。
  window.history.replaceState(null, '', '/recovery/');

  const form = document.querySelector('#recovery-form');
  const fields = document.querySelector('#recovery-fields');
  const password = document.querySelector('#new-password');
  const confirmation = document.querySelector('#confirm-password');
  const submit = document.querySelector('#recovery-submit');
  const status = document.querySelector('#recovery-status');
  const passwordToggles = document.querySelectorAll('.password-toggle');

  const showStatus = (message) => {
    status.textContent = message;
    status.hidden = false;
  };

  if (!userId || !secret) {
    fields.hidden = true;
    showStatus('恢复链接无效、已过期或已使用。请回到 TimeDrops 重新发送，并只打开最新一封邮件中的链接。');
    return;
  }

  // 只有脚本成功运行且链接参数完整时才允许录入密码，避免脚本失效时回退为原生表单提交。
  fields.disabled = false;
  status.hidden = true;
  passwordToggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const input = document.querySelector(`#${toggle.dataset.target}`);
      if (!input) return;
      const willShow = input.type === 'password';
      input.type = willShow ? 'text' : 'password';
      toggle.textContent = willShow ? '隐藏' : '显示';
      toggle.setAttribute('aria-pressed', String(willShow));
      toggle.setAttribute('aria-label', `${willShow ? '隐藏' : '显示'}${input.id === 'new-password' ? '新密码' : '确认密码'}`);
    });
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const newPassword = password.value;
    if (newPassword.length < 8 || newPassword.length > 256) {
      showStatus('密码长度需为 8 至 256 个字符。');
      return;
    }
    if (newPassword !== confirmation.value) {
      showStatus('两次输入的密码不一致。');
      return;
    }

    submit.disabled = true;
    showStatus('正在重置密码…');
    try {
      const response = await fetch('/api/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ userId, secret, password: newPassword }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.ok) {
        password.value = '';
        confirmation.value = '';
        fields.hidden = true;
        showStatus('密码已重置。请返回 TimeDrops，使用新密码登录。');
      } else if (body?.code === 'invalid_or_expired_link') {
        showStatus('恢复链接无效、已过期或已使用。请回到 TimeDrops 重新发送，并只打开最新一封邮件中的链接。');
        submit.disabled = false;
      } else if (body?.code === 'password_rejected') {
        showStatus('新密码不符合服务要求，请更换密码后重试。');
        submit.disabled = false;
      } else {
        showStatus('恢复服务配置异常或暂时不可用，请稍后重试。');
        submit.disabled = false;
      }
    } catch {
      showStatus('网络连接失败，请检查网络后重试。');
      submit.disabled = false;
    }
  });
})();
