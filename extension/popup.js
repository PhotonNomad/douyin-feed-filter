const DEFAULT_SETTINGS = {
  enabled: true,
  blocked: {}
};

let settings = structuredClone(DEFAULT_SETTINGS);

const enabledInput = document.getElementById("enabled");
const blockedList = document.getElementById("blockedList");
const blockedEmpty = document.getElementById("blockedEmpty");
const historyList = document.getElementById("historyList");
const historyEmpty = document.getElementById("historyEmpty");
const manualInput = document.getElementById("manualInput");
const manualType = document.getElementById("manualType");
const manualAdd = document.getElementById("manualAdd");
const clearBlocked = document.getElementById("clearBlocked");
const clearHistory = document.getElementById("clearHistory");

const MANUAL_PLACEHOLDERS = {
  music: "输入音乐 ID 或名称",
  author: "如：官方|旗舰 -招聘",
  tag: '如：穿搭 -广告 | "每日穿搭"'
};
const MANUAL_RULE_HINT =
  '空格表示同时包含，| 表示任一匹配，- 前缀表示整条规则排除，引号表示完全相同。例：穿搭 -广告 | "每日穿搭"';

function normalizedText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function kindLabel(kind) {
  if (kind === "author") return "博主";
  if (kind === "authorKeyword") return "博主匹配";
  if (kind === "tag") return "标签";
  if (kind === "tagKeyword") return "标签匹配";
  return "音乐";
}

function buildRule(kind, value) {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return null;

  if (kind === "music") {
    if (/^\d+$/.test(cleanValue)) {
      return {
        key: `music:${cleanValue}`,
        kind: "music",
        value: cleanValue,
        label: `音乐 ID ${cleanValue}`
      };
    }

    return {
      key: `title:${normalizedText(cleanValue)}`,
      kind: "music",
      value: cleanValue,
      label: `音乐 ${cleanValue}`
    };
  }

  // 博主和标签共用组合写法：空格=同时，| =任一，- =整条规则排除，引号=完全相等。
  return globalThis.DouyinFeedFilterRules?.buildExpressionRule(kind, cleanValue) || null;
}

function renderBlocked() {
  const blocked = Object.values(settings.blocked).sort(
    (a, b) => (b.addedAt || 0) - (a.addedAt || 0)
  );

  blockedEmpty.hidden = blocked.length > 0;

  const fragment = document.createDocumentFragment();
  for (const rule of blocked) {
    const item = document.createElement("div");
    item.className = "item";

    const text = document.createElement("div");
    text.className = "item-text";

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = rule.label || rule.value || "未知规则";

    const sub = document.createElement("div");
    sub.className = "item-sub";
    sub.textContent = kindLabel(rule.kind || "music");

    const action = document.createElement("button");
    action.className = "ghost small";
    action.textContent = "取消";
    action.addEventListener("click", () => unblockRule(rule.key));

    text.append(title, sub);
    item.append(text, action);
    fragment.appendChild(item);
  }

  blockedList.replaceChildren(fragment);
}

function render() {
  enabledInput.checked = Boolean(settings.enabled);
  renderBlocked();
}

function formatBlockedTime(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return "";
  return new Date(time).toLocaleString();
}

function openBlockedVideo(record) {
  if (!record?.awemeId) return;
  chrome.tabs.create({
    url: `https://www.douyin.com/video/${record.awemeId}`
  });
}

function renderHistory(history) {
  const records = Array.isArray(history) ? history : [];
  historyEmpty.hidden = records.length > 0;

  const fragment = document.createDocumentFragment();
  for (const record of records) {
    const item = document.createElement("div");
    item.className = "item";

    const text = document.createElement("div");
    text.className = "item-text";

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent =
      [record.author, record.videoTitle].filter(Boolean).join(" · ") ||
      record.author ||
      record.awemeId ||
      "未知视频";

    const sub = document.createElement("div");
    sub.className = "item-sub";
    sub.textContent = formatBlockedTime(record.blockedAt);

    if (record.awemeId) {
      item.classList.add("clickable");
      item.setAttribute("role", "link");
      item.tabIndex = 0;
      item.addEventListener("click", () => openBlockedVideo(record));
      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openBlockedVideo(record);
      });
    }

    text.append(title, sub);
    item.append(text);
    fragment.appendChild(item);
  }

  historyList.replaceChildren(fragment);
}

function blockRule(rule) {
  if (!rule) return;

  settings.blocked[rule.key] = {
    ...rule,
    addedAt: Date.now()
  };

  chrome.storage.local.set({ blocked: settings.blocked }, () => render());
}

function unblockRule(key) {
  if (!key) return;

  delete settings.blocked[key];
  chrome.storage.local.set({ blocked: settings.blocked }, () => render());
}

enabledInput.addEventListener("change", () => {
  settings.enabled = enabledInput.checked;
  chrome.storage.local.set({ enabled: settings.enabled });
});

function updateManualInput() {
  const kind = manualType.value || "music";
  manualInput.placeholder = MANUAL_PLACEHOLDERS[kind] || MANUAL_PLACEHOLDERS.music;
  manualInput.title = kind === "music" ? "" : MANUAL_RULE_HINT;
  manualInput.setCustomValidity("");
}

manualType.addEventListener("change", updateManualInput);
manualInput.addEventListener("input", () => manualInput.setCustomValidity(""));

manualAdd.addEventListener("click", () => {
  const value = manualInput.value.trim();
  if (!value) return;

  const kind = manualType.value || "music";
  const rule = buildRule(kind, value);
  if (!rule) {
    if (kind !== "music") {
      manualInput.setCustomValidity("规则写法不对。空格=同时包含，|=任一，-=整条规则排除，引号=完全相同。");
      manualInput.reportValidity();
    }
    return;
  }

  manualInput.setCustomValidity("");
  blockRule(rule);
  manualInput.value = "";
});

clearBlocked.addEventListener("click", () => {
  settings.blocked = {};
  chrome.storage.local.set({ blocked: {} }, () => render());
});

clearHistory.addEventListener("click", () => {
  chrome.storage.local.set({ blockedHistory: [] }, () => renderHistory([]));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // 诊断日志等频繁写入不需要重绘弹窗；只响应这里真正展示的键。
  if (changes.enabled || changes.blocked) loadSettings();
  if (changes.blockedHistory) loadHistory();
});

function loadSettings() {
  chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
    settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...items
    };

    if (!settings.blocked || typeof settings.blocked !== "object") {
      settings.blocked = {};
    }

    chrome.storage.local.remove("recent");
    render();
  });
}

function loadHistory() {
  chrome.storage.local.get({ blockedHistory: [] }, (items) => {
    renderHistory(items.blockedHistory);
  });
}

function load() {
  loadSettings();
  loadHistory();
}

updateManualInput();

// 先让背景和静态框架完成首帧绘制，再读取存储、创建列表节点。
// 记录多的时候，渲染不会挡住弹出窗口的第一帧。
requestAnimationFrame(() => requestAnimationFrame(load));

// 旧版本保存的按钮图标、图片和尺寸设置已不再使用，打开管理界面时顺手清掉。
try {
  chrome.storage.local.remove(["buttonIcon", "customImage", "buttonSize"], () => {});
} catch (_) {}
