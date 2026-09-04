# TimeDrops 官网部署说明

本目录是 `timedrops.544788.xyz`（Cloudflare Pages）的内容源。

## 部署步骤

1. 本目录包含纯静态 HTML/CSS，无需构建。
2. 推送到 GitHub 仓库 `jodis/TimeDropsSite`：

```bash
cd site
git init
git add *.html *.css recovery
git commit -m "官网初始内容"
git branch -M main
git remote add origin https://github.com/jodis/TimeDropsSite.git
git push -u origin main --force
```

3. 在 Cloudflare Pages 项目（`timedrops-site`）中：
   - 生产分支：`main`
   - 构建命令：`echo "Skip build"`
   - 自定义域名：添加 `timedrops.544788.xyz`（Cloudflare 自动签发证书）

4. 验证：`https://timedrops.544788.xyz/` 及其下 `/privacy.html`、`/terms.html`、`/account-deletion.html`、`/support.html`、`/recovery/` 均可访问。

## 当前内容使用的默认值（发布前需逐项确认）

以下内容已按建议默认值写入页面，**上架前必须核对**，改完直接推新版本即可：

| 项目 | 当前值 | 需要确认 |
|---|---|---|
| 发布主体 | "TimeDrops（中国大陆个人开发者）" | 已定；如 Play 商店要求展示真实姓名再改（隐私/terms 页各一处） |
| 所在国家/地区 | 中国大陆（中华人民共和国），terms 第 11 节 + privacy 第 9 节已写明 | 已定 |
| 联系邮箱 | support@544788.xyz | **需在 Cloudflare Email Routing 建立该别名并转发到真实邮箱**，否则收不到邮件 |
| 生效/更新日期 | 2026 年 9 月 | 上架当天更新为具体日期 |
| 服务部署地区 | "以启用时页面说明为准" | Appwrite 实际部署地区确定后补写 |
| 反馈/诊断保留期 | 90 天 / 30 天 / 30 天 | 如与最终服务实现不一致，修改 |
| 儿童政策 | 不专门面向 13 岁以下 | 与 Play 目标受众设置一致 |

## 尚未发布、暂不放上去的内容

- `.well-known/assetlinks.json`（App Links）：需要最终 Play App Signing / Release 签名证书指纹后才能生成，届时加入 `recovery/` 相关路径。
- 在线反馈 API、账号/Recovery 功能：首发 AAB 中这些入口由 Feature Gate 关闭；页面只作"启用后"说明，不对外提供未部署的服务。

## 维护约定

- 法律页面改动：修改对应 HTML → 推 `main` → Pages 自动部署（分钟级）。
- 隐私政策与 `docs/PRIVACY_POLICY_DRAFT_CN.md`、Data Safety 披露保持逐项一致；功能矩阵变化时同步改 Data Safety。
- 不在这套页面中放任何需要登录才能查看的内容。
