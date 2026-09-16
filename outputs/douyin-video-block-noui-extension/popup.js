const DEFAULT_SETTINGS = {
  enabled: true,
  blocked: {},
  buttonIcon: "not-interested",
  customIcon: "",
  buttonSize: 40
};

let settings = structuredClone(DEFAULT_SETTINGS);

const enabledInput = document.getElementById("enabled");
const blockedList = document.getElementById("blockedList");
const blockedEmpty = document.getElementById("blockedEmpty");
const manualInput = document.getElementById("manualInput");
const manualType = document.getElementById("manualType");
const manualAdd = document.getElementById("manualAdd");
const clearBlocked = document.getElementById("clearBlocked");
const buttonIcon = document.getElementById("buttonIcon");
const customIcon = document.getElementById("customIcon");
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
  buttonIcon.value = settings.buttonIcon || "not-interested";
  customIcon.value = settings.customIcon || "";
  customIcon.disabled = buttonIcon.value !== "custom";
  buttonSize.value = String(settings.buttonSize || 40);
  buttonSizeValue.textContent = `${buttonSize.value}px`;
  renderBlocked();
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

buttonIcon.addEventListener("change", () => {
  settings.buttonIcon = buttonIcon.value;
  customIcon.disabled = settings.buttonIcon !== "custom";
  chrome.storage.local.set({ buttonIcon: settings.buttonIcon });
});

customIcon.addEventListener("change", () => {
  settings.customIcon = Array.from(customIcon.value.trim()).slice(0, 2).join("");
  customIcon.value = settings.customIcon;
  chrome.storage.local.set({ customIcon: settings.customIcon });
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
}

load();
