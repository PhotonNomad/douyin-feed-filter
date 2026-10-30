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

function normalizedText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function kindLabel(kind) {
  if (kind === "author") return "博主";
  if (kind === "tag") return "标签";
  if (kind === "tagKeyword") return "标签包含关键词";
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

  if (kind === "author") {
    return {
      key: `author:${normalizedText(cleanValue)}`,
      kind: "author",
      value: cleanValue,
      label: `博主 ${cleanValue}`
    };
  }

  if (kind === "tag" || kind === "tagKeyword") {
    const tag = cleanValue.replace(/^#+/, "").trim();
    if (!tag) return null;
    return {
      key: `${kind}:${normalizedText(tag)}`,
      kind,
      value: tag,
      label: kind === "tagKeyword" ? `标签包含 ${tag}` : `标签 #${tag}`
    };
  }

  return null;
}

function renderBlocked() {
  const blocked = Object.values(settings.blocked).sort(
    (a, b) => (b.addedAt || 0) - (a.addedAt || 0)
  );

  blockedList.textContent = "";
  blockedEmpty.hidden = blocked.length > 0;

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
    blockedList.appendChild(item);
  }
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
  historyList.textContent = "";
  historyEmpty.hidden = records.length > 0;

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
    historyList.appendChild(item);
  }
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

manualAdd.addEventListener("click", () => {
  const value = manualInput.value.trim();
  if (!value) return;

  const rule = buildRule(manualType.value || "music", value);
  if (!rule) return;
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
  load();
});

function load() {
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

  chrome.storage.local.get({ blockedHistory: [] }, (items) => {
    renderHistory(items.blockedHistory);
  });
}

load();

// 旧版本保存的按钮图标、图片和尺寸设置已不再使用，打开管理界面时顺手清掉。
try {
  chrome.storage.local.remove(["buttonIcon", "customImage", "buttonSize"], () => {});
} catch (_) {}
