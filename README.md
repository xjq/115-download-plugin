# 115 磁力离线助手

一个 Chrome / Edge 扩展：自动检测网页中的磁力链（magnet）与 ed2k 链接，一键提交到 115 网盘离线下载。纯本地实现，不经过任何第三方服务器。

参考了 [bluebabes/115](https://github.com/bluebabes/115) 的接口思路，但本扩展完全自包含、无埋点、无会员校验，凭浏览器中的 115 登录 Cookie 直接调用 115 官方离线接口。

## 功能

- **自动检测**：扫描页面中的 `magnet:` / `ed2k:` 链接（含未做成链接的纯文本磁力链）
- **浮动按钮**：检测到链接时右下角出现「115 离线」按钮，角标显示数量；单链接直接提交，多链接弹出列表选择
- **一键提交**：点击按钮 → 直接调用 115 离线接口 `add_task_url`，无需打开 115 页面
- **右键菜单**：选中文本（磁力/裸 SHA1 哈希）或右键链接直接离线
- **批量离线**：面板中可单条离线、全部离线、复制链接
- **登录检测**：自动读取 115.com Cookie 判断登录态，未登录时提示并提供登录入口
- **扫码获取 Token / Cookie**：在扩展页面里直接调 115 扫码接口，手机扫码后换取登录 Cookie（纯浏览器实现，不经过第三方服务器）；页面上的「自检二维码解码」用 jsQR 解码自己渲染的二维码，确认渲染没出错
- **错误处理**：任务已存在、需要安全验证（errno 911）、未登录（errno 99）等常见错误均有提示

## 安装

1. 把本项目放在一个固定目录（不要放在下载文件夹里随便删）。
2. 打开 `chrome://extensions/`（Edge 为 `edge://extensions/`）。
3. 打开右上角「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择本项目根目录。

> **加载一次即永久生效**：扩展会常驻浏览器，开机自动运行，不需要每次重新加载。
> 只有在你移动/删除了这个目录时才需要重装；改了代码则点扩展卡片上的「重新加载」⟳ 即可。

> 注：Chrome / Edge 正式版已禁用 `--load-extension` 命令行开关，未打包扩展只能通过上面的开发者模式加载。

## 打包与分发

一条命令同时产出 CRX 与 ZIP：

```powershell
pwsh tools/pack.ps1
```

产物在 `dist/`：

| 文件 | 用途 |
| --- | --- |
| `115-magnet-helper-v<版本>.zip` | 解压后「加载已解压的扩展程序」；也可直接上传 Chrome Web Store |
| `115-magnet-helper-v<版本>.crx` | 签名安装包（**正式版 Chrome 拒绝安装**，见下） |
| `115-magnet-helper.pem` | 私钥，决定扩展 ID 恒定不变。**勿丢失、勿提交到公开仓库** |

当前扩展 ID：`jieopcbolcojfpmkgjmijllnhlndniln`

打包脚本已绕开 Chrome 的三个坑：
1. `--pack-extension` 不会自动复用同名 `.pem`，必须显式传 `--pack-extension-key`（否则 exit 22）
2. 私钥不能位于被打包目录内，否则 Chrome 报错退出
3. 直接从项目根打包会把 `dist/`、`tools/`、`test/` 一起塞进 CRX；脚本改为从干净 staging 目录打包

### 关于 CRX：实测装不上

Chrome 157 正式版实测：用独立临时配置启动 Chrome 并传入签名 CRX，扩展**未被安装**
（该配置的 Secure Preferences 里只有 5 个 Chrome 内置组件扩展，没有本扩展的 ID）。
这是 Google 自 Chrome 33/75 起的反恶意软件策略——非 Web Store 来源的 CRX 缺少商店签名
证明（`CRX_REQUIRED_PROOF_MISSING`），拖拽 / 双击安装一律被拒。**与打包方式无关。**

三条可行路线对比：

| 路线 | 一键安装 | 自动更新 | 成本 | 副作用 |
| --- | --- | --- | --- | --- |
| 开发者模式加载目录（当前） | 手动一次 | 改完点 ⟳ | 0 | 启动时可能提示「停用开发者模式扩展」 |
| 上架 Chrome Web Store | ✅ | ✅ | $5 一次性 + 审核 | 扩展公开可见；调用第三方网盘接口有审核风险 |
| 企业策略 + HTTPS 托管 CRX | ✅ 静默 | ✅ | 需托管 update manifest（如 GitHub Pages） | Chrome 显示「由贵单位管理」；Forcelist 装的扩展无法自行卸载 |

自用场景下，开发者模式加载是标准做法，也是唯一免上架、免托管的方式。

## 使用

1. 先在浏览器中登录 [115 网盘网页版](https://115.com)（扩展只读取 115.com 的 Cookie，不上传任何数据）。
2. 打开任意含磁力链的页面，右下角出现「115 离线 N」按钮。
3. 点击按钮：
   - 只有 1 条链接 → 直接提交
   - 多条链接 → 弹出列表，可单条「离线」「复制」，或「全部离线」
4. 提交成功后可点提示条上的「查看任务」跳转到 115 离线任务页。

> 提示：在 URL 后加 `#115-show` 可强制展开链接列表面板。

## 扫码获取 Token / Cookie

工具栏弹窗或设置页点「扫码获取 Token / Cookie」，打开扩展内页面 `login.html`：

1. 选设备类型（默认 `web`，也可以 `android` / `mac` / `tv` …），点「获取二维码（Token）」
   - 页面下方会列出 token 的 `uid` / `time` / `sign` / `qrcode`，每项可单独复制，「复制 Token JSON」可整段复制
   - 实测：`web / android / ios / alipaymini / wechatmini / qandroid` 六个通道的 token 带 `qrcode` 链接；
     `mac / linux / windows / tv` 只返回 `uid / time / sign`（没有 `qrcode` 是正常的，二维码图片照常能出）
2. 用手机 115 App 扫码 → 在手机上确认
3. 点「开始等待扫码」，页面按 1 秒间隔轮询状态，确认后自动兑换 Cookie，可复制 / 下载

接口调用全部在页面里完成（`fetch` 直连 115 官方域名，`credentials:'omit'`，不覆盖浏览器里的登录态）。

| 步骤 | 请求 |
| --- | --- |
| 取 token | `GET https://qrcodeapi.115.com/api/1.0/web/1.0/token/` → `data.{uid,time,sign,qrcode}` |
| 取二维码图片 | `GET https://qrcodeapi.115.com/api/1.0/{app}/1.0/qrcode/?uid={uid}`（直接 `<img>` 加载） |
| 轮询状态 | `GET https://qrcodeapi.115.com/get/status/?uid&time&sign` → `data.status`：`0` 未扫 / `1` 已扫 / `2` 已确认 / `-1` 过期 / `-2` 取消 |
| 兑换 Cookie | `POST https://passportapi.115.com/app/1.0/{app}/1.0/login/qrcode/`，body `app={app}&account={uid}` |

注意事项：

- **二维码图片里的内容与 token 的 `qrcode` 字段只有域名不同**：解出来是 `https://yun.115.com/scan/dg-<uid>`，
  所以自检只比对末尾的 `/scan/dg-<uid>`。
- 用同一 app 类型扫码会把这个类型的旧设备踢下线（选 `web` 会让当前电脑的 115 网页登录失效），页面有提醒。
- **设备类型由页面选择决定，与用哪个手机 App 扫码无关**：选 `ios` 就得到被 115 认作「iOS」的 Cookie，
  手机上用 115 App 还是微信小程序扫都一样。登录成功后页面会额外显示 115 当前认的端信息
  （`ssoent` / `login_type` 等）以便核对。
- Cookie 只显示在页面上，**不写入 storage、不上传**；关闭页面即丢弃。日常使用离线功能不需要它。
- 自测（不需要真浏览器）：`node tools/test-login.js` —— 用假 DOM + 假 fetch 驱动 `login.js`，
  验证接口调用顺序、请求参数、状态机（未扫/已扫/确认/过期/取消）、结果渲染与诊断行。
- 出问题时看页面底部的「诊断」行（也会打到 Console）：会显示取 token、二维码图片加载、
  每次状态变化、兑换 Cookie 各步的耗时结果；点「扫码获取 Token / Cookie」没反应时，
  先确认扩展是否已「重新加载」，再看诊断行有没有 `页面已就绪`。

## 工作原理

```
content.js  →  检测页面 magnet/ed2k 链接，渲染浮动按钮与面板（Shadow DOM，防样式污染）
background.js →  Service Worker：
    1. chrome.cookies 读取 115.com 登录 Cookie（UID/CID/SEID）
    2. GET  https://115.com/?ct=offline&ac=space      获取 sign/time
    3. POST https://115.com/web/lixian/?ct=lixian&ac=add_task_url
       body: url=<磁力链>&uid=<UID>&sign=<sign>&time=<time>
```

- 提交通道为 115 官方网页版同款接口，需要浏览器保持 115 登录态
- 离线任务实际由 115 云端完成，本扩展只负责提交
- 批量提交时逐条限速 500ms，避免触发风控

## 文件结构

```
manifest.json     扩展清单（MV3）
shared.js        磁力/ed2k 解析与规范化（content 与 background 共用）
background.js    Service Worker：登录检测、签名获取、任务提交、右键菜单、通知
content.js       页面检测 + UI（浮动按钮/面板/Toast）
popup.html/js    工具栏弹窗：登录状态、重扫当前页、快捷入口
options.html/js 设置页：浮动按钮/文本检测/ed2k 开关、保存目录（实验性）
login.html/js    扫码获取 Token / Cookie（纯浏览器端调 115 扫码接口）
lib/jsQR.js      二维码解码（仅用于页面自检，MIT，jsQR 1.4.0）
icons/          图标（tools/make_icons.py 可重新生成）
test/test.html  本地测试页（python -m http.server 后访问）
tools/pack.ps1  一键打包 CRX + ZIP
tools/test-login.js  login.js 离线自测（node tools/test-login.js）
tools/crx_id.py 从 CRX3 解析公钥并计算扩展 ID
dist/           打包产物（.crx / .zip / .pem 私钥）
```

## 本地自测

```powershell
python -m http.server 8765 --directory .
# 浏览器打开 http://127.0.0.1:8765/test/test.html
# 预期：右下角出现「115 离线 5」浮动按钮，点击展开 5 条链接列表
```

## 常见问题

**提示未登录？**
扩展依赖浏览器中 115.com 的 Cookie。请先登录 115 网页版，如已登录仍提示，检查系统时间是否准确（签名与时间戳相关）。

**提交后提示需要安全验证？**
115 风控（errno 911）。点击提示条上的「去验证」，在打开的页面完成验证后重新提交即可。

**提示任务已存在？**
该磁力链已在你的 115 离线任务列表中，无需重复提交。

**设置里的保存目录没生效？**
`savepath` 为实验性参数（接口不一定支持自定义目录），留空使用 115 离线默认目录。

**file:// 页面不检测？**
Chrome 出于安全默认限制本地页面，可在扩展详情页开启「允许访问文件网址」。

## 隐私说明

- 不收集、不上传任何数据；无埋点、无统计、无后端
- 仅通过 `chrome.cookies` 读取 115.com 域的登录 Cookie（本地使用）
- 网络请求仅发往 115.com 官方域名

## 参考

- [bluebabes/115](https://github.com/bluebabes/115)：接口流程参考
- [SheltonZhu/115driver](https://github.com/SheltonZhu/115driver)：Cookie / 接口字段确认
