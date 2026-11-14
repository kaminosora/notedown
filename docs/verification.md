# 编辑器修复验证记录

本文为 1.2.0 的历史验证记录；当前版本见 [1.3.1 验证记录](verification-v1.3.1.md)。

日期：2026-11-13。

## 改动范围

审阅了 Android 容器、网页界面、编辑/解析/导出/存储/阅读拖动代码、构建配置、资源、依赖许可与原有测试。`gradlew.bat` 与原提交的实际文件字节一致，Git 显示的行尾规范化差异不纳入本次改动。本文记录 1.2.0 发布产物的验证结果。

- `src/rich-editor.js` 使用 ProseMirror 模型与事务代替混合的 `execCommand` / DOM 修改。格式、列表、任务、链接、代码、表格、图片、块操作和粘贴拖入进入统一撤销记录。保持安全 HTML 存储格式。
- `app/src/main/assets/www/js/editor-mobile.js` 处理可视区域、输入光标避让、编辑滚动容器、自定义光标/选区手柄及越界选择保护。滚动本身不会修改选区；拖动只更新活动端，固定端使用文档位置。
- 移动工具栏改为两条横向滑动栏，按钮至少 44px。块操作和选择手柄在编辑正文之外，不能进入保存内容。
- 修复正文滚动时从吸顶工具栏上方露出的文本；412px 与 640px 宽度的专项回归通过。
- 修复代码语言、空行、缩进、多段任务和复杂表格的 Markdown 往返。无法精确表示的结构保留安全 HTML。
- 表格标题（`caption`）在富文本中只读，通过 HTML 模式编辑，避免误改后丢失；修复倒序有序列表分割时的编号。
- 存储写入成功后才提交内存状态；失败保留草稿或恢复已保存阅读内容，允许重试。
- Android 在根布局处理系统栏/IME 占位并将已处理的 insets 清零后下发；UTF-16 导入改为解码后检查 NUL。
- 更新应用图标为深蓝紫底的折纸 N，使用暖金与珊瑚色折面。

## 已执行检查

环境：Windows、Node.js 24.20.0、Playwright Core 1.65.0、Chrome 157.0.8103.51。

`npm test` 各套件通过；最后两项编辑器修复加入后，另完整复跑编辑器套件，45 项全部通过：

| 检查 | 结果 |
| --- | --- |
| 编辑器离线构建与许可证生成 | 通过 |
| 存储模块故障注入 | 13 项通过 |
| 原有端到端流程 | 5 组通过 |
| 编辑器及移动交互回归 | 45 项通过 |
| 存储失败 UI 回归 | 8 项通过 |

编辑回归包含全部原有格式工具、统一撤销/重做、多段任务及 Enter、单项列表转换、图片与分割线移动/删除、表格增删、粘贴净化、内部拖动、中文合成输入、富文本和源码键盘视口、正反向跨屏选区、双手柄与光标边缘滚动、触摸工具栏滑动、越界选区恢复及生命周期清理。新增回归覆盖 412px / 640px 工具栏遮挡、表格标题只读保护，以及倒序列表分割编号。

Android 最终构建使用 JDK 17.0.21、SDK Platform 35、Build-Tools 35.0.0、Gradle 8.11.1、AGP 8.9.2。`:app:assembleDebug :app:lintDebug` 成功，Java API 编译检查通过；lint 为 0 错误、7 个既有提示，涉及 API 33 返回回调注解/兼容声明和图标版本目录。报告位于 `app/build/reports/lint-results-debug.html`。

`git diff --check` 与脚本语法检查通过。浏览器截图位于 `.test-artifacts/editor-mobile.png`；命令输出位于 `.tmp/verification-web.log`、`.tmp/verification-editor-final.log` 和 `.tmp/android-release-build.log`。

## MuMu / Android 15 实测

环境为 MuMu Player 12、Android 15 / API 35、Android WebView 110.0.5481.154.1。键盘验收使用 Fcitx5 Android 0.1.3 的英语与拼音软键盘，通过实际点击软键输入。

- 最终 QA 包的原生集成 9 组全部通过：标题键盘避让、长文末尾软键输入、三轮键盘显隐、格式与复杂内容操作、自定义选区手柄与边缘滚动、正反向选区滚动保持、折叠光标手柄、横屏键盘，以及模式往返和原生保存重开。
- 额外通过拼音候选输入、换行与删除检查；中文未丢失或重复，编辑处位于键盘上方。
- 系统原生长按选词、拖动选择手柄和滚动检查通过；固定端保持原文档位置，随后滚动不改变正反向选区端点，也未选中正文以外的界面元素。
- 正式应用已从 1.1.1 覆盖升级到 1.2.0（versionCode 5）并成功启动。升级前后 `notes.json` 逐字节一致，原有 1 条笔记保留。
- 测试后已恢复原输入法与旋转设置，卸载临时 QA 应用和 Fcitx5；旧签名密钥、原笔记备份及私有数据未纳入 Git 或发布附件。

详细步骤与覆盖边界见 [android-validation.md](android-validation.md)。原生报告和截图位于本地忽略目录 `.test-artifacts/android15/`。

## 构建产物

- 1.2.0 发布 APK：`dist/notedown-1.2.0-debug.apk`，250263 字节。
- SHA-256：`67d628ead31883687e1a90af8abe80b3ff99767c16112b74e462d36cad7895e9`。
- APK 内 19 个网页资源逐文件与当前工作区字节一致。
- `apksigner` v2 签名验证通过，签名证书 SHA-256 为 `6a95f286029fe2274c879419fd2c43d5b27974e6cc32d02c505b634d3fb24a04`，与旧版 1.1.1 一致。已通过覆盖升级和原有笔记校验。
- 编辑器依赖和许可证已离线打包，APK 构建不依赖 npm，运行不依赖 CDN。

## 尚未验证

模拟器结果不能代替所有实体手机、其他 Android 版本、OEM WebView 与输入法组合的验证。浮动或分离式键盘、分屏、其他导航模式，以及系统文件选择器中的 UTF-16 导入尚未实测。系统原生选择手柄仍受 WebView 实现影响；应用提供的“光标／选区”手柄用于可控的跨屏拖选。

原生布局依据：[Android WebView window insets](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets)。编辑状态设计依据：[ProseMirror Guide](https://prosemirror.net/docs/guide/)。
