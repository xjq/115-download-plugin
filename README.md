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
icons/          图标（tools/make_icons.py 可重新生成）
test/test.html  本地测试页（python -m http.server 后访问）
tools/pack.ps1  一键打包 CRX + ZIP
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
