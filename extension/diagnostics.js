// ---- 诊断日志 --------------------------------------------------------------

const DEBUG_LOG_KEY = "debugLog";
const exportLogButton = document.getElementById("exportLog");
const copyLogButton = document.getElementById("copyLog");
const clearLogButton = document.getElementById("clearLog");
const logStatus = document.getElementById("logStatus");

function padNumber(value, length = 2) {
  return String(value).padStart(length, "0");
}

function formatClock(timestamp) {
  const date = new Date(timestamp);
  return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(
    date.getSeconds()
  )}.${padNumber(date.getMilliseconds(), 3)}`;
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(
    date.getDate()
  )} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(
    date.getSeconds()
  )}`;
}

async function collectDiagnosticLog() {
  let events = [];
  let meta = null;
  let source = "本地存储";

  try {
    const stored = await chrome.storage.local.get({ [DEBUG_LOG_KEY]: [] });
    if (Array.isArray(stored[DEBUG_LOG_KEY])) events = stored[DEBUG_LOG_KEY];
  } catch (_) {}

  // 页面里的缓冲往往比存储里的更新，能取到就用它。
  // 先问当前标签页，再兜底遍历其它标签页（抖音页可能不在最前面）。
  try {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const allTabs = await chrome.tabs.query({});
    const orderedTabs = [...(activeTabs || []), ...(allTabs || [])];
    const visited = new Set();

    for (const tab of orderedTabs) {
      if (tab?.id === undefined || visited.has(tab.id)) continue;
      visited.add(tab.id);
      if (visited.size > 8) break;

      try {
        const dump = await chrome.tabs.sendMessage(tab.id, {
          type: "douyin-bgm-filter/dump-log"
        });

        if (dump?.events?.length) {
          events = dump.events;
          meta = dump.meta || null;
          source = "页面的实时记录";
          break;
        }
      } catch (_) {}
    }
  } catch (_) {}

  return { events, meta, source };
}

function buildDiagnosticReport({ events, meta, source }) {
  const manifest = chrome.runtime.getManifest();
  const lines = [
    "抖音视频屏蔽 · 诊断日志",
    `扩展版本：${manifest.version}`,
    `导出时间：${formatDateTime(Date.now())}`,
    `记录来源：${source}`,
    `当前页面：${meta?.url || "（没有取到，可能当前标签页不是抖音页面）"}`,
    `记录条数：${events.length}`,
    "",
    "说明：这份文件只包含扩展自身的运行记录（识别到的字段、过滤数量、错误信息），",
    "全部保存在本机，扩展不会上传任何数据。",
    "",
    "--- 记录 ---"
  ];

  if (!events.length) {
    lines.push("（暂无记录：先在抖音页面上操作一次，再导出。）");
  }

  for (const event of events) {
    const parts = [`[${formatClock(event.t)}]`, String(event.level || "info").padEnd(5)];
    parts.push(String(event.message || ""));
    if (event.page) parts.push(`· ${event.page}`);
    if (event.data !== undefined) parts.push(JSON.stringify(event.data));
    lines.push(parts.join(" "));
  }

  return lines.join("\n");
}

async function exportDiagnosticLog() {
  const collected = await collectDiagnosticLog();
  const report = buildDiagnosticReport(collected);
  const stamp = formatDateTime(Date.now()).replace(/[: ]/g, "-");
  const url = URL.createObjectURL(new Blob([report], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `douyin-bgm-filter-log-${stamp}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);

  logStatus.textContent = `已导出 ${collected.events.length} 条记录。`;
}

async function copyDiagnosticLog() {
  const collected = await collectDiagnosticLog();

  try {
    await navigator.clipboard.writeText(buildDiagnosticReport(collected));
    logStatus.textContent = `已复制 ${collected.events.length} 条记录。`;
  } catch (error) {
    logStatus.textContent = `复制失败：${error?.message || error}`;
  }
}

async function refreshLogStatus() {
  const { events } = await collectDiagnosticLog();
  logStatus.textContent = events.length ? `当前有 ${events.length} 条记录。` : "暂无记录。";
}

exportLogButton.addEventListener("click", () => {
  exportDiagnosticLog().catch((error) => {
    logStatus.textContent = `导出失败：${error?.message || error}`;
  });
});

copyLogButton.addEventListener("click", () => {
  copyDiagnosticLog().catch(() => {});
});

clearLogButton.addEventListener("click", async () => {
  // 页面里的缓冲也要一起清掉，否则下一次刷新又会被写回存储。
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      await chrome.tabs.sendMessage(tab.id, { type: "douyin-bgm-filter/clear-log" });
    }
  } catch (_) {}

  await chrome.storage.local.set({ [DEBUG_LOG_KEY]: [] });
  logStatus.textContent = "已清空本地日志。";
});

refreshLogStatus().catch(() => {});
