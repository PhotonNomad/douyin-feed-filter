(() => {
  if (window.__douyinBgmFilterMainInstalled) return;
  window.__douyinBgmFilterMainInstalled = true;

  const MESSAGE_SOURCE = "douyin-bgm-filter/main";
  const ISOLATED_MESSAGE_SOURCE = "douyin-bgm-filter/isolated";
  const MAX_BODY_BYTES = 8 * 1024 * 1024;
  const MAX_VISITED_NODES = 20000;
  const MAX_PREFETCH_FEED_PAGES = 5;

  let filterSettings = {
    enabled: true,
    blocked: {}
  };
  let settingsReadyResolve = null;
  const settingsReady = new Promise((resolve) => {
    settingsReadyResolve = resolve;
  });
  const ssrEntriesCache = new Map();

  async function waitForFilterSettings() {
    await Promise.race([
      settingsReady,
      new Promise((resolve) => setTimeout(resolve, 250))
    ]);
  }

  const noisyUrlPattern =
    /(report|monitor|telemetry|slardar|collect|log|tracking|beacon|metric)/i;

  function firstString(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return "";
  }

  function normalizedText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function extractTags(node) {
    const tags = new Set();
    const addTag = (value) => {
      const tag = String(value || "")
        .trim()
        .replace(/^#+/, "")
        .replace(/[，。！？.,!?]+$/, "");
      if (tag) tags.add(tag);
    };

    const arrays = [
      node.text_extra,
      node.textExtra,
      node.hashtag_list,
      node.hashtagList,
      node.hashtags,
      node.tags
    ];

    for (const list of arrays) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (typeof item === "string") {
          addTag(item);
        } else if (item && typeof item === "object") {
          addTag(
            item.hashtag_name ||
              item.hashtagName ||
              item.hashtag ||
              item.name ||
              item.title
          );
        }
      }
    }

    const desc = node.desc || node.description || "";
    if (typeof desc === "string") {
      const matches = desc.match(/#([^#\s]+)/g) || [];
      matches.forEach((match) => addTag(match.slice(1)));
    }

    return Array.from(tags).slice(0, 30);
  }

  function extractVideoAuthor(node) {
    const author = node.author || node.video_author || node.uploader;
    if (!author || typeof author !== "object") {
      return {
        nickname: "",
        id: ""
      };
    }

    return {
      nickname: firstString(
        author.nickname,
        author.unique_id,
        author.uniqueId,
        author.short_id,
        author.shortId,
        author.name,
        author.author
      ),
      id: firstString(
        author.sec_uid,
        author.secUid,
        author.uid,
        author.user_id,
        author.userId,
        author.unique_id,
        author.uniqueId
      )
    };
  }

  function isLiveNode(node) {
    if (!node || typeof node !== "object") return false;

    if (
      firstString(
        node.room_id,
        node.room_id_str,
        node.roomId,
        node.roomIdStr,
        node.live_room_id,
        node.liveRoomId,
        node.webcast_room_id,
        node.webcastRoomId,
        node.live_id,
        node.liveId,
        node.webcast_id,
        node.webcastId
      )
    ) {
      return true;
    }

    if (
      node.live_status !== undefined ||
      node.liveStatus !== undefined ||
      node.stream_url ||
      node.streamUrl ||
      node.rtmp_pull_url ||
      node.rtmpPullUrl ||
      node.flv_pull_url ||
      node.flvPullUrl ||
      node.hls_pull_url ||
      node.hlsPullUrl
    ) {
      return true;
    }

    return false;
  }

  function isLiveOnlyNode(node) {
    if (!node || typeof node !== "object" || !isLiveNode(node)) return false;

    const explicitAwemeId = firstString(
      node.aweme_id,
      node.awemeId,
      node.item_id,
      node.itemId,
      node.vid
    );
    const music = node.music || node.music_info || node.musicInfo || node.music_data;
    const hasMusic = Boolean(music && typeof music === "object");
    const hasAwemeVideo = Boolean(node.video && typeof node.video === "object");

    return !explicitAwemeId || (!hasMusic && !hasAwemeVideo);
  }

  function normalizeAwemeLike(node) {
    if (!node || typeof node !== "object") return null;

    const explicitAwemeId = firstString(
      node.aweme_id,
      node.awemeId,
      node.item_id,
      node.itemId,
      node.vid
    );

    const music =
      node.music || node.music_info || node.musicInfo || node.music_data;
    const hasMusic = Boolean(music && typeof music === "object");

    // A normal aweme may carry live-state metadata when its author is live.
    // We only treat a node as a live room if it is not an explicit aweme with
    // music/video data.
    if (isLiveOnlyNode(node)) {
      return null;
    }

    const awemeId =
      explicitAwemeId ||
      (isLiveNode(node) ? "" : firstString(node.id));

    const videoAuthor = extractVideoAuthor(node);
    const tags = extractTags(node);

    const musicId = hasMusic
      ? firstString(
          music.id,
          music.music_id,
          music.musicId,
          music.mid,
          music.song_id,
          music.songId
        )
      : "";

    const title = hasMusic
      ? firstString(
          music.title,
          music.name,
          music.music_title,
          music.musicTitle,
          music.sound_title,
          music.title_str,
          music.titleStr
        )
      : "";

    const musicAuthor = hasMusic
      ? firstString(
          music.author,
          music.author_name,
          music.authorName,
          music.owner_nickname,
          music.owner_handle,
          music.artist,
          music.nickname
        )
      : "";

    const hasVideoAuthor = Boolean(videoAuthor.nickname || videoAuthor.id);
    const hasTags = tags.length > 0;

    if (!awemeId || (!hasMusic && !hasVideoAuthor && !hasTags)) return null;

    if (!musicId && !title && !hasVideoAuthor && !hasTags) return null;

    return {
      awemeId,
      musicId,
      title,
      videoTitle: firstString(node.desc, node.description),
      musicAuthor,
      author: videoAuthor.nickname,
      authorId: videoAuthor.id,
      tags,
      seenAt: Date.now(),
      source: "douyin-web-official-fields"
    };
  }

  function extractAwemeEntries(root) {
    const entries = [];
    const seen = new Set();
    const queue = [root];
    let visited = 0;

    while (queue.length && visited < MAX_VISITED_NODES) {
      const node = queue.pop();
      if (!node || typeof node !== "object" || seen.has(node)) continue;

      seen.add(node);
      visited++;

      if (isLiveOnlyNode(node)) continue;

      const entry = normalizeAwemeLike(node);
      if (entry) {
        entries.push(entry);
        continue;
      }

      for (const value of Object.values(node)) {
        if (value && typeof value === "object") queue.push(value);
      }
    }

    return entries;
  }

  function buildRule(kind, value) {
    const cleanValue = String(value || "").trim();
    if (!cleanValue) return null;

    if (kind === "music") {
      if (/^\d+$/.test(cleanValue)) {
        return {
          key: `music:${cleanValue}`,
          kind: "music",
          value: cleanValue
        };
      }
      return {
        key: `title:${normalizedText(cleanValue)}`,
        kind: "music",
        value: cleanValue
      };
    }

    if (kind === "author") {
      return {
        key: `author:${normalizedText(cleanValue)}`,
        kind: "author",
        value: cleanValue
      };
    }

    if (kind === "tag") {
      const tag = cleanValue.replace(/^#/, "");
      return {
        key: `tag:${normalizedText(tag)}`,
        kind: "tag",
        value: tag
      };
    }

    return null;
  }

  function matchBlockedEntry(entry) {
    if (!filterSettings.enabled || !entry) return null;

    const rules = filterSettings.blocked;
    if (!rules || typeof rules !== "object") return null;

    if (entry.musicId) {
      const rule = buildRule("music", entry.musicId);
      if (rule && rules[rule.key]) return rule;
    }

    if (entry.title) {
      const rule = buildRule("music", entry.title);
      if (rule && rules[rule.key]) return rule;
    }

    if (entry.author || entry.authorId) {
      const rule = buildRule("author", entry.author || entry.authorId);
      if (rule && rules[rule.key]) return rule;
    }

    for (const tag of entry.tags || []) {
      const rule = buildRule("tag", tag);
      if (rule && rules[rule.key]) return rule;
    }

    return null;
  }

  function isFeedUrl(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      return /\/aweme\/v1\/web\/(?:tab\/|familiar\/|recommend\/|channel\/)?feed\/?/i.test(
        parsed.pathname
      );
    } catch (_) {
      return false;
    }
  }

  function nextCursorFromData(data) {
    if (!data || typeof data !== "object") return "";

    const fields = [
      "next_cursor",
      "nextCursor",
      "cursor",
      "max_cursor",
      "maxCursor"
    ];

    for (const field of fields) {
      const value = data[field];
      if (value !== undefined && value !== null && `${value}` !== "") {
        return `${value}`;
      }
    }

    return "";
  }

  function hasMoreFromData(data) {
    if (!data || typeof data !== "object") return true;
    const value = data.has_more ?? data.hasMore;
    return value === undefined ? true : Boolean(value);
  }

  function buildNextFeedUrl(url, cursor) {
    if (!url || !cursor) return "";

    try {
      const parsed = new URL(url, window.location.origin);
      parsed.searchParams.set("cursor", String(cursor));

      if (parsed.searchParams.has("max_cursor")) {
        parsed.searchParams.set("max_cursor", String(cursor));
      }

      return parsed.toString();
    } catch (_) {
      return "";
    }
  }

  function filterFeedData(data) {
    const stats = {
      total: 0,
      removed: 0,
      removedEntries: []
    };
    const feedArrayKeys = new Set([
      "aweme_list",
      "awemeList",
      "item_list",
      "itemList",
      "items",
      "data",
      "list"
    ]);
    const wrapperKeys = [
      "aweme_info",
      "awemeInfo",
      "aweme_detail",
      "awemeDetail",
      "item",
      "video"
    ];

    function feedEntry(item) {
      if (!item || typeof item !== "object") return null;

      const directEntry = normalizeAwemeLike(item);
      if (directEntry) return directEntry;

      for (const key of wrapperKeys) {
        const entry = normalizeAwemeLike(item[key]);
        if (entry) return entry;
      }

      return null;
    }

    function visit(value, key) {
      if (Array.isArray(value) && feedArrayKeys.has(key)) {
        const kept = [];
        for (const item of value) {
          const entry = feedEntry(item);
          if (entry) {
            stats.total++;
            const rule = matchBlockedEntry(entry);
            if (rule) {
              stats.removedEntries.push({ entry, rule });
              postBlockedEntry(buildBlockedRecord(entry, rule));
              stats.removed++;
              continue;
            }
          }
          kept.push(item);
        }
        return kept;
      }

      if (value && typeof value === "object") {
        const output = {};
        for (const [key, item] of Object.entries(value)) {
          output[key] = visit(item, key);
        }
        return output;
      }

      return value;
    }

    const filteredData = visit(data, "");
    return {
      data: filteredData,
      total: stats.total,
      removed: stats.removed,
      allowed: Math.max(0, stats.total - stats.removed),
      nextCursor: nextCursorFromData(data),
      hasMore: hasMoreFromData(data)
    };
  }

  function filterFeedText(text) {
    if (!text || text.length > MAX_BODY_BYTES) return null;

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return null;
    }

    const result = filterFeedData(data);
    result.text = JSON.stringify(result.data);
    return result;
  }

  function postEntry(entry) {
    try {
      window.postMessage(
        {
          source: MESSAGE_SOURCE,
          type: "entry",
          entry
        },
        window.location.origin
      );
    } catch (_) {
      // 忽略序列化失败，例如极少数对象不可结构化克隆。
    }
  }

  function postBlockedEntry(record) {
    try {
      window.postMessage(
        {
          source: MESSAGE_SOURCE,
          type: "blocked",
          record
        },
        window.location.origin
      );
    } catch (_) {}
  }

  function buildBlockedRecord(entry, rule) {
    if (!entry) return null;

    return {
      awemeId: entry.awemeId || "",
      author: entry.author || "",
      authorId: entry.authorId || "",
      title: entry.title || "",
      videoTitle: entry.videoTitle || "",
      musicId: entry.musicId || "",
      ruleKey: rule?.key || "",
      ruleLabel: rule?.label || "",
      ruleKind: rule?.kind || "",
      blockedAt: Date.now()
    };
  }

  function decodeScriptText(text) {
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
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
        String.fromCharCode(parseInt(code, 16))
      )
      .replace(/\\(["\\\/bfnrt])/g, (match, char) => {
        if (char === "b") return "\b";
        if (char === "f") return "\f";
        if (char === "n") return "\n";
        if (char === "r") return "\r";
        if (char === "t") return "\t";
        return char;
      });
  }

  function extractScriptString(text, key, fromIndex = 0) {
    const keyIndex = text.indexOf(`"${key}"`, fromIndex);
    if (keyIndex < 0) return "";

    const colonIndex = text.indexOf(":", keyIndex + key.length + 2);
    if (colonIndex < 0) return "";

    const match = text
      .slice(colonIndex + 1, colonIndex + 12000)
      .match(/^"((?:\\.|[^"\\])*)"/);

    if (!match) return "";

    try {
      return JSON.parse(`"${match[1]}"`) || "";
    } catch (_) {
      return match[1];
    }
  }

  function extractSsrEntriesForAwemeId(awemeId) {
    if (!awemeId) return [];

    const entries = [];

    for (const script of document.scripts) {
      const rawText = script.textContent || "";
      if (!rawText.includes("awemeId")) continue;

      const text = decodeScriptText(rawText);
      const regex = new RegExp(`"awemeId"\\s*:\\s*"${awemeId}"`, "g");
      let match;

      while ((match = regex.exec(text)) !== null) {
        const start = match.index;
        const nextMatch = regex.exec(text);
        const end = nextMatch ? nextMatch.index : start + 140000;
        if (nextMatch) regex.lastIndex = nextMatch.index;

        const block = text.slice(start, end);
        const authorIndex = block.search(/"authorInfo"\\s*:/);
        if (authorIndex < 0) continue;

        const author = extractScriptString(block, "nickname", authorIndex);
        const authorId = extractScriptString(block, "uid", authorIndex);
        const musicIndex = block.search(/"music"\\s*:/);
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

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data;
    if (data?.source !== ISOLATED_MESSAGE_SOURCE) return;

    if (data.type === "request-entry" && data.awemeId) {
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

    if (data.type !== "settings") return;

    filterSettings = {
      enabled: data.enabled !== false,
      blocked:
        data.blocked && typeof data.blocked === "object" ? data.blocked : {}
    };
    settingsReadyResolve?.();
  });

  window.postMessage(
    {
      source: MESSAGE_SOURCE,
      type: "ready"
    },
    window.location.origin
  );

  function shouldParseUrl(url) {
    if (!url || noisyUrlPattern.test(url)) return false;
    return /\/aweme\/v1\/web\//i.test(url);
  }

  function shouldParseContentType(contentType) {
    if (!contentType) return false;
    return /json|text\/plain|javascript/i.test(contentType);
  }

  function parseResponseBody(text, url) {
    if (!text || text.length > MAX_BODY_BYTES) return;

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return;
    }

    const entries = extractAwemeEntries(data);
    for (const entry of entries.slice(0, 500)) postEntry(entry);
  }

  function createFilteredResponse(response, text) {
    const headers = new Headers();
    response.headers?.forEach?.((value, name) => {
      if (/^(content-length|content-encoding|transfer-encoding)$/i.test(name)) {
        return;
      }
      headers.set(name, value);
    });

    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  async function getFilteredFeedResponse(response, requestUrl) {
    let currentResponse = response;
    let currentUrl = requestUrl || response?.url || "";

    for (let page = 0; page < MAX_PREFETCH_FEED_PAGES; page++) {
      const text = await currentResponse.clone().text();
      const filtered = filterFeedText(text);

      parseResponseBody(text, currentUrl);

      if (!filtered || filtered.removed === 0) {
        return currentResponse;
      }

      if (filtered.allowed > 0) {
        return createFilteredResponse(currentResponse, filtered.text);
      }

      if (!filtered.hasMore || !filtered.nextCursor) {
        return currentResponse;
      }

      const nextUrl = buildNextFeedUrl(currentUrl, filtered.nextCursor);
      if (!nextUrl) {
        return currentResponse;
      }

      const nextResponse = await originalFetch(nextUrl);
      if (!nextResponse?.ok) {
        return currentResponse;
      }

      currentResponse = nextResponse;
      currentUrl = nextResponse.url || nextUrl;
    }

    return currentResponse;
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);

      try {
        const url = response?.url || String(args[0] || "");

        if (response?.ok && isFeedUrl(url) && typeof response.clone === "function") {
          await waitForFilterSettings();
          return await getFilteredFeedResponse(response, String(args[0] || ""));
        }

        const contentType = response?.headers?.get?.("content-type") || "";

        if (
          response?.ok !== false &&
          shouldParseUrl(url) &&
          shouldParseContentType(contentType) &&
          typeof response.clone === "function"
        ) {
          response
            .clone()
            .text()
            .then((text) => parseResponseBody(text, url))
            .catch(() => {});
        }
      } catch (_) {
        // 解析失败不能影响抖音页面本身。
      }

      return response;
    };
  }

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  const originalXhrAddEventListener =
    XMLHttpRequest.prototype.addEventListener;

  function getXhrText(xhr) {
    if (xhr.responseType === "" || xhr.responseType === "text") {
      return xhr.responseText || "";
    }
    if (xhr.responseType === "json") {
      return JSON.stringify(xhr.response || "");
    }
    return "";
  }

  function overrideXhrResponse(xhr, text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = null;
    }

    if (xhr.responseType === "" || xhr.responseType === "text") {
      Object.defineProperty(xhr, "responseText", {
        configurable: true,
        get: () => text
      });
      Object.defineProperty(xhr, "response", {
        configurable: true,
        get: () => text
      });
      return;
    }

    if (xhr.responseType === "json") {
      Object.defineProperty(xhr, "response", {
        configurable: true,
        get: () => parsed
      });
    }
  }

  function handleXhrFilterEvent(xhr, event) {
    if (xhr.__douyinBgmFilterFinalized) return;
    if (xhr.readyState !== 4) return;

    const url = xhr.responseURL || xhr.__douyinBgmFilterUrl || "";
    if (!isFeedUrl(url)) return;

    const text = getXhrText(xhr);
    const filtered = filterFeedText(text);
    if (!filtered || filtered.removed === 0) {
      xhr.__douyinBgmFilterFinalized = true;
      parseResponseBody(text, url);
      return;
    }

    if (filtered.allowed === 0) {
      xhr.__douyinBgmFilterFinalized = true;
      parseResponseBody(text, url);
      return;
    }

    parseResponseBody(text, url);

    // Rewrite the data before the page's own load handlers run. The native
    // readystatechange/load events continue unchanged, so Douyin keeps its own
    // loading, cursor, and retry behavior.
    overrideXhrResponse(xhr, filtered.text);
    xhr.__douyinBgmFilterFinalized = true;
  }

  function ensureXhrFilter(xhr) {
    if (xhr.__douyinBgmFilterInstalled) return;
    xhr.__douyinBgmFilterInstalled = true;

    const listener = (event) => handleXhrFilterEvent(xhr, event);
    originalXhrAddEventListener.call(xhr, "readystatechange", listener);
    originalXhrAddEventListener.call(xhr, "load", listener);
  }

  XMLHttpRequest.prototype.addEventListener = function (
    type,
    listener,
    options
  ) {
    ensureXhrFilter(this);
    return originalXhrAddEventListener.call(this, type, listener, options);
  };

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      this.__douyinBgmFilterMethod = String(method || "GET").toUpperCase();
      this.__douyinBgmFilterUrl = String(url || "");
      this.__douyinBgmFilterHeaders = {};
      ensureXhrFilter(this);
    } catch (_) {}
    return originalXhrOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    try {
      ensureXhrFilter(this);
    } catch (_) {}
    return originalXhrSend.apply(this, args);
  };
})();
