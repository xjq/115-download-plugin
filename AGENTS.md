# AGENTS.md — 115 磁力离线助手

Chrome/Edge 扩展（Manifest V3）：检测网页磁力链/ed2k 链接，一键提交 115 网盘离线下载。
纯本地实现，无后端、无埋点，凭浏览器中 115.com 的登录 Cookie 直连 115 官方接口。

## 核心数据流

```
页面 magnet/ed2k
  → content.js 检测（a[href] + TreeWalker 纯文本 + MutationObserver）
  → Shadow DOM 浮动按钮 / 面板
  → chrome.runtime.sendMessage {type:'ADD_TASKS'}
  → background.js：chrome.cookies 读登录态
      GET  https://115.com/?ct=offline&ac=space          → sign + time
      POST https://115.com/web/lixian/?ct=lixian&ac=add_task_url
           body: url / uid / sign / time [/ savepath]
  → 结果回传 content.js → Toast（成功 / 未登录 / 需安全验证）
```

115 接口无官方文档，行为逆向自 bluebabes/115 + 实测。errno 语义：`911`=需安全验证，
`99`=未登录，`error_msg` 含「已存在/重复」=任务已存在（按成功处理但标 `exists`）。
`sign`/`time` 有时效，每次提交前重新取；系统时间不准会导致签名校验失败。

## 文件职责

| 文件 | 说明 |
| --- | --- |
| `manifest.json` | MV3 清单；content script 注入所有 http/https，**排除 115.com** |
| `shared.js` | 链接解析/规范化，挂 `globalThis.Magnet115`；content 与 SW 共用 |
| `background.js` | Service Worker，唯一联网模块；登录态/签名/提交/右键菜单/通知 |
| `content.js` | 检测 + Shadow DOM UI（FAB/面板/Toast）；类名无前缀但全在 Shadow 内 |
| `popup.*` / `options.*` | 工具栏弹窗 / 设置页；设置存 `chrome.storage.sync` |
| `tools/pack.ps1` | 一键打包 CRX+ZIP |
| `tools/crx_id.py` | 解析 CRX3 公钥算扩展 ID |
| `tools/make_icons.py` | PIL 生成图标 |
| `test/test.html` | 检测样本页（预期 5 条） |
| `dist/` | 打包产物；`*.pem` 是私钥，**勿提交公开仓库** |

详细函数级说明见 README.md。

## 代码约定

- **无构建步骤**，纯原生 JS，ES5 风格（`var`/`function`，不用 import/export/箭头函数）。
  改完用 `node --check <file>` 验证语法。
- `shared.js` 必须同时能在 content script（window）和 Service Worker（self）跑：
  结尾用 `(typeof self !== 'undefined' ? self : globalThis)`，不要引用 `window`/`document`。
- UI 全部在 Shadow DOM（`mode:'open'`，便于 CDP 测试）；样式写在 `STYLE` 数组内联，
  不依赖外部 css 文件；`hidden` 属性必须配 `.x[hidden]{display:none}`（author 样式会覆盖 UA 的 `[hidden]`）。
- 批量提交逐条 `sleep(500)` 限速，避免触发 115 风控。
- 新增权限要克制：当前仅 `storage cookies contextMenus notifications` + host `*://*.115.com/*`。

## 开发与验证流程

1. 改代码 → `node --check` 每个改动的 JS。
2. 解析逻辑改动 → 用 Node 直接跑断言（注意先 `global.self = global` 再 require）：
   ```powershell
   node -e "global.self=global; require('./shared.js'); /* 断言 self.Magnet115.* */"
   ```
3. 浏览器端验证 → 见下「测试方法」。
4. 发布 → 改 `manifest.json` 的 `version` → `pwsh tools/pack.ps1` → 产物在 `dist/`。

## 测试方法（重要，踩过的坑）

起本地服务：`python -m http.server 8765 --directory .`，访问 `http://127.0.0.1:8765/test/test.html`。

- **不要相信 headless CLI `--screenshot` 的截图判断 UI 显隐。**
  实测 Edge headless 会把 Shadow DOM 里 `display:none` 的元素错误渲染进截图
  （DOM 状态是对的，截图是错的）。判断显隐一律查 DOM。
- **可靠的验证是 CDP**：启动浏览器带 `--remote-debugging-port=9333`，用 Node 连 WebSocket：
  - `Runtime.evaluate` 查 `document.querySelector('[data-magnet115]').shadowRoot` 的状态
    （`panel.hidden` / `getComputedStyle(...).display` / `querySelectorAll('.p-item').length`）
  - `Page.captureScreenshot` 拿实时截图（这个是准的）
  - 在 evaluate 里 `.click()` 可模拟交互（点 FAB 展开面板、点「离线」触发提交流程）
- 无登录态时提交应得到 Toast「未登录 115，请先登录后重试」+「去登录」按钮，这是预期行为。
- 测试一律用独立 `--user-data-dir=<临时目录>`，**不要碰用户日常浏览器 profile**。
- 清理测试浏览器实例时按 `CommandLine -like '*<临时目录名>*'` 精确匹配再 Stop-Process，
  避免误杀用户日常 Chrome。

## 平台限制（实测结论，勿重复试错）

- **Chrome 137+ 正式版禁用 `--load-extension`**（headless 与非 headless 都禁），
  `--enable-unsafe-extension-debugging` 也无效。未打包扩展只能开发者模式手动加载。
- **非 Web Store 的 CRX 在正式版 Chrome 装不上**（`CRX_REQUIRED_PROOF_MISSING`），
  拖拽/双击/命令行一律拒。已实测确认，与打包方式无关。
- Edge 的 headless 模式在 157 已损坏（`--dump-dom` 输出 0 字节）；Chrome 的 headless 正常。
  浏览器版本会变（记录时 151→157），不要硬编码版本假设，先探测。
- 想摆脱开发者模式只有两条路：上架 Web Store（$5+审核），或企业策略 + HTTPS 托管
  update manifest（副作用：Chrome 显示「由贵单位管理」，Forcelist 装的扩展无法自行卸载）。

## 打包（tools/pack.ps1 已处理，改动时勿破坏）

- `--pack-extension` **不会自动复用同名 .pem**，必须显式传 `--pack-extension-key`，否则 exit 22。
- 私钥**不能位于被打包目录内**，否则 Chrome 报错退出 → 脚本先把 pem 复制到 TEMP。
- 直接从项目根打包会把 `dist/ tools/ test/` 塞进 CRX → 脚本从干净 staging 目录打包。
- 输出 CRX 固定在「源目录同级」生成 `<目录名>.crx`，脚本再 Move 到 `dist/`。
- `dist/115-magnet-helper.pem` 决定扩展 ID（当前 `jieopcbolcojfpmkgjmijllnhlndniln`），
  丢失则 ID 变更、用户需重装。**不要删除或重新生成它。**

## 红线

- 不要删除/移动 `C:\Users\xjq\src\115download` 目录——用户 Chrome 从这里加载扩展，
  目录没了扩展立即失效。
- 不要提交 `dist/*.pem` 到任何公开仓库；不要泄露。
- 不要用 `Remove-Item -Recurse`（沙箱策略会拦截）；清理临时文件用 Move 到 TEMP 或单文件删除。
- 不要往 content script 加调试代码后忘记清理（曾遗留 debug overlay / beacon 监听）。
- `savepath` 设置项是实验性的，115 接口不一定支持自定义目录，不要当作可靠功能承诺。

## 环境备注

- PowerShell 7；`Set-Content -Encoding UTF8` 无 BOM。
- Python 版本/包不固定（曾 3.14 自带 PIL，后 3.10 需 `pip install pillow`，用清华镜像
  `-i https://pypi.tuna.tsinghua.edu.cn/simple`）。
- 访问国外站点走代理 `127.0.0.1:7897`；国内站点/PYPI 镜像直连更快。
- 用户日常浏览器是 Chrome（Default profile，约 23 个扩展）；判断「是否已安装本扩展」
  可读 `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Secure Preferences` 的
  `extensions.settings`，按 ID `jieopcbolcojfpmkgjmijllnhlndniln` 或 name 匹配。
