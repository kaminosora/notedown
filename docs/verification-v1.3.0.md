# Notedown 1.3.0 验证记录

日期：2026-11-14。基于社区 PR #1 合并后的 `ed5f645` 继续开发；版本号 1.3.0，Android versionCode 6。

## 改动与兼容

- 表格外侧长按行／列柄排序；长按单元格交换内容，松手提交一次可撤销事务。表头位置保持其结构语义；合并格可交换内容，含合并格的表格暂不支持整行／列排序。
- 本地 KaTeX 0.19.1 解析常见 LaTeX；独立公式工具栏可隐藏。富文本公式以源码保存，支持编辑、删除、撤销及 Markdown／HTML 往返。不能可靠表示的公式保留规范 HTML，不丢失源码。
- 应用显示比例 60%–150%，即时预览、持久保存、取消复原。通过移动 WebView 视口缩放保持文档坐标一致，支持键盘与旋转后的布局；桌面浏览器使用自己的缩放设置。
- 保留合并贡献中的草稿退出保护、损坏数据恢复、启动快照及关闭系统备份行为；修复退出确认框在编辑器后面不可点击的问题。

## 网页与存储回归

环境：Windows、Node.js 24.20.0、Playwright Core 1.65.0、Chrome 157.0.8103.51。执行 `npm test`，包含离线构建和以下套件：

| 套件 | 检查内容 | 结果 |
| --- | --- | --- |
| store | 原子提交、存储故障、恢复、偏好归一化及显示比例保存 | 27 项通过 |
| e2e | 导入／编辑／阅读与未保存退出确认 | 6 组通过 |
| editor | 格式、块操作、撤销、键盘视口、选区固定端、工具栏遮挡 | 45 项通过 |
| storage-ui | 保存失败保留草稿、重试及恢复操作 | 8 项通过 |
| math | 分隔符、代码与货币排除、净化、源码往返、错误和复杂度边界 | 12 项通过 |
| table-drag | 行列重排、内容交换、撤销、取消、边缘滚动、合并格与标题保护 | 12 项通过 |
| math-ui | 第三行工具、模板、修改／删除／取消、离线字体、窄屏及键盘视口 | 8 项通过 |
| display | 真实移动 viewport 缩放、偏好、回滚、窄屏、旋转与缩放后的触摸操作 | 9 项通过 |

完整套件通过后，修正放大时普通页面宽度未收缩的问题；重新执行受影响的 e2e、editor、storage-ui、table-drag、math-ui、display 套件，全部通过。最终各套件共计 127 项／组检查。

显示测试使用 `isMobile: true` 的真实 Chromium viewport，覆盖 320px／412px、60%–150%，不是只修改 CSS 字号或伪造 `visualViewport`。编辑器测试还检查正文不从吸顶工具栏上方露出，跨屏选择时固定端不随滚动改变、界面文字不进入选区。

## MuMu Android 15

使用独立包 `io.github.kaminosora.notedown.qa`，与原应用数据隔离。设备环境：MuMu Player 12，Android 15 / API 35，WebView 110.0.5481.154.1，1440×2560。键盘测试临时使用 Fcitx5 Android 0.1.3 英语软键盘，使用 ADB 原生触摸点击软键与长按拖动。

| 配置 | 测试 | 结果 |
| --- | --- | --- |
| 360dpi，系统字体 100%，应用 100% | 标题／长文输入与键盘显隐、复杂内容操作、选区和光标手柄、横屏、模式往返、原生保存重开 | 9 组通过 |
| 360dpi，系统字体 100%，应用 100% | 原生行列拖动、单元格交换与撤销、公式软键输入、模式往返和保存 | 4 组通过 |
| 560dpi，系统字体 125%，应用 65% 等 | 缩放预览／保存／重启、原生表格拖动落点、长文和公式软键输入避让 | 3 组通过 |

同样的 1440px 物理宽度，560dpi 下默认逻辑宽度约 412px；实测 80% 时为 515px、65% 时约 633px。它接近原 360dpi 模拟器的 640px 内容宽度。该配置用于近似手机显示密度，**并非 Redmi K80 Pro 实体机验收，也未测得该手机当前实际 DPI**。系统字体 125% 与应用视口比例不是完全等价的字体换算。

复现前按对应配置准备设备与 QA 包；切换密度后重新启动测试输入法：

```powershell
./gradlew.bat -I tests/android-qa.init.gradle :app:assembleDebug
$env:ADB_PATH = '<adb.exe 路径>'
$env:ANDROID_SERIAL = '127.0.0.1:16384'
& $env:ADB_PATH -s $env:ANDROID_SERIAL install -r .tmp/qa-build/outputs/apk/debug/app-debug.apk
# 1440×2560、360dpi、字体 1.0、Fcitx5 英语软键盘
$env:ANDROID_TEST_OUTPUT = '.test-artifacts/v1.3.0/android/runtime'
npm run test:android
npm run test:android-features
# 1440×2560、560dpi、字体 1.25、Fcitx5 英语软键盘
npm run test:android-display
```

ADB 软键坐标依赖上述配置，不能直接用于任意手机。报告与截图保存在本地忽略目录 `.test-artifacts/v1.3.0/`；测试用笔记、原笔记备份和签名文件不进入 Git 或发行附件。

## 构建、安装与发布产物

- JDK 17.0.21+9、Android SDK Platform 35／Build-Tools 35.0.0、Gradle 8.11.1、AGP 8.9.2；`:app:assembleDebug :app:lintDebug` 成功。lint 为 0 错误、8 个提示，涉及既有返回键 API 声明、图标版本目录与合并贡献的 `allowBackup` 属性迁移建议。
- 发布包 `notedown-1.3.0-debug.apk`，1,265,435 字节。AAPT 确认包名 `io.github.kaminosora.notedown`、版本 1.3.0／6、minSdk 26／targetSdk 35。
- APK v2 签名验证通过，证书 SHA-256 为 `6a95f286029fe2274c879419fd2c43d5b27974e6cc32d02c505b634d3fb24a04`，与旧版一致；签名来自原工作区的 keystore，未修改原文件。
- 包内全部 88 个网页文件与工作区逐字节一致，包括 KaTeX 脚本、字体和许可证。
- 在 MuMu 原应用上执行 `adb install -r`，1.2.0 成功覆盖到 1.3.0，启动正常；升级前后原 `notes.json` 逐字节一致。
- 测试结束恢复原输入法、显示密度、字体与旋转设置，移除临时 QA 包和测试输入法；保留已升级的原应用。
- APK SHA-256：`a77b75cbb68d78b3cabb0051d36d2d6e6ec79018c6344ab1f1ef0657ecd71ad6`。发行附件提供对应校验文件。

## 验证边界

未覆盖 Redmi K80 Pro 实体机、其他 Android API／OEM WebView／输入法组合、浮动键盘与分屏。不同设备的字号与逻辑密度仍需按个人偏好调整。公式支持 KaTeX 的常见 LaTeX 数学语法，不提供完整 TeX 编译器或外部宏包运行环境。

相关实现依据：[Android WebView 视口配置](https://developer.android.com/develop/ui/views/layout/webapps/targeting)、[MDN viewport meta](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport)、[KaTeX 支持语法](https://katex.org/docs/supported.html)。
