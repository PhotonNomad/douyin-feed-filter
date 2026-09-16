# 抖音视频屏蔽

抖音网页版（PC）推荐流过滤扩展。按 **BGM / 博主 / 标签** 屏蔽内容，过滤发生在数据层：
命中规则的视频在抖音 feed 接口返回给页面之前就被移除，页面体验接近「这个视频没有出现过」。

当前版本：**0.5.19**（Chrome MV3，需要 Chrome / Edge 111+）

## 目录结构

```text
wo/
├── outputs/
│   ├── douyin-bgm-filter-extension/        # 主扩展源码（Chrome 加载的就是这个目录）
│   ├── douyin-video-block-noui-extension/  # 诊断版：只做数据层过滤，不显示页面按钮
│   ├── douyin-bgm-filter-extension.zip     # 打包产物（由 scripts/build.ps1 生成，不入库）
│   └── douyin-video-block-noui-extension.zip
├── work/                                   # 开发过程中的临时脚本（打补丁 / 抓数据 / 验证用）
├── docs/
│   └── handoff.md                          # 对话压缩 + 项目交接（换会话前先读这个）
├── scripts/
│   └── build.ps1                           # 打包扩成为可分发 zip
├── CHANGELOG.md
└── README.md
```

> 主扩展目录路径被 Chrome 的「加载已解压的扩展程序」直接引用，**移动或改名会导致已加载的扩展失效**，需要重新加载。所以源码一直留在 `outputs/` 下。

## 安装（开发者模式）

1. 打开 `chrome://extensions/`（Edge：`edge://extensions/`）。
2. 打开右上角「开发者模式」。
3. 点「加载已解压的扩展程序」，选择 `outputs/douyin-bgm-filter-extension`。
4. 打开 <https://www.douyin.com/>，点工具栏扩展图标管理屏蔽规则。

改完代码后：在扩展管理页点该扩展的「刷新」按钮，然后 **完全刷新** 抖音页面（旧页面里的 content script 连着失效的扩展上下文）。

## 打包

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

默认输出 `outputs/douyin-bgm-filter-extension.zip`，也可用 `-Source` / `-Output` 指定其它扩展或输出路径。

## 自己复现问题并抓错误（自动调试）

`work/cdp-debug.js` 用 Chrome DevTools Protocol 驱动一个**独立浏览器**（独立临时配置目录，和日常浏览互不影响）加载本扩展、打开指定页面，并生成一份报告：控制台报错、未捕获异常、失败请求、长任务（卡顿毫秒数）、按钮与面板状态、面板实际内容。

```powershell
node work/cdp-debug.js --chrome="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --url="https://www.douyin.com/jingxuan?modal_id=7684253090765180179" --seconds=15 --click
```

- 报告与原始事件写到 `work/logs/<时间戳>/`（`report.md` + `events.json`）。
- `--probe=ssr` 看页面里 SSR 数据的真实结构；`--probe=decode` 看百分号解码后的内容；`--probe=flow` 点击按钮并把扩展内部来回传递的消息全部录下来；`--probe=isolated` 直接在页面里跑扩展当前的解析函数。
- **Chrome 153 起官方版已忽略 `--load-extension`**（日志里会写 `--disable-extensions-except is not allowed in Google Chrome`），所以默认用 Edge；其它 Chromium 用 `--chrome=` 指定。

## 设计原则

这些是用户明确要求、后续维护不能违反的约束：

- 过滤只在**数据层**（`fetch` / `XHR` 响应改写）完成，不改页面显示逻辑。
- 不自动发送下滑，不合成滑动事件，不隐藏预加载视频，不修改视频卡片 DOM。
- 一批推荐全部命中规则时，返回空列表但保留原来的 `cursor` / `has_more`，由抖音原版分页逻辑继续；必要时扩展预取下一批，多次失败则回退原始数据，优先保证页面可用。
- 直播不参与识别与屏蔽；普通视频作者正在直播时仍按普通视频识别。
- 卡片与数据无法确认对应关系时，不用预加载的下一条视频数据兜底。
- 黑名单只存浏览器本地，不上传任何数据。

## 文档

- 交接与对话压缩：[docs/handoff.md](docs/handoff.md)
- 版本历史：[CHANGELOG.md](CHANGELOG.md)
- 隐私说明：`outputs/douyin-bgm-filter-extension/PRIVACY.md`
- 主扩展使用说明：`outputs/douyin-bgm-filter-extension/README.md`
