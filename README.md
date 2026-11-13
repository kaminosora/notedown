# Notedown

**把散落的文字，收进一页纸里。**

一个 Android 本地笔记应用：导入 Markdown、HTML 与纯文本，合并成一篇可勾选、可划线、可长按拖动排序、也能直接编辑的笔记。没有账号，没有同步服务，内容只保存在设备上。

[![License: MIT](https://img.shields.io/badge/license-MIT-b65037.svg)](LICENSE)

<p align="center">
  <img src="docs/screenshots/library-mobile.png" width="32%" alt="Notedown 书架">
  <img src="docs/screenshots/note-mobile.png" width="32%" alt="Markdown 笔记阅读">
  <img src="docs/screenshots/drag-reorder-mobile.png" width="32%" alt="长按拖动排序">
</p>

## 功能

- **两种格式，一本笔记**：内置解析 Markdown（GFM）和 HTML，也支持 `.txt`。
- **多文件合并**：一次选择多个文件，导入为一篇笔记；之后还能继续追加文件。
- **三种编辑模式**：打开笔记右上角的铅笔按钮，即可选择
  - **富文本**：像 Typora 一样直接点选可见文字修改；支持标题、粗体、斜体、删除线、代码、链接、引用、列表、任务、表格、分割线、块操作及撤销重做。
  - **Markdown**：把当前笔记转换成 Markdown 源码编辑，支持预览及任务、表格、删除线、来源标签往返；复杂结构保留安全 HTML。
  - **HTML**：直接编辑安全 HTML。
- **勾选与划去**：任务列表勾选后自动划线；单独的划线模式可点按任意段落或列表项切换划去。
- **阅读态长按排序**：有序、无序列表都可以长按拖动，松手即保存。序号会随 DOM 顺序自动重排；编辑态通过块操作栏调整顺序。
- **丝滑拖拽**：拖拽幽灵跟随手指，其他条目使用 FLIP 位移动画；松手后回弹归位。
- **边缘自动滚动**：拖到屏幕上下边缘附近自动滚动。越靠近边缘越快，速度随距离连续变化，并显示边缘渐变提示。
- **本地优先**：笔记写入应用私有目录，无账号、无遥测；断网也能用。
- **可维护的极简架构**：Android 侧只有一个 Activity，界面使用原生 HTML/CSS/JS，不引入前端框架、数据库或 AndroidX。
- **安全 HTML**：所有导入、粘贴和编辑内容都会经过 DOMPurify 白名单净化，脚本、内联样式、事件属性、危险 URL 都会被移除。
- **浅色 / 深色 / 跟随系统**，偏好会持久保存。
- **顶部安全区适配**：按系统状态栏与前摄挖孔高度在原生层预留空间，并额外留出缓冲，吸顶按钮不会被消息栏遮挡。
- **折纸 N 图标**：深蓝紫底色，暖金与珊瑚色折面。
- **整理**：标题重命名、搜索、删除确认，以及 Markdown/HTML 预览。

## 技术栈

| 层 | 选型 |
| --- | --- |
| Android 容器 | Java 17，单个 `Activity` + `WebView`，无第三方 Android 依赖，无 AndroidX |
| 界面 | 原生 HTML / CSS / JavaScript；编辑内核通过 esbuild 离线打包，产物随仓库提供 |
| 富文本编辑 | ProseMirror 文档模型、事务、撤销和结构化命令；本地离线打包 |
| Markdown 解析 | [marked](https://github.com/markedjs/marked) 12（本地内置，MIT） |
| HTML → Markdown | [Turndown](https://github.com/mixmark-io/turndown) 7 + 自定义 GFM 与内容保真规则（本地内置，MIT） |
| HTML 净化 | [DOMPurify](https://github.com/cure53/DOMPurify) 3.4（本地内置，Apache-2.0 / MPL-2.0） |
| 存储 | 应用私有目录中的原子写入 JSON 文件（`AtomicFile`）；浏览器调试时回退到 `localStorage` |
| 构建 | Gradle 8.11.1 + Android Gradle Plugin 8.9.2，compileSdk 35 / minSdk 26 |

**为什么这样选？** 浏览器负责排版与输入法，ProseMirror 负责文档结构、选区和可撤销的编辑事务。Android 壳负责安全存储、系统文件选择器、键盘与系统栏布局、震动和返回键。编辑依赖随 APK 打包，运行时不访问 CDN；仍可直接用普通浏览器调试。

## 安装

到 [Releases](https://github.com/kaminosora/notedown/releases/latest) 下载 `notedown-*-debug.apk`，允许“安装未知应用”后安装即可。

- 支持 Android 8.0（API 26）及以上。
- Release APK 目前使用 Android debug 签名，适合侧载体验，不适合直接上架 Google Play。
- 发布覆盖升级包时，通过环境变量 `NOTEDOWN_DEBUG_KEYSTORE` 指向原有调试签名文件，再构建 `assembleDebug`；签名文件不进入 Git。普通开发构建继续使用本机默认调试签名。
- 应用不需要任何运行时权限。导入文件通过系统文件选择器（SAF）完成。

## 本地构建

要求：JDK 17、Android SDK Platform 35、Build-Tools 35.0.0。

```bash
git clone https://github.com/kaminosora/notedown.git
cd notedown
./gradlew :app:assembleDebug
# Windows: gradlew.bat :app:assembleDebug
```

APK 输出到 `app/build/outputs/apk/debug/app-debug.apk`。

如果 SDK 不在默认位置，创建不要提交的 `local.properties`：

```properties
sdk.dir=/path/to/Android/Sdk
```

## 只调试网页层

界面本身可以在桌面浏览器中运行：没有原生桥时会自动使用 `localStorage` 和普通文件选择器。

```bash
python -m http.server 8765 --directory app/src/main/assets/www
```

打开 <http://127.0.0.1:8765/>。这是调整样式和手势最快的方式。

## 自动化测试

浏览器端测试覆盖解析、HTML 净化、富文本直改、格式工具栏、三模式往返、任务、链接、导入合并、长按拖拽、FLIP 动画和自动滚动。

```bash
npm ci
npm test
```

测试会在空闲端口启动静态服务器，并启动无头 Chrome。找不到浏览器时，请设置 `CHROME_PATH`：

```bash
# Windows PowerShell
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run test:e2e
```

浏览器测试不依赖 Android SDK，使用与 APK 内完全相同的网页资源。`npm test` 会重新构建编辑器，并运行存储失败注入、存储失败界面重试、原有端到端测试和新增编辑器回归。

编辑内核源码在 `src/rich-editor.js`，修改后运行 `npm run build:editor`。产物 `app/src/main/assets/www/js/rich-editor.js` 和依赖许可证一并纳入版本管理；直接构建 APK 不需要 Node。

浏览器中的键盘可视区域、触控和中文合成输入模拟不能代替 Android 真机；验收步骤见 [docs/android-validation.md](docs/android-validation.md)。

## 编辑模式说明

<p align="center">
  <img src="docs/screenshots/editor-rich-mobile.png" width="45%" alt="富文本直接编辑">
  <img src="docs/screenshots/editor-markdown-mobile.png" width="45%" alt="Markdown 源码编辑">
</p>

- **富文本**：选中文字后点格式按钮；任务复选框可直接点选，Enter 延续任务、空任务 Enter 退出列表。标题、列表、引用、代码、粘贴、移动与删除都使用统一撤销记录；支持 Ctrl/Cmd+Z 与重做。
- **复杂内容操作**：点选代码、表格、分割线、图片所在块或列表项，再用“上移／下移／前插／后插／删块”。列表项在同级列表中移动；跨多个块的选区禁用单块操作，避免误删。表格支持新增／删除行列与整表删除。
- **手机光标与选区**：点第二条工具栏的“光标”或“选区”，拖动出现的手柄；靠近正文可视区域上下边缘会持续滚动。只移动正在拖动的端点，另一个端点滚出屏幕后保持原文档位置。再次点同一按钮退出。普通长按选择仍可使用系统手柄。
- **键盘避让**：键盘显隐时调整编辑器可视高度，输入时自动露出光标；标题、Markdown 和 HTML 源码也有避让处理。
- **Markdown**：打开时由当前安全 HTML 即时转换，保存时再由 marked 转回 HTML。任务、列表、表格、链接、删除线与来源标签可往返；代码语言、空行和缩进保留。合并单元格、复杂 HTML 或没有末尾换行的代码使用安全原始 HTML 表达，以免丢内容。
- **HTML**：适合精确控制标签结构；保存时会重新运行安全净化。
- 模式切换会先读取当前草稿，再转换到目标模式；点击“保存”才写入笔记。复杂的自定义 HTML（例如内联样式）在切换时会被规范化。

## 交互细节

- 笔记页右上角的 **铅笔按钮** 直接进入富文本编辑；也可以从 `⋯` 菜单选择“编辑笔记”。
- 富文本工具栏在手机上分为两条可横向滑动的操作栏，触控按钮至少 44px；格式命令保存文档选区，滑动工具栏不会误触格式。
- **阅读态长按** 列表项 360 ms 进入拖拽，位移不超过 9 px 前仍可正常滚动页面。
- **FLIP** 动画时长 185 ms，拖拽幽灵使用 `translate3d`，不触发布局抖动。
- **阅读态拖动自动滚动** 范围为视口高度的 18%，限制在 88–150 px 内；最大速度 20 px / 60 Hz 帧，越靠近边缘速度按幂函数增长。编辑态选区手柄使用正文滚动容器的可视边缘。
- 松手后 185 ms 内回弹到目标槽位，顺序写入存储；勾选与划线也即时保存。
- 划线模式退出方式：再次点右上角 **S**、点提示条中的“完成”，或按返回键。

## 导入规则与边界

| 格式 | 扩展名 |
| --- | --- |
| Markdown | `.md` `.markdown` `.mdown` `.mkd` |
| HTML | `.html` `.htm` `.xhtml` |
| 纯文本 | `.txt` `.text` |

- 单次最多 **20 个文件**；单文件最多 **1.5 MB**；单次合计最多 **6 MB**。
- 文本优先按 UTF-8 解码；非法 UTF-8 时自动按 GB18030 解码。带 BOM 的 UTF-8 / UTF-16 也能识别。
- 导入 HTML 仅保留语义标签和文本；样式表、脚本、事件属性会被移除。这是为了防 XSS，因为页面里存在原生文件桥。
- HTML/Markdown 中引用相对路径的本地图片不会被打包；`https://` 远程图片可以显示，`data:image/...` 内联图片也可显示。
- 长按拖动只在同一个列表（同一个 `<ul>` / `<ol>`）内排序；不跨列表搬移。
- 数据保存在应用私有目录 `files/notes.json`。应用自身不提供云同步或恢复服务；升级时请保留旧应用直接覆盖安装，不要依赖卸载后的系统恢复。

## 目录结构

```text
app/src/main/
├── AndroidManifest.xml
├── java/.../MainActivity.java   # WebView 壳、文件选择器、原生桥、主题与返回键
├── assets/www/
│   ├── index.html
│   ├── css/app.css
│   └── js/
│       ├── parser.js            # Markdown/HTML → 安全规范化 HTML
│       ├── export.js            # 安全 HTML → Markdown（含任务/来源标签）
│       ├── store.js             # 本地 JSON 存储
│       ├── drag.js              # 长按拖拽、FLIP、边缘自动滚动
│       ├── rich-editor.js       # 从 src/rich-editor.js 离线构建的编辑内核
│       ├── editor-mobile.js     # 键盘视口、光标避让、边缘滚动与选区保护
│       ├── app.js               # 界面、编辑模式与格式工具栏
│       └── vendor/              # marked + DOMPurify + Turndown（含许可证）
└── res/                         # 主题、图标
src/rich-editor.js              # 编辑内核源文件
scripts/build-editor.mjs        # 离线打包及许可证汇总
tests/e2e.mjs                   # 原有浏览器端到端测试
tests/editor.mjs                # 富文本、移动端与选区回归
tests/store.mjs                 # 存储失败注入
tests/storage-ui.mjs            # 保存失败后的界面与重试回归
tests/android.mjs               # MuMu Android 15 原生触摸与键盘验收（独立 QA 包）
```

### 笔记数据约定

界面内部使用安全的语义 HTML 保存，额外属性只有四个：

```html
<li data-task="true" data-checked="true">任务</li>
<p data-struck="true">手动划去的段落</p>
<div data-file="source.md"></div>
```

阅读控件由 `enhanceContent()` 重建，富文本控件由编辑模型的节点视图创建；保存时仅序列化文档内容，因此存储内容不依赖某个 UI 版本。代码语言另外保留安全的 `language-*` 类名。

## 故障排查

### 启动后立即闪退

1.0.0 在 Android 15 的部分模拟器（已验证 MuMu 12）上，因系统栏初始化早于窗口 DecorView 创建而崩溃。**1.0.1 已修复**，请安装 Releases 中的最新版。

如果安装最新版后仍闪退，请确认模拟器/设备安装了 **Android System WebView**。部分精简版模拟器移除了 WebView；本应用完全依赖它渲染 Markdown / HTML。可在系统设置 → 应用 → Android System WebView 中检查，或在 MuMu 设置中安装/启用 WebView。

### 顶部按钮被状态栏或前摄挖孔遮住

1.1.1 起，顶部安全区改为在原生布局层预留：使用系统状态栏、前摄挖孔的安全区高度，再额外增加 10dp 缓冲，WebView 整体从安全区下方开始渲染，因此吸顶按钮不会进入消息栏。如果仍有遮挡，请提供手机型号和截图，便于继续针对该机型调整。

## 已知限制

- 富文本编辑仍依赖浏览器输入法与原生选择能力；极复杂的 Office/网页粘贴结构会被简化为安全语义标签。自定义选区手柄提供可控的跨屏拖选路径；不同 Android/WebView/输入法组合仍需真机验收。
- 导入表格的标题在富文本中保留为只读内容，可切换 HTML 模式修改。
- 暂不支持图片附件、导出、云同步；长按拖拽也不会跨列表搬移。
- 自动滚动依赖浏览器 `requestAnimationFrame`；极低端设备上可能略有降帧。
- 使用 debug 签名，因此不能在 Play Store 直接发布；如需正式发布，请配置自己的 release keystore。

## License

代码以 [MIT License](LICENSE) 发布。第三方依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
