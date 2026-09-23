# TimeDrops 官网与支持接口部署说明

本目录是 `timedrops.544788.xyz` 的 Cloudflare Pages 内容源，GitHub 仓库为 `jodis/TimeDropsSite`。

## 部署状态（2026-09-22）

- 生产构建已包含 KV 绑定 `SUPPORT_REPORTS` 与加密 Secret `RATE_LIMIT_SALT`，接口已上线。
- 线上验证通过：首写 201、同编号重放 200 幂等、非法字段/非法 JSON 400、每 IP 每小时 6 次 429；勾选诊断样本、30 天 TTL、提前删除、Email Routing 和 `_headers` 安全响应头均已验证。
- Cloudflare Access 管理端已完成 Team Domain、Audience、管理员白名单、JWT 验签和删除链路验收；Webhook 保持可选。

## 组成

- 静态官网：根目录 HTML/CSS，无构建步骤。
- 公开账号删除入口：`/account-deletion.html`，无需登录，可通过客服邮箱发起申请。
- 在线反馈接口：Pages Function `POST /api/reports`。
- 反馈存储：Cloudflare Workers KV；普通反馈自动保留 90 天，诊断正文单独保存并自动保留 30 天。
- 私有反馈管理：`/admin/reports.html` + `/api/admin/reports`；必须由 Cloudflare Access 保护，函数内还会独立验证 Access JWT、Audience 和管理员邮箱白名单。
- 可选 Webhook：反馈持久化后只发送分类、报告短编号、时间、版本和是否含诊断，不发送反馈正文、设备字段或诊断内容；通知失败不影响用户已经成功提交的反馈。

## 首次配置在线反馈

1. 在 Cloudflare 创建专用 KV namespace，例如 `timedrops-support-reports`。
2. 打开 Pages 项目 `timedrops-site` → Settings → Functions → KV namespace bindings。
3. 为 **Production** 增加变量名 `SUPPORT_REPORTS`，绑定上一步的 namespace。Preview 环境应绑定独立测试 namespace，禁止复用生产反馈。
4. 在 Pages 生产环境添加加密 Secret `RATE_LIMIT_SALT`，值使用密码管理器生成的至少 32 字符随机串；Preview 使用不同值。不得写入仓库、构建日志或普通环境变量。
5. **完成绑定/Secret 后必须再触发一次全新部署**（再推一个 commit，或在 Cloudflare Pages 控制台点 Redeploy / Deploy to production）。Pages 会把绑定快照进某一次部署：部署之后补加的 KV 绑定不会生效，Function 会一直返回 `503 service_unavailable`。
6. 缺少 KV 绑定或限流 Secret 时接口固定返回 503，不会伪造提交成功；拿到 201/429 等真实业务码即证明绑定已生效。
6. 建议在 Cloudflare WAF 为 `/api/reports` 再配置按 IP 的速率限制。Function 内已有每 IP 每小时 6 次的基础限制，但 KV 计数是最终一致的，不能替代边缘 WAF。
7. 仅允许负责支持的人员访问该 namespace；不要把 KV 访问 Token、Cloudflare API Token 或导出数据写入仓库和日志。

## 配置私有反馈管理页

1. 在 Cloudflare Zero Trust → Access → Applications 创建一个 **Self-hosted** 应用；使用同一应用/Audience保护以下两个路径：
   - `timedrops.544788.xyz/admin/*`
   - `timedrops.544788.xyz/api/admin/*`
2. Access Policy 只允许负责支持的指定账号登录，不能使用 Everyone、Bypass 或公开策略。
3. 在 Pages Production 环境配置：
   - `CF_ACCESS_TEAM_DOMAIN`：Access Team Domain，例如 `https://<team>.cloudflareaccess.com`；
   - `CF_ACCESS_AUD`：上述 Access 应用的 Application Audience；
   - `SUPPORT_ADMIN_EMAILS`：允许查看反馈的账号邮箱，多个值以英文逗号分隔。
4. Preview 必须使用独立 Access 应用/Audience、管理员白名单和测试 KV；不得让 Preview 读取生产反馈。
5. 配置后重新部署，再访问 `/admin/reports.html`：未登录应先进入 Access 登录页，非白名单账号应被拒绝，白名单账号才能列出、按需查看诊断或删除反馈。
6. 管理页不是 Access 的替代品；即使函数内会再次验证 JWT，仍必须在 Cloudflare 边缘同时保护静态页和管理 API。

## 配置可选 Webhook 短通知

1. 在 Pages Production Secret 中配置 `SUPPORT_NOTIFICATION_WEBHOOK_URL`，必须为 HTTPS；不配置即完全关闭通知。
2. Webhook 需要 Bearer 鉴权时，再配置 Secret `SUPPORT_NOTIFICATION_WEBHOOK_TOKEN`。
3. 接收端固定接收 JSON 字段：`event`、`category`、`reportShortId`、`createdAt`、`appVersion`、`hasDiagnostics`。
4. 通知不包含用户正文或诊断；收到短编号后登录 Access 管理页查看完整内容。
5. Webhook 返回失败或网络不可用时，报告仍保留在 KV，客户端仍返回提交成功；不得因通知服务故障让用户重复提交。

## 发布

Pages 已连接 GitHub `main` 分支；推送后自动部署：

```bash
cd site
npm test
git add .
git commit -m "上线账号删除入口与在线反馈接口"
git push origin main
```

Cloudflare Pages 保持无构建配置，或使用 `echo "Skip build"`。Functions 会由 Pages 自动识别和部署。

## 上线验证

静态页面：

- `https://timedrops.544788.xyz/`
- `https://timedrops.544788.xyz/privacy.html`
- `https://timedrops.544788.xyz/terms.html`
- `https://timedrops.544788.xyz/account-deletion.html`
- `https://timedrops.544788.xyz/support.html`

接口检查使用一次性随机 UUID，不要提交真实诊断或个人信息：

```bash
REPORT_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
curl -i 'https://timedrops.544788.xyz/api/reports' \
  -H 'Content-Type: application/json' \
  -H "X-TimeDrops-Report-Id: $REPORT_ID" \
  --data "{\"reportId\":\"$REPORT_ID\",\"category\":\"other\",\"message\":\"上线连通性测试，可删除\",\"appVersion\":\"deployment-check\",\"versionCode\":1,\"hasDiagnostics\":false,\"diagnostics\":null}"
```

预期首次返回 `201`，同一编号重放返回 `200` 且 `duplicate=true`。随后在 KV 中删除该测试报告。还需验证错误 JSON、超长正文、错误分类、幂等和 429；测试不得使用生产用户数据。

正式 RC 通过环境变量注入：

```text
TIMEDROPS_SUPPORT_ENDPOINT=https://timedrops.544788.xyz/api/reports
TIMEDROPS_ACCOUNT_DELETION_URL=https://timedrops.544788.xyz/account-deletion.html
TIMEDROPS_SUPPORT_PAGE_URL=https://timedrops.544788.xyz/support.html
```

不要把这些构建值硬编码进新代码；继续由 `tools/release/run_rc.sh` 注入。

## 当前公开口径与发布前确认

| 项目 | 当前值 | 需要确认 |
|---|---|---|
| 发布主体 | 点滴时光工作室（TimeDrops Studio） | 与 Play 开发者资料和公开页面保持一致 |
| 联系邮箱 | support@544788.xyz | Email Routing 已完成收发验证 |
| 生效/更新日期 | 2026 年 10 月 1 日 | 隐私政策、条款和账号删除页已统一 |
| 在线反馈处理方 | Cloudflare Workers / Workers KV | 法律与跨境处理口径复核 |
| 反馈保留期 | 普通反馈 90 天；诊断正文 30 天 | 与 KV TTL 和隐私政策保持一致 |
| 账号删除时限 | 完成身份核验后通常 30 日内 | 法律复核并建立工单处理流程 |
| 目标受众 | 13 岁及以上，不专门面向 13 岁以下儿童 | Play 目标受众选择 13–15、16–17、18+ |

## 运维约定

- 每周查看 KV 中新增报告；处理记录不得复制到非受控文档。
- 只通过报告编号关联工单。回复或删除请求需要人工核验时，不要求用户提供密码、验证码、Session、密钥或身份证件照片。
- 普通报告和诊断记录分别使用 `report:<UUID>`、`diagnostic:<UUID>`；诊断记录可先到期，属于正常行为。
- 用户申请提前删除反馈时，核验报告短编号和大致时间后删除对应两条 key。
- 法律页面、保留期、接口处理方或 Feature Gate 变化时，同步更新隐私政策、Data Safety 草案和应用内文案。
- 忘记密码固定采用应用内邮箱验证码流程；不部署 Recovery App Link 或 `.well-known/assetlinks.json`。
