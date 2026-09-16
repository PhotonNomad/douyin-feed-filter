const DEFAULT_SETTINGS = {
  enabled: true,
  blocked: {},
  buttonIcon: "not-interested",
  customImage: "",
  buttonSize: 40
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
const iconFile = document.getElementById("iconFile");
const iconPreview = document.getElementById("iconPreview");
const iconPreviewBox = document.getElementById("iconPreviewBox");
const iconPreviewText = document.getElementById("iconPreviewText");
const clearIcon = document.getElementById("clearIcon");
const buttonSize = document.getElementById("buttonSize");
const buttonSizeValue = document.getElementById("buttonSizeValue");

function normalizedText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function kindLabel(kind) {
  if (kind === "author") return "博主";
  if (kind === "tag") return "标签";
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

  if (kind === "tag") {
    const tag = cleanValue.replace(/^#/, "");
    return {
      key: `tag:${normalizedText(tag)}`,
      kind: "tag",
      value: tag,
      label: `标签 #${tag}`
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
  const hasCustomImage = Boolean(settings.customImage);
  iconPreview.src = settings.customImage || "";
  iconPreview.hidden = !hasCustomImage;
  iconPreviewText.hidden = hasCustomImage;
  iconPreviewText.textContent = hasCustomImage ? "" : "默认";
  clearIcon.disabled = !settings.customImage;
  buttonSize.value = String(settings.buttonSize || 40);
  buttonSizeValue.textContent = `${buttonSize.value}px`;
  renderBlocked();
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = dataUrl;
  });
}

async function resizeImageFile(file) {
  const dataUrl = await readAsDataUrl(file);
  const image = await loadImage(dataUrl);

  const maxSize = 64;
  const scale = maxSize / Math.max(image.width, image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/png");
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

iconPreviewBox.addEventListener("click", () => iconFile.click());
iconPreviewBox.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  iconFile.click();
});

iconFile.addEventListener("change", async () => {
  const file = iconFile.files?.[0];
  if (!file) return;

  try {
    const dataUrl = await resizeImageFile(file);
    settings.customImage = dataUrl;
    settings.buttonIcon = "custom";
    await chrome.storage.local.set({
      customImage: dataUrl,
      buttonIcon: "custom"
    });
    render();
  } catch (_) {
    // 这里不需要打断用户，预览和按钮会保持上一次状态。
  } finally {
    iconFile.value = "";
  }
});

clearIcon.addEventListener("click", () => {
  settings.customImage = "";
  settings.buttonIcon = "not-interested";
  chrome.storage.local.set({
    customImage: "",
    buttonIcon: "not-interested"
  });
  render();
});

buttonSize.addEventListener("input", () => {
  settings.buttonSize = Number(buttonSize.value);
  buttonSizeValue.textContent = `${buttonSize.value}px`;
  chrome.storage.local.set({ buttonSize: settings.buttonSize });
});

manualAdd.addEventListener("click", () => {
  const value = manualInput.value.trim();
  if (!value) return;

  const rule = buildRule(manualType.value || "music", value);
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
