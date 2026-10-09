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

  // 诊断日志：数据层在 MAIN world，只能把记录转发给隔离世界，由它统一保存和导出。
  function logEvent(level, message, data) {
    try {
      window.postMessage(
        {
          source: MESSAGE_SOURCE,
          type: "log",
          record: {
            t: Date.now(),
            level,
            message: String(message).slice(0, 400),
            data
          }
        },
        window.location.origin
      );
    } catch (_) {}
  }
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

  function extractLiveRoomAuthor(node) {
    const rooms = [
      node.room,
      node.room_info,
      node.roomInfo,
      node.room_data,
      node.roomData,
      node.live_room,
      node.liveRoom,
      node.webcast_room,
      node.webcastRoom
    ].filter((value) => value && typeof value === "object");
    const owners = [
      node.owner,
      node.owner_info,
      node.ownerInfo,
      node.owner_user,
      node.ownerUser,
      node.user,
      node.user_info,
      node.userInfo,
      node.anchor,
      node.anchor_info,
      node.anchorInfo,
      node.author,
      node.author_info,
      node.authorInfo,
      ...rooms.flatMap((room) => [
        room.owner,
        room.owner_info,
        room.ownerInfo,
        room.user,
        room.user_info,
        room.userInfo,
        room.anchor,
        room.anchor_info,
        room.anchorInfo
      ])
    ];

    for (const owner of owners) {
      if (!owner || typeof owner !== "object") continue;

      const nickname = firstString(
        owner.nickname,
        owner.nick_name,
        owner.nickName,
        owner.unique_id,
        owner.uniqueId,
        owner.user_name,
        owner.userName,
        owner.display_name,
        owner.displayName,
        owner.name,
        owner.author
      );
      const id = firstString(
        owner.sec_uid,
        owner.secUid,
        owner.uid,
        owner.user_id,
        owner.userId,
        owner.id_str,
        owner.idStr,
        owner.id
      );

      if (nickname || id) return { nickname, id };
    }

    return { nickname: "", id: "" };
  }

  function normalizeLiveRoom(node) {
    if (!isLiveOnlyNode(node)) return null;

    const owner = extractLiveRoomAuthor(node);
    if (!owner.nickname && !owner.id) return null;

    const room = [
      node.room,
      node.room_info,
      node.roomInfo,
      node.room_data,
      node.roomData,
      node.live_room,
      node.liveRoom,
      node.webcast_room,
      node.webcastRoom
    ].find((value) => value && typeof value === "object") || {};

    return {
      awemeId: "",
      roomId: firstString(
        node.room_id,
        node.room_id_str,
        node.roomId,
        node.roomIdStr,
        node.live_room_id,
        node.liveRoomId,
        node.webcast_room_id,
        node.webcastRoomId,
        node.web_rid,
        node.webRid,
        room.room_id,
        room.room_id_str,
        room.roomId,
        room.web_rid,
        room.webRid,
        room.id
      ),
      author: owner.nickname,
      authorId: owner.id,
      musicId: "",
      title: "",
      videoTitle: "",
      tags: [],
      isLive: true,
      pageKey: `${window.location.pathname}${window.location.search}`,
      seenAt: Date.now(),
      source: "douyin-web-live-room-fields"
    };
  }

  function isLiveNode(node) {
    if (!node || typeof node !== "object") return false;

    const room =
      node.room ||
      node.room_info ||
      node.roomInfo ||
      node.room_data ||
      node.roomData ||
      node.live_room ||
      node.liveRoom ||
      node.webcast_room ||
      node.webcastRoom;

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
        node.webcastId,
        node.web_rid,
        node.webRid,
        room?.room_id,
        room?.room_id_str,
        room?.roomId,
        room?.web_rid,
        room?.webRid,
        room?.id
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

      if (isLiveOnlyNode(node)) {
        const liveEntry = normalizeLiveRoom(node);
        if (liveEntry) entries.push(liveEntry);
        continue;
      }

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
      if (rule && rules[rule.key]) return rules[rule.key];
    }

    if (entry.title) {
      const rule = buildRule("music", entry.title);
      if (rule && rules[rule.key]) return rules[rule.key];
    }

    if (entry.author || entry.authorId) {
      const rule = buildRule("author", entry.author || entry.authorId);
      if (rule && rules[rule.key]) return rules[rule.key];
    }

    for (const tag of entry.tags || []) {
      const rule = buildRule("tag", tag);
      if (rule && rules[rule.key]) return rules[rule.key];
    }

    const tags = (entry.tags || []).map(normalizedText);
    for (const rule of Object.values(rules)) {
      if (rule?.kind !== "tagKeyword") continue;
      const keyword = normalizedText(rule.value).replace(/^#+/, "").trim();
      if (keyword && tags.some((tag) => tag.includes(keyword))) return rule;
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

      // Resolve all normal-video wrappers first: their live thumbnails must
      // never turn the parent video into a live recommendation.
      const liveEntry = normalizeLiveRoom(item);
      if (liveEntry) return liveEntry;
      for (const key of wrapperKeys) {
        const entry = normalizeLiveRoom(item[key]);
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

      // 数组要原样保留：整体重建时把 "extra" 这类非推荐列表的数组变成对象，
      // 会让页面拿到结构被破坏的响应。
      if (Array.isArray(value)) {
        return value.map((item, index) => visit(item, String(index)));
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

  function filterFeedText(text, requestUrl) {
    if (!text || text.length > MAX_BODY_BYTES) return null;

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return null;
    }

    const result = filterFeedData(data);
    result.text = JSON.stringify(result.data);

    if (result.total > 0) {
      logEvent("info", "数据层处理了一批推荐", {
        url: String(requestUrl || "").slice(0, 160),
        total: result.total,
        removed: result.removed,
        allowed: result.allowed,
        hasMore: result.hasMore
      });
    }

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

    logEvent("info", "按规则移除了一个视频", {
      awemeId: record?.awemeId,
      rule: record?.ruleLabel,
      ruleKind: record?.ruleKind,
      author: record?.author,
      title: record?.title
    });
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

  // 详情页 / 精选页的视频数据藏在 <script> 文本里，单个脚本可能几百 KB。
  // 下面这套扫描必须严格有限：旧实现用 exec 配手动回写 lastIndex，一旦命中就会
  // 反复取到同一个匹配、永远出不了循环，直接把页面主线程卡死。
  const MAX_SSR_BLOCK_CHARS = 140000;
  const MAX_SSR_BLOCKS_PER_SCRIPT = 8;
  const MAX_SSR_SCRIPT_CHARS = 6000000;
  const SSR_AWEME_ID_KEYS = ['"awemeId"', '"aweme_id"'];
  const decodedScriptCache = new WeakMap();

  function decodeScriptTextCached(script) {
    const cached = decodedScriptCache.get(script);
    if (typeof cached === "string") return cached;

    const decoded = decodeScriptText(script.textContent || "");
    decodedScriptCache.set(script, decoded);
    return decoded;
  }

  // 只找「这个 id」出现的位置，并且限制次数，保证循环一定结束。
  function findAwemeOccurrences(text, awemeId) {
    const positions = [];

    for (const key of SSR_AWEME_ID_KEYS) {
      let from = 0;

      while (positions.length < MAX_SSR_BLOCKS_PER_SCRIPT) {
        const index = text.indexOf(key, from);
        if (index < 0) break;
        from = index + key.length;

        const head = text.slice(index, index + key.length + 80);
        const match = new RegExp(`^${key}\\s*:\\s*"([^"]*)"`).exec(head);
        if (!match || match[1] !== awemeId) continue;
        positions.push(index);
      }
    }

    return positions.sort((a, b) => a - b);
  }

  function extractSsrEntriesForAwemeId(awemeId) {
    if (!awemeId) return [];

    const entries = [];
    const started = Date.now();
    const stats = {
      scripts: document.scripts.length,
      withId: 0,
      decoded: 0,
      idFound: 0,
      authorFound: 0
    };

    for (const script of document.scripts) {
      const rawText = script.textContent || "";
      // 先做零成本过滤：只有真的提到这个 id、且不算超大的脚本才值得解码。
      if (!rawText.includes(awemeId)) continue;
      if (rawText.length > MAX_SSR_SCRIPT_CHARS) continue;
      stats.withId += 1;

      const text = decodeScriptTextCached(script);
      stats.decoded += 1;
      const positions = findAwemeOccurrences(text, awemeId);
      if (!positions.length) continue;
      stats.idFound += positions.length;

      for (let i = 0; i < positions.length; i += 1) {
        const start = positions[i];
        const end =
          i + 1 < positions.length
            ? positions[i + 1]
            : Math.min(text.length, start + MAX_SSR_BLOCK_CHARS);
        const block = text.slice(start, end);
        const authorIndex = block.search(/"authorInfo"\s*:/);
        if (authorIndex < 0) continue;
        stats.authorFound += 1;

        const author = extractScriptString(block, "nickname", authorIndex);
        const authorId = extractScriptString(block, "uid", authorIndex);
        const musicIndex = block.search(/"music"\s*:/);
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
    logEvent("info", "SSR 兜底解析结束", {
      awemeId,
      entries: entries.length,
      ms: Date.now() - started,
      ...stats
    });
    return entries;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data;
    if (data?.source !== ISOLATED_MESSAGE_SOURCE) return;

    if (data.type === "request-entry" && data.awemeId) {
      setTimeout(() => {
        let entries = [];
        logEvent("info", "收到识别请求，开始查 SSR 数据", { awemeId: data.awemeId });

        try {
          entries =
            ssrEntriesCache.get(data.awemeId) ||
            extractSsrEntriesForAwemeId(data.awemeId);
        } catch (error) {
          // 解析失败只当没识别到，绝不把异常抛回页面主线程。
          console.error("[douyin-bgm-filter] SSR 解析失败", error);
          logEvent("error", "SSR 兜底解析抛错", {
            message: String(error?.message || error)
          });
          entries = [];
        }

        for (const entry of entries) {
          postEntry(entry);
        }

        if (!entries.length) {
          logEvent("info", "SSR 里没有这个视频，页面需要靠接口数据识别", {
            awemeId: data.awemeId
          });
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

  // 只有这些接口里才可能带视频信息；emoji / IM / AB 参数之类的接口没必要解析。
  const noisyApiPattern =
    /(emoji|\/im\/|ab\/params|hot\/search|notice|settings|feedback|entrance|config|resource)/i;
  const videoApiPattern =
    /(aweme\/detail|aweme\/post|aweme\/related|aweme\/feed|\/feed|search\/item|history|collection|mix\/|series|module|recommend|webcast\/(room|user)|live_room|live\/(room|user))/i;

  function isVideoDataUrl(url) {
    if (!url || noisyApiPattern.test(url)) return false;
    return videoApiPattern.test(url);
  }

  function shouldParseContentType(contentType) {
    if (!contentType) return false;
    return /json|text\/plain|javascript/i.test(contentType);
  }

  function parseResponseBody(text, url) {
    if (!text || text.length > MAX_BODY_BYTES) return;
    // 先做一次几乎零成本的检查，避免去 JSON.parse 表情包之类的大响应。
    const hasAweme = text.includes('"aweme_id"') || text.includes('"awemeId"');
    const hasLiveRoom = [
      '"room_id"',
      '"room_id_str"',
      '"roomId"',
      '"live_room_id"',
      '"liveRoomId"',
      '"webcast_room_id"',
      '"webcastRoomId"',
      '"live_id"',
      '"liveId"',
      '"webcast_id"',
      '"webcastId"',
      '"web_rid"',
      '"webRid"',
      '"live_status"',
      '"liveStatus"'
    ].some((field) => text.includes(field));
    if (!hasAweme && !hasLiveRoom) return;

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return;
    }

    const entries = extractAwemeEntries(data);
    for (const entry of entries.slice(0, 500)) postEntry(entry);

    if (entries.length) {
      logEvent("info", "从接口读到视频或直播数据", {
        url: String(url || "").slice(0, 160),
        entries: entries.length
      });
    }
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
    const seenCursors = new Set();

    for (let page = 0; page < MAX_PREFETCH_FEED_PAGES; page++) {
      const text = await currentResponse.clone().text();
      const filtered = filterFeedText(text, currentUrl);

      parseResponseBody(text, currentUrl);

      if (!filtered || filtered.removed === 0) {
        return currentResponse;
      }

      if (filtered.allowed > 0) {
        return createFilteredResponse(currentResponse, filtered.text);
      }

      if (!filtered.hasMore || !filtered.nextCursor) {
        return createFilteredResponse(currentResponse, filtered.text);
      }

      // 同一个游标只取一次：响应里如果回显了请求的 cursor，nextCursor 会和上一轮
      // 相同，再取就还是同一页，纯属浪费请求。
      if (seenCursors.has(filtered.nextCursor)) {
        return createFilteredResponse(currentResponse, filtered.text);
      }
      seenCursors.add(filtered.nextCursor);

      const nextUrl = buildNextFeedUrl(currentUrl, filtered.nextCursor);
      if (!nextUrl || page === MAX_PREFETCH_FEED_PAGES - 1) {
        return createFilteredResponse(currentResponse, filtered.text);
      }

      let nextResponse;
      try {
        nextResponse = await originalFetch(nextUrl);
      } catch (_) {
        return createFilteredResponse(currentResponse, filtered.text);
      }
      if (!nextResponse?.ok) {
        return createFilteredResponse(currentResponse, filtered.text);
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
          isVideoDataUrl(url) &&
          shouldParseContentType(contentType) &&
          typeof response.clone === "function"
        ) {
          response
            .clone()
            .text()
            .then((text) => parseResponseBody(text, url))
            .catch(() => {});
        }
      } catch (error) {
        // 解析失败不能影响抖音页面本身。
        logEvent("error", "处理响应时出错", {
          message: String(error?.message || error)
        });
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

    if (!isFeedUrl(url)) {
      // 推荐流以外的抖音接口（例如视频详情）也要读一遍：
      // 精选页/详情页切到下一个视频时数据就是从这里来的，不读就永远「未识别」。
      // 这里只看不改，响应本身原样交回页面。
      if (isVideoDataUrl(url)) {
        try {
          const detailText = getXhrText(xhr);
          if (detailText) {
            parseResponseBody(detailText, url);
          }
        } catch (error) {
          logEvent("error", "解析视频详情接口失败", {
            message: String(error?.message || error)
          });
        }
      }
      return;
    }

    const text = getXhrText(xhr);
    const filtered = filterFeedText(text, url);
    if (!filtered || filtered.removed === 0) {
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
