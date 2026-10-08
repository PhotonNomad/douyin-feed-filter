# 贡献指南

欢迎提交问题报告与 Pull Request。修改前请先说明要解决的问题；涉及匹配规则或页面交互时，请提供具体示例。

## 开发环境

- Node.js 22 或更高版本，用于测试和浏览器调试工具。
- Python 3.9 或更高版本，用于打包；Windows 也可使用 PowerShell 打包脚本。
- 支持加载已解压扩展的 Chrome / Edge。

项目无需安装 npm 依赖。正式扩展源码位于 `extension/`。

## 项目结构

```text
extension/       扩展源码、图标和安装包使用说明
tests/           自动化回归测试
scripts/         打包和浏览器调试工具
output/          最新安装目录与 ZIP，由打包脚本生成
outputs/         本地调试产物
```

生成的安装包、调试报告、浏览器配置和本地备份不应提交到仓库。

## 测试

在仓库根目录运行：

```sh
node --test tests/*.js
git diff --check
```

修改过滤规则时，检查数据响应层与页面识别层的行为是否一致。标签关键词仅对标签做包含匹配，保留标签完全匹配；普通视频中的直播缩略图不应触发直播规则。

页面交互改动需重新加载扩展并在抖音页面验证。Pull Request 中应区分自动化测试、本地模拟页面测试和抖音实际页面测试，注明未验证的场景。

## 打包

在仓库根目录运行：

```sh
python3 scripts/build.py
```

Windows 可使用 `python scripts/build.py`，或运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

脚本覆盖 `output/` 中的扩展文件，并生成 `output/douyin-feed-filter.zip`。目录和 ZIP 根目录均直接包含 `manifest.json`，不创建按版本划分的子目录。扩展版本使用三段数字，定义在 `extension/manifest.json` 中。

开发时固定加载 `output/`。修改源码后重新打包，在扩展管理页点击「重新加载」，再刷新抖音页面。

## 浏览器调试

可选的调试工具会启动浏览器并记录扩展运行情况：

```sh
node scripts/debug.js --chrome=/path/to/browser --url=https://www.douyin.com/ --click
```

需要使用允许加载未打包扩展及远程调试的浏览器，登录由使用者完成。报告保存在 `outputs/debug/`；分享报告前请检查并移除私人信息。

## 提交改动

- 保持改动聚焦，并为行为变化补充适当的回归验证。
- 更新受影响的使用说明；面向用户的变化记入 `CHANGELOG.md` 的「未发布」部分。
- 描述问题、改动后的行为和验证结果，避免提交临时对比记录或本机路径。
- 使用自己已有的 Git 作者配置，不在脚本或命令中覆盖作者身份。
