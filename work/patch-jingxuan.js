const fs = require("fs");

const mainPath = "outputs/douyin-bgm-filter-extension/content-main.js";
const isolatedPath = "outputs/douyin-bgm-filter-extension/content-isolated.js";
let main = fs.readFileSync(mainPath, "utf8");
let isolated = fs.readFileSync(isolatedPath, "utf8");

function replaceBlock(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`Start not found: ${label}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`End not found: ${label}`);
  return text.slice(0, start) + replacement + text.slice(end);
}

const newMainHelpers = `  function decodeScriptText(text) {
    const raw = String(text || "");
    let decoded = raw;

    try {
      decoded = decodeURIComponent(raw);
    } catch (_) {
      decoded = raw.replace(/(?:%[0-9A-Fa-f]{2})+/g, (part) => {
        try {
          return decodeURIComponent(part);
        } catch (_) {
          return part;
        }
      });
    }

    return decoded
      .replace(/\\\\u([0-9a-fA-F]{4})/g, (_, code) =>
        String.fromCharCode(parseInt(code, 16))
      )
      .replace(/\\\\(["\\\\\\/bfnrt])/g, (match, char) => {
        if (char === "b") return "\\b";
        if (char === "f") return "\\f";
        if (char === "n") return "\\n";
        if (char === "r") return "\\r";
        if (char === "t") return "\\t";
        return char;
      });
  }

  function extractScriptString(text, key, fromIndex = 0) {
    const keyIndex = text.indexOf(\`"\${key}"\`, fromIndex);
    if (keyIndex < 0) return "";

    const colonIndex = text.indexOf(":", keyIndex + key.length + 2);
    if (colonIndex < 0) return "";

    const match = text
      .slice(colonIndex + 1, colonIndex + 12000)
      .match(/^"((?:\\\\.|[^"\\\\])*)"/);

    if (!match) return "";

    try {
      return JSON.parse(\`"\${match[1]}"\`) || "";
    } catch (_) {
      return match[1];
    }
  }

`;

main = replaceBlock(
  main,
  "  function normalizeScriptText(text) {",
  "  function extractSsrEntriesForAwemeId(awemeId) {",
  newMainHelpers,
  "main helpers"
);

const newMainSsr = `  function extractSsrEntriesForAwemeId(awemeId) {
    if (!awemeId) return [];

    const entries = [];

    for (const script of document.scripts) {
      const rawText = script.textContent || "";
      if (!rawText.includes("awemeId")) continue;

      const text = decodeScriptText(rawText);
      const regex = new RegExp(\`"awemeId"\\\\s*:\\\\s*"\${awemeId}"\`, "g");
      let match;

      while ((match = regex.exec(text)) !== null) {
        const start = match.index;
        const nextMatch = regex.exec(text);
        const end = nextMatch ? nextMatch.index : start + 140000;
        if (nextMatch) regex.lastIndex = nextMatch.index;

        const block = text.slice(start, end);
        const authorIndex = block.search(/"authorInfo"\\\\s*:/);
        if (authorIndex < 0) continue;

        const author = extractScriptString(block, "nickname", authorIndex);
        const authorId = extractScriptString(block, "uid", authorIndex);
        const musicIndex = block.search(/"music"\\\\s*:/);
        const musicId = extractScriptString(block, "mid", musicIndex);
        const musicTitle = extractScriptString(block, "title", musicIndex);
        const desc = extractScriptString(block, "desc", authorIndex);
        const itemTitle = extractScriptString(block, "itemTitle", authorIndex);
        const tags = extractTags({ desc });

        const entry = normalizeAwemeLike({
          aweme_id: awemeId,
          desc,
          text_extra: [],
          author: {
            nickname: author,
            uid: authorId,
            sec_uid: authorId
          },
          music: {
            id: musicId,
            title: musicTitle
          }
        });

        if (entry) {
          entry.videoTitle = itemTitle || desc;
          entry.tags = tags;
          if (!entries.some((item) => item.awemeId === entry.awemeId)) {
            entries.push(entry);
          }
        }
      }
    }

    ssrEntriesCache.set(awemeId, entries);
    return entries;
  }

`;

main = replaceBlock(
  main,
  "  function extractSsrEntriesForAwemeId(awemeId) {",
  "  window.addEventListener(\"message\", (event) => {",
  newMainSsr,
  "main SSR parser"
);

const newMainShould = `  function shouldParseUrl(url) {
    if (!url || noisyUrlPattern.test(url)) return false;
    return /\\/aweme\\/v1\\/web\\//i.test(url);
  }

`;

main = replaceBlock(
  main,
  "  function shouldParseUrl(url) {",
  "  function shouldParseContentType(contentType) {",
  newMainShould,
  "main parse scope"
);

const newMainRequest = `    if (data.type === "request-entry" && data.awemeId) {
      setTimeout(() => {
        const entries =
          ssrEntriesCache.get(data.awemeId) ||
          extractSsrEntriesForAwemeId(data.awemeId);
        for (const entry of entries) {
          postEntry(entry);
        }

        if (!entries.length) {
          try {
            window.postMessage(
              {
                source: MESSAGE_SOURCE,
                type: "entry-not-found",
                awemeId: data.awemeId
              },
              window.location.origin
            );
          } catch (_) {}
        }
      }, 0);
      return;
    }

`;

main = replaceBlock(
  main,
  '    if (data.type === "request-entry" && data.awemeId) {',
  '    if (data.type !== "settings") return;',
  newMainRequest,
  "main entry request"
);

const newIsolatedHelpers = `function decodeLocalScriptText(text) {
  const raw = String(text || "");
  let decoded = raw;

  try {
    decoded = decodeURIComponent(raw);
  } catch (_) {
    decoded = raw.replace(/(?:%[0-9A-Fa-f]{2})+/g, (part) => {
      try {
        return decodeURIComponent(part);
      } catch (_) {
        return part;
      }
    });
  }

  return decoded
    .replace(/\\\\u([0-9a-fA-F]{4})/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    )
    .replace(/\\\\(["\\\\\\/bfnrt])/g, (match, char) => {
      if (char === "b") return "\\b";
      if (char === "f") return "\\f";
      if (char === "n") return "\\n";
      if (char === "r") return "\\r";
      if (char === "t") return "\\t";
      return char;
    });
}

function extractLocalScriptString(text, key, fromIndex = 0) {
  const keyIndex = text.indexOf(\`"\${key}"\`, fromIndex);
  if (keyIndex < 0) return "";

  const colonIndex = text.indexOf(":", keyIndex + key.length + 2);
  if (colonIndex < 0) return "";

  const match = text
    .slice(colonIndex + 1, colonIndex + 12000)
    .match(/^"((?:\\\\.|[^"\\\\])*)"/);

  if (!match) return "";

  try {
    return JSON.parse(\`"\${match[1]}"\`) || "";
  } catch (_) {
    return match[1];
  }
}

`;

isolated = replaceBlock(
  isolated,
  "function normalizeLocalScriptText(text) {",
  "function extractTagsFromDescription(desc) {",
  newIsolatedHelpers,
  "isolated helpers"
);

const newIsolatedLocal = `function extractLocalSsrEntry(awemeId) {
  if (!awemeId) return null;

  for (const script of document.scripts) {
    const rawText = script.textContent || "";
    if (!rawText.includes("awemeId")) continue;

    const text = decodeLocalScriptText(rawText);
    const match = text.match(
      new RegExp(\`"awemeId"\\\\s*:\\\\s*"\${awemeId}"\`)
    );
    if (!match) continue;

    const startIndex = match.index;
    const block = text.slice(startIndex, startIndex + 140000);
    const authorIndex = block.search(/"authorInfo"\\\\s*:/);
    if (authorIndex < 0) continue;

    const author = extractLocalScriptString(block, "nickname", authorIndex);
    const authorId = extractLocalScriptString(block, "uid", authorIndex);
    const musicIndex = block.search(/"music"\\\\s*:/);
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

`;

isolated = replaceBlock(
  isolated,
  "function extractLocalSsrEntry(awemeId) {",
  "function requestEntryForActiveContainer() {",
  newIsolatedLocal,
  "isolated SSR parser"
);

const oldIsolatedListener = `    if (data.type === "entry" && data.entry) handleEntry(data.entry);
    if (data.type === "blocked" && data.record) saveBlockedRecord(data.record);`;
const newIsolatedListener = `    if (data.type === "entry" && data.entry) handleEntry(data.entry);
    if (data.type === "entry-not-found" && data.awemeId) {
      requestedEntries.delete(data.awemeId);
    }
    if (data.type === "blocked" && data.record) saveBlockedRecord(data.record);`;
if (!isolated.includes(oldIsolatedListener)) throw new Error("isolated listener not found");
isolated = isolated.replace(oldIsolatedListener, newIsolatedListener);

const newLoadSettings = `  function loadSettings() {
    try {
      const storage = chrome?.storage?.local;
      if (!storage) return;

      storage.get(DEFAULT_SETTINGS, (items) => {
        if (chrome?.runtime?.lastError) return;

        settings = {
          ...structuredClone(DEFAULT_SETTINGS),
          ...items
        };

        if (!settings.blocked || typeof settings.blocked !== "object") {
          settings.blocked = {};
        }

        try {
          storage.remove("recent", () => {});
        } catch (_) {}

        renderToolbarButtonIcon();
        applyToolbarButtonMetrics();
        postSettingsToMain();
        updateToolbarPosition();
      });
    } catch (_) {}
  }

`;

isolated = replaceBlock(
  isolated,
  "  function loadSettings() {",
  "  function saveBlockedRecord(record) {",
  newLoadSettings,
  "safe loadSettings"
);

isolated = replaceBlock(
  isolated,
  "  chrome.storage.onChanged.addListener((changes, area) => {",
  "  const observer = new MutationObserver(() => {",
  `  try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.blockedHistory) {
      blockedHistory = Array.isArray(changes.blockedHistory.newValue)
        ? changes.blockedHistory.newValue
        : [];
      blockedHistoryLoaded = true;
    }
    loadSettings();
  });
  } catch (_) {}

`,
  "safe storage listener"
);

fs.writeFileSync(mainPath, main);
fs.writeFileSync(isolatedPath, isolated);

console.log("patched", { main: main.length, isolated: isolated.length });

