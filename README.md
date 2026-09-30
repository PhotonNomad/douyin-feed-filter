# 抖音视频屏蔽

Chrome / Edge 扩展，按 **BGM、博主和标签** 过滤抖音网页版推荐内容。命中规则的视频在网络响应交给页面之前被移除；规则、屏蔽记录和诊断日志均保存在浏览器本地。

当前版本 **0.5.25**，需要 Chrome / Edge 111+。仅支持 PC 网页版，音乐识别依赖抖音返回的官方字段，不包含音频指纹识别；直播内容不参与过滤。

## 安装与使用

1. 打开 `chrome://extensions/` 或 `edge://extensions/`，开启开发者模式。
2. 点击「加载已解压的扩展程序」，选择仓库中的 `extension/`。使用发布 ZIP 时，先解压再选择解压目录。
3. 打开 [抖音网页版](https://www.douyin.com/)，点击视频右侧的屏蔽按钮，选择博主、标签或 BGM 并保存。
4. 点击浏览器工具栏的扩展图标，可手动添加或取消规则、查看屏蔽记录、调整按钮图片和大小，以及导出诊断日志。

保存规则时会发送一次抖音的「不感兴趣」快捷键反馈。过滤发生在数据层，不自动切换视频、不隐藏视频卡片。抖音接口或页面结构变化可能影响功能。

更新源码后，在扩展管理页重新加载扩展，再完全刷新抖音页面。此前加载 `outputs/douyin-bgm-filter-extension/` 的用户需重新选择 `extension/`。

## 项目结构

```text
extension/       可直接加载的正式扩展
tests/          数据层过滤和 SSR 解析回归测试
scripts/         打包与浏览器调试工具
outputs/         生成的发布 ZIP 与调试报告（不入库）
CHANGELOG.md     版本记录
```

## 开发与打包

无需安装 npm 依赖。使用 Node.js 22+ 运行测试，使用 Python 3 打包：

```sh
node --test tests/*.js
python3 scripts/build.py
```

默认生成 `outputs/douyin-feed-filter.zip`，ZIP 根目录包含 `manifest.json`。Windows 也可使用：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

需要浏览器调试时，使用支持加载未打包扩展的浏览器，并明确指定可执行文件：

```sh
node scripts/debug.js --chrome=/path/to/browser --url=https://www.douyin.com/ --click
```

调试报告保存在 `outputs/debug/`。该工具需要浏览器允许扩展加载和远程调试；登录由使用者在浏览器中完成。

隐私说明见 [extension/PRIVACY.md](extension/PRIVACY.md)。
