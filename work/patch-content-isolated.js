const fs = require("fs");

const file = "outputs/douyin-bgm-filter-extension/content-isolated.js";
const source = fs.readFileSync(file, "utf8");
const start = source.indexOf("function handleEntry(entry) {");
const end = source.indexOf("function scheduleToolbarPosition() {", start);

if (start < 0 || end < 0) {
  throw new Error("Could not locate content-isolated patch range");
}

const replacement = `function handleEntry(entry) {
  if (!entry) return;
  if (!entry.awemeId && !entry.musicId && !entry.title && !entry.author) return;

  if (entry.awemeId) {
    knownEntries.set(entry.awemeId, entry);
  }

  updateToolbarPosition();
  if (toolbarPanel?.classList.contains("open")) {
    renderToolbarPanel();
  }
}

function normalizeLocalScriptText(text) {
  return String(text || "").replace(/\\\\\\\\+/g, "");
}

function extractLocalScriptString(text, key, fromIndex = 0) {
  const keyIndex = text.indexOf(\`"\${key}"\`, fromIndex);
  if (keyIndex < 0) return "";

  const colonIndex = text.indexOf(":", keyIndex + key.length + 2);
  if (colonIndex < 0) return "";

  const match = text
    .slice(colonIndex + 1, colonIndex + 6000)
    .match(/^"([^"\\\\\\\\]*(?:\\\\\\\\.[^"\\\\\\\\]*)*)"/);

  return match ? match[1] : "";
}

function extractTagsFromDescription(desc) {
  const tags = new Set();
  const matches = String(desc || "").match(/#([^#\\\\\\\\s]+)/g) || [];
  for (const match of matches) {
    const tag = match
      .slice(1)
      .replace(/^#+/, "")
      .replace(/[，。！？.,!?]+\$/, "");
    if (tag) tags.add(tag);
  }
  return Array.from(tags).slice(0, 30);
}

function extractLocalSsrEntry(awemeId) {
  if (!awemeId) return null;

  for (const script of document.scripts) {
    const rawText = script.textContent || "";
    if (!rawText.includes("awemeId")) continue;

    const text = normalizeLocalScriptText(rawText);
    const startIndex = text.indexOf(\`"awemeId":"\${awemeId}"\`);
    if (startIndex < 0) continue;

    const block = text.slice(startIndex, startIndex + 120000);
    const authorIndex = block.indexOf('"authorInfo"');
    if (authorIndex < 0) continue;

    const author = extractLocalScriptString(block, "nickname", authorIndex);
    const authorId = extractLocalScriptString(block, "uid", authorIndex);
    const musicIndex = block.indexOf('"music"', authorIndex);
    const musicId = extractLocalScriptString(block, "mid", musicIndex);
    const musicTitle = extractLocalScriptString(block, "title", musicIndex);
    const desc = extractLocalScriptString(block, "desc", authorIndex);
    const itemTitle = extractLocalScriptString(block, "itemTitle", authorIndex);
    const tags = extractTagsFromDescription(desc);

    if (!author && !musicId && !musicTitle && !desc) continue;

    return {
      awemeId,
      musicId,
      title: musicTitle,
      videoTitle: itemTitle || desc,
      musicAuthor: "",
      author,
      authorId,
      tags,
      seenAt: Date.now(),
      source: "douyin-web-ssr-fields"
    };
  }

  return null;
}

function requestEntryForActiveContainer() {
  let containerId = findContainerAwemeId(activeContainer);
  if (!containerId) {
    try {
      containerId =
        new URLSearchParams(window.location.search).get("modal_id") || "";
    } catch (_) {}
  }

  if (!containerId) return;
  if (knownEntries.has(containerId) || requestedEntries.has(containerId)) return;

  requestedEntries.add(containerId);

  const localEntry = extractLocalSsrEntry(containerId);
  if (localEntry) {
    handleEntry(localEntry);
    return;
  }

  try {
    window.postMessage(
      {
        source: ISOLATED_MESSAGE_SOURCE,
        type: "request-entry",
        awemeId: containerId
      },
      window.location.origin
    );
  } catch (_) {}
}

function findActionRailContainer(container) {
  const share = container?.querySelector('[data-e2e="video-player-share"]');
  if (!share) return null;

  const requiredSelectors = [
    '[data-e2e="video-player-digg"]',
    '[data-e2e="feed-comment-icon"]',
    '[data-e2e="video-player-collect"]',
    '[data-e2e="video-player-share"]'
  ];

  let node = share;
  while (node && node !== container) {
    if (requiredSelectors.every((selector) => node.querySelector(selector))) {
      return node;
    }
    node = node.parentElement;
  }

  return null;
}

function placeToolbarInActionRail(container) {
  const rail = findActionRailContainer(container);
  if (!rail) return false;

  if (toolbar.parentElement === rail) {
    return true;
  }

  const more = rail.querySelector('[data-e2e="video-play-more"]');
  const moreSlot =
    more && more.parentElement === rail ? more : null;

  toolbar.style.display = "flex";
  toolbar.style.position = "relative";
  toolbar.style.top = "";
  toolbar.style.left = "";
  toolbar.style.right = "";
  toolbar.style.width = "50px";
  toolbar.style.height = "auto";
  toolbar.style.margin = "6px 0 4px";
  toolbar.style.justifyContent = "center";
  toolbar.style.alignItems = "flex-start";

  if (moreSlot) {
    rail.insertBefore(toolbar, moreSlot);
  } else {
    rail.appendChild(toolbar);
  }

  return true;
}

function updateToolbarPosition() {
  if (!settings.enabled) {
    if (toolbar) toolbar.style.display = "none";
    return;
  }

  ensureToolbar();
  activeContainer = findActiveContainer();

  if (activeContainer !== lastToolbarContainer) {
    lastToolbarContainer = activeContainer;
    toolbarPanel?.classList.remove("open");
  }

  if (isLiveContainer(activeContainer)) {
    toolbar.style.display = "none";
    return;
  }

  if (!activeContainer) {
    toolbar.style.display = "none";
    return;
  }

  if (placeToolbarInActionRail(activeContainer)) {
    return;
  }

  const rect = activeContainer.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    toolbar.style.display = "none";
    return;
  }

  let targetRect = rect;
  const videos = activeContainer.querySelectorAll?.("video") || [];
  let largestVideo = null;
  let largestArea = 0;

  for (const video of videos) {
    const videoRect = video.getBoundingClientRect();
    const area = videoRect.width * videoRect.height;
    if (area > largestArea) {
      largestArea = area;
      largestVideo = videoRect;
    }
  }

  if (largestVideo?.width && largestVideo?.height) {
    targetRect = largestVideo;
  }

  toolbar.style.display = "block";
  toolbar.style.position = "fixed";
  toolbar.style.top = \`\${Math.max(10, targetRect.top + 10)}px\`;
  toolbar.style.left = "auto";
  toolbar.style.right = \`\${Math.max(10, window.innerWidth - targetRect.right + 10)}px\`;
  toolbar.style.width = "";
  toolbar.style.height = "";
  toolbar.style.margin = "";

  const spaceBelow = window.innerHeight - targetRect.bottom;
  toolbarPanel.classList.toggle(
    "above",
    spaceBelow < 320 && targetRect.top > 320
  );
}

`;

fs.writeFileSync(file, source.slice(0, start) + replacement + source.slice(end));
console.log("patched", file);
