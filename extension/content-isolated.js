(() => {
  if (window.__douyinBgmFilterIsolatedInstalled) return;
  window.__douyinBgmFilterIsolatedInstalled = true;

  const MESSAGE_SOURCE = "douyin-bgm-filter/main";
  const ISOLATED_MESSAGE_SOURCE = "douyin-bgm-filter/isolated";
  const DEFAULT_SETTINGS = {
    enabled: true,
    blocked: {},
    buttonIcon: "not-interested",
    customImage: "",
    buttonSize: 40
  };
  // 只有这些键变化才需要重载设置：日志和屏蔽记录变化很频繁，没必要跟着重算。
  const SETTINGS_KEYS = ["enabled", "blocked", "buttonIcon", "customImage", "buttonSize"];
  const MAX_KNOWN_ENTRIES = 300;

  const BUTTON_ICONS = {
    "not-interested": `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M22 9.17756C22 9.15578 21.9993 9.13415 21.9979 9.11271C21.9993 9.05948 22 9.0061 22 8.95259C22 5.54223 19.2353 2.77759 15.825 2.77759C14.3806 2.77759 13.0513 3.27431 12 4.10469C10.9487 3.27431 9.61938 2.77759 8.175 2.77759C4.76464 2.77759 2 5.54223 2 8.95259C2 9.0062 2.00069 9.05968 2.00205 9.11301C2.00069 9.13435 2 9.15588 2 9.17756C2 10.4709 2.51833 11.7465 3.22256 12.8983C3.93327 14.0608 4.88418 15.1797 5.86669 16.1802C7.83219 18.1817 10.0219 19.8071 10.96 20.4729C11.5867 20.9176 12.4133 20.9176 13.04 20.4729C13.9781 19.8071 16.1678 18.1817 18.1333 16.1802C19.1158 15.1797 20.0667 14.0608 20.7774 12.8983C21.4817 11.7465 22 10.4709 22 9.17756ZM4 8.95259C4 6.6468 5.86921 4.77759 8.175 4.77759C9.00569 4.77759 9.7792 5.0196 10.4297 5.43793L10.0202 7.98603C10.0073 8.066 10.0273 8.14777 10.0757 8.21274L11.7057 10.403C11.752 10.4652 11.7724 10.543 11.7626 10.6199L11.4741 12.8919C11.4355 13.1962 11.8244 13.3555 12.0103 13.1115L13.895 10.6378C13.96 10.5525 13.9746 10.4391 13.9332 10.3402L13.0428 8.21329C13.0152 8.14735 13.0121 8.07371 13.034 8.00565L13.9249 5.23374C14.4949 4.94189 15.1405 4.77759 15.825 4.77759C18.1308 4.77759 20 6.6468 20 8.95259C20 9.01371 19.9987 9.07446 19.9961 9.13482C19.9943 9.17751 19.9952 9.22003 19.9987 9.26214C19.9765 10.0181 19.6587 10.894 19.0711 11.8551C18.4679 12.8416 17.6288 13.8395 16.7063 14.7789C14.9381 16.5795 12.9537 18.075 12 18.7581C11.0463 18.075 9.06189 16.5795 7.29368 14.7789C6.37124 13.8395 5.53206 12.8416 4.92891 11.8551C4.34127 10.8939 4.0234 10.0179 4.00124 9.2619C4.0048 9.21987 4.00571 9.17743 4.00389 9.13483C4.00131 9.07447 4 9.01371 4 8.95259Z" fill="#ffffff"/>
      </svg>
    `,
    heart: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20.5s-6.4-4.1-8.7-7.7C1.3 9.8 2.5 6.2 5.6 6.2c1.9 0 3.2 1 4.4 2.5 1.2-1.5 2.5-2.5 4.4-2.5 3.1 0 4.3 3.6 2.3 6.6-2.3 3.6-8.7 7.7-8.7 7.7z" fill="currentColor"/>
      </svg>
    `,
    star: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3z" fill="currentColor"/>
      </svg>
    `,
    comment: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16a1 1 0 011 1v9a1 1 0 01-1 1h-7l-4 3v-3H4a1 1 0 01-1-1V6a1 1 0 011-1z" fill="currentColor"/>
      </svg>
    `,
    share: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 4l6 5-6 5v-3H9a5 5 0 00-5 5v1H2v-1a7 7 0 017-7h5V4z" fill="currentColor"/>
      </svg>
    `
  };

  let settings = structuredClone(DEFAULT_SETTINGS);
  const knownEntries = new Map();
  const knownLiveEntries = new Map();
  const LIVE_CONTAINER_SELECTOR = '[data-e2e="feed-live"], [data-e2e="live-container"], [data-e2e="live-feed-item"], [data-e2e="webcast-feed-item"]';
  // 只有在卡片真是 static 时才写 position: relative，原值存在这个属性里以便还原。
  const CARD_POSITION_ATTR = "data-douyin-bgm-filter-position";
  // 与 findActiveContainer() 用的那组选择器保持一致：注入目标就是同一个「卡片」概念。
  const CARD_SELECTOR = [
    '[data-e2e="feed-active-video"]',
    '[data-e2e="slide-list-item"]',
    '[data-e2e="feed-item"]',
    '[data-e2e="recommend-item"]',
    '[data-e2e="video-card"]',
    '[data-e2e="feed-video"]',
    LIVE_CONTAINER_SELECTOR
  ].join(",");
  const requestedEntries = new Set();
  let lastRequestedAwemeId = "";

  // ---- 诊断日志 -----------------------------------------------------------
  // 只保存在浏览器本地。环形缓冲，最多 300 条，写入做了节流，
  // 用户点 popup 里的「导出诊断日志」就能拿到一份可以直接排查的文本。
  const DEBUG_LOG_KEY = "debugLog";
  const DEBUG_LOG_LIMIT = 300;
  const DEBUG_TEXT_LIMIT = 400;
  // 抖音 PC 网页版操作栏的结构（从它自己的样式反推）：
  //   .immersive-player-switch { padding-right: 12px（窄屏 16px）;
  //                              transform-origin: right bottom; transform: scale(s); }
  //   └ 50px 宽的图标列，点赞等图标在列里水平居中
  // 所以图标中心 = 容器右边缘 − (padding-right + 50 / 2) × s。
  // 因为 transform-origin 在右下角，缩放只会把图标中心往左推，右边缘不变。
  const RAIL_COLUMN_WIDTH = 50;
  const RAIL_SELECTOR = '[class*="immersive-player-switch"]';
  // 万一找不到操作栏容器时的兜底值（窄屏 16px 内边距 → 41；常规 12px → 37）
  const RAIL_CENTER_INSET_FALLBACK = 37;

  let debugEvents = [];
  let debugPersistTimer = null;
  let debugDirty = false;

  function trimDebugValue(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
      return value.length > DEBUG_TEXT_LIMIT
        ? `${value.slice(0, DEBUG_TEXT_LIMIT)}…(${value.length})`
        : value;
    }
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (depth >= 2) return "[深层数据]";
    if (Array.isArray(value)) {
      return value.slice(0, 12).map((item) => trimDebugValue(item, depth + 1));
    }
    if (typeof value === "object") {
      const output = {};
      for (const [key, item] of Object.entries(value).slice(0, 20)) {
        output[key] = trimDebugValue(item, depth + 1);
      }
      return output;
    }
    return String(value).slice(0, DEBUG_TEXT_LIMIT);
  }

  function flushDebugLog() {
    if (!debugDirty) return;
    debugDirty = false;

    try {
      const storage = chrome?.storage?.local;
      if (!storage) return;
      storage.set({ [DEBUG_LOG_KEY]: debugEvents }, () => {
        // 扩展重载后上下文失效会走到这里，忽略即可。
        void chrome.runtime?.lastError;
      });
    } catch (_) {}
  }

  function scheduleDebugPersist() {
    if (debugPersistTimer) return;
    debugPersistTimer = setTimeout(() => {
      debugPersistTimer = null;
      flushDebugLog();
    }, 2500);
  }

  function logEvent(level, message, data) {
    try {
      const record = {
        t: Date.now(),
        level,
        message: String(message).slice(0, DEBUG_TEXT_LIMIT)
      };

      if (data !== undefined) record.data = trimDebugValue(data);
      if (typeof location !== "undefined") {
        record.page = `${location.pathname}${location.search}`.slice(0, 120);
      }

      debugEvents.push(record);
      if (debugEvents.length > DEBUG_LOG_LIMIT) {
        debugEvents.splice(0, debugEvents.length - DEBUG_LOG_LIMIT);
      }

      debugDirty = true;
      if (level === "error") {
        flushDebugLog();
        console.warn("[抖音视频屏蔽]", message, data ?? "");
      } else {
        scheduleDebugPersist();
      }
    } catch (_) {}
  }

  function loadPreviousDebugLog() {
    try {
      const storage = chrome?.storage?.local;
      if (!storage) return;

      storage.get({ [DEBUG_LOG_KEY]: [] }, (items) => {
        void chrome.runtime?.lastError;
        const previous = Array.isArray(items?.[DEBUG_LOG_KEY]) ? items[DEBUG_LOG_KEY] : [];
        if (!previous.length) return;

        debugEvents = previous.concat(debugEvents).slice(-DEBUG_LOG_LIMIT);
        scheduleDebugPersist();
      });
    } catch (_) {}
  }

  function runtimeErrorSource(filename, stack) {
    let extensionRoot = "";
    try { extensionRoot = chrome.runtime.getURL(""); } catch (_) {}
    if (extensionRoot && (String(filename || "").startsWith(extensionRoot) || String(stack || "").includes(extensionRoot))) return "extension";
    return filename ? "page" : "unknown";
  }

  window.addEventListener("error", (event) => {
    const source = runtimeErrorSource(event.filename, event.error?.stack);
    logEvent(source === "extension" ? "error" : "warn", source === "extension" ? "扩展出现未捕获错误" : "页面运行错误（来源见诊断信息）", {
      source,
      message: event.message,
      file: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack || ""
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const source = runtimeErrorSource("", reason?.stack);
    logEvent(source === "extension" ? "error" : "warn", source === "extension" ? "扩展出现未处理的 Promise 拒绝" : "页面 Promise 拒绝（来源见诊断信息）", {
      source,
      message: reason?.message || String(reason || ""),
      stack: reason?.stack || ""
    });
  });

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "douyin-bgm-filter/dump-log") {
        flushDebugLog();
        sendResponse({
          events: debugEvents.slice(),
          meta: {
            url: location.href,
            version: chrome.runtime.getManifest?.().version || "",
            capturedAt: Date.now()
          }
        });
        return true;
      }

      if (message?.type === "douyin-bgm-filter/clear-log") {
        debugEvents = [];
        debugDirty = true;
        flushDebugLog();
        sendResponse({ ok: true });
        return true;
      }

      return false;
    });
  } catch (_) {}

  let activeContainer = null;
  // 每张卡片一份工具栏记录：
  // { card, root, button, panel, isLive, open, measured, metrics, wrotePosition }
  const cardToolbars = new Set();
  let activeToolbar = null;
  let openToolbar = null;
  // 记录上一次「算出来的 X」和真实点赞图标中心的偏差，只用于日志，不参与定位。
  let lastAnchorDrift = null;
  let toolbarPositionTimer = 0;
  let blockedHistory = [];
  let blockedHistoryLoaded = false;
  let pendingBlockedRecords = [];
  let blockedHistorySaveTimer = 0;
  let isSavingBlockedHistory = false;

  function normalizedText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function postSettingsToMain() {
    try {
      window.postMessage(
        {
          source: ISOLATED_MESSAGE_SOURCE,
          type: "settings",
          enabled: Boolean(settings.enabled),
          blocked: settings.blocked || {}
        },
        window.location.origin
      );
    } catch (_) {}
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

  function musicRuleForEntry(entry) {
    if (!entry) return null;
    if (entry.musicId) return buildRule("music", entry.musicId);
    if (entry.title) return buildRule("music", entry.title);
    return null;
  }

  function authorRuleForEntry(entry) {
    if (!entry) return null;
    const value = entry.author || entry.authorId;
    return value ? buildRule("author", value) : null;
  }

  function tagRuleForValue(value) {
    return value ? buildRule("tag", value) : null;
  }

  function matchEntry(entry) {
    if (!settings.enabled || !entry) return null;

    const musicRule = musicRuleForEntry(entry);
    if (musicRule && settings.blocked[musicRule.key]) {
      return musicRule;
    }

    const authorRule = authorRuleForEntry(entry);
    if (authorRule && settings.blocked[authorRule.key]) {
      return authorRule;
    }

    for (const tag of entry.tags || []) {
      const tagRule = tagRuleForValue(tag);
      if (tagRule && settings.blocked[tagRule.key]) {
        return tagRule;
      }
    }

    const tags = (entry.tags || []).map(normalizedText);
    for (const rule of Object.values(settings.blocked)) {
      if (rule?.kind !== "tagKeyword") continue;
      const keyword = normalizedText(rule.value).replace(/^#+/, "").trim();
      if (keyword && tags.some((tag) => tag.includes(keyword))) return rule;
    }

    return null;
  }

  function injectStyle() {
    if (document.getElementById("douyin-bgm-filter-style")) return;

    const style = document.createElement("style");
    style.id = "douyin-bgm-filter-style";
    style.textContent = `
      /* 按钮长在卡片里，所以是 absolute 而不是 fixed：滚动由浏览器负责，扩展不再参与。
         下面这一串"复位"属性是必需的——挂在 <html> 下时几乎不继承任何东西，
         进了卡片就会继承抖音的 white-space / line-height / box-sizing，面板会错乱。 */
      .douyin-bgm-filter-toolbar {
        position: absolute;
        z-index: 2147483000;
        pointer-events: none;
        display: none;
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        border: 0;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        font-style: normal;
        font-weight: 400;
        line-height: 1.35;
        letter-spacing: normal;
        text-align: left;
        text-transform: none;
        text-indent: 0;
        white-space: normal;
        word-spacing: normal;
        direction: ltr;
        color: #fff;
        float: none;
        transform: none;
      }

      .douyin-bgm-filter-button {
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--douyin-bgm-filter-button-size, 40px);
        height: var(--douyin-bgm-filter-button-size, 40px);
        padding: 0;
        border: 0;
        border-radius: 12px;
        background: rgba(18, 18, 18, 0.78);
        color: #fff;
        font-size: 20px;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        cursor: pointer;
        backdrop-filter: blur(8px);
      }

      .douyin-bgm-filter-button svg {
        width: 22px;
        height: 22px;
        display: block;
      }

      .douyin-bgm-filter-button img {
        width: 22px;
        height: 22px;
        display: block;
        object-fit: contain;
      }

      .douyin-bgm-filter-button:hover {
        background: rgba(0, 0, 0, 0.9);
      }

      .douyin-bgm-filter-panel {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        width: 300px;
        padding: 10px;
        border-radius: 10px;
        background: rgba(20, 20, 20, 0.94);
        color: #fff;
        font-size: 12px;
        line-height: 1.35;
        display: none;
        pointer-events: auto;
        backdrop-filter: blur(8px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
        max-height: min(560px, calc(100vh - 24px));
        max-width: min(300px, calc(100vw - 24px));
        overflow: auto;
        overscroll-behavior: contain;
      }

      .douyin-bgm-filter-panel.open {
        display: block;
      }

      .douyin-bgm-filter-panel.above {
        top: auto;
        bottom: calc(100% + 8px);
      }

      .douyin-bgm-filter-panel-title {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 700;
      }

      .douyin-bgm-filter-section {
        margin-top: 8px;
      }

      .douyin-bgm-filter-row + .douyin-bgm-filter-row {
        margin-top: 9px;
      }

      .douyin-bgm-filter-section-label {
        margin-bottom: 4px;
        color: rgba(255, 255, 255, 0.62);
        font-size: 11px;
      }

      .douyin-bgm-filter-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      .douyin-bgm-filter-chip {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        max-width: 100%;
        padding: 5px 7px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        font-size: 12px;
        cursor: pointer;
        user-select: none;
      }

      .douyin-bgm-filter-chip:hover {
        background: rgba(255, 255, 255, 0.16);
      }

      .douyin-bgm-filter-chip input {
        position: absolute;
        width: 0;
        height: 0;
        margin: 0;
        opacity: 0;
        pointer-events: none;
      }

      .douyin-bgm-filter-chip.selected {
        border-color: rgba(254, 44, 85, 0.92);
        background: rgba(254, 44, 85, 0.24);
        color: #fff;
      }

      .douyin-bgm-filter-chip.selected:hover {
        background: rgba(254, 44, 85, 0.32);
      }

      .douyin-bgm-filter-chip[hidden] {
        display: none;
      }

      .douyin-bgm-filter-chip[disabled],
      .douyin-bgm-filter-chip.disabled {
        display: inline-flex;
        width: 100%;
        opacity: 0.48;
        cursor: not-allowed;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .douyin-bgm-filter-actions {
        display: flex;
        gap: 7px;
        margin-top: 11px;
      }

      .douyin-bgm-filter-button-secondary {
        flex: 1;
        padding: 6px 8px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 7px;
        background: transparent;
        color: #fff;
        font-size: 12px;
        cursor: not-allowed;
      }

      .douyin-bgm-filter-button-primary,
      .douyin-bgm-filter-button-secondary {
        flex: 1;
        padding: 6px 8px;
        border-radius: 7px;
        font-size: 12px;
      }

      .douyin-bgm-filter-button-primary {
        border: 0;
        background: #fe2c55;
        color: #fff;
        cursor: pointer;
      }

      .douyin-bgm-filter-button-primary:disabled {
        background: rgba(254, 44, 85, 0.35);
        cursor: not-allowed;
      }

      .douyin-bgm-filter-button-secondary {
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: transparent;
        color: #fff;
        cursor: pointer;
      }

      .douyin-bgm-filter-empty {
        color: rgba(255, 255, 255, 0.55);
        font-size: 11px;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  // 按钮尺寸只有一个来源：设置。渲染和定位都必须用它，
  // 否则会出现「按 100px 算 X、按钮却渲染成 56px」的横向错位。
  function resolvedButtonSize() {
    return Math.min(56, Math.max(32, Number(settings.buttonSize) || 40));
  }

  function renderCardToolbarIcon(state) {
    if (!state?.button) return;

    const iconName =
      settings.buttonIcon === "custom" && settings.customImage
        ? "custom"
        : BUTTON_ICONS[settings.buttonIcon]
          ? settings.buttonIcon
          : "not-interested";

    state.button.textContent = "";

    if (iconName === "custom") {
      const image = document.createElement("img");
      image.src = settings.customImage;
      image.alt = "";
      image.draggable = false;
      state.button.appendChild(image);
      return;
    }

    state.button.insertAdjacentHTML(
      "beforeend",
      BUTTON_ICONS[iconName] || BUTTON_ICONS["not-interested"]
    );
  }

  function applyCardToolbarMetrics(state) {
    if (!state?.button) return;

    const size = resolvedButtonSize();
    state.button.style.width = `${size}px`;
    state.button.style.height = `${size}px`;
  }

  function applyCardToolbarLabels(state) {
    if (!state?.button) return;

    state.button.title = state.isLive ? "屏蔽直播博主" : "屏蔽音乐 / 博主 / 标签";
    state.button.setAttribute(
      "aria-label",
      state.isLive ? "屏蔽直播博主" : "屏蔽音乐、博主或标签"
    );
  }

  // 卡片本来就是定位元素的话什么都不写；只有真是 static 时才补一次，
  // 并把原值记下来，清理时还原——不在抖音的元素上留痕。
  function ensureCardPositioned(card) {
    try {
      if (getComputedStyle(card).position !== "static") return false;
    } catch (_) {
      return false;
    }
    card.setAttribute(CARD_POSITION_ATTR, card.style.position || "");
    card.style.position = "relative";
    return true;
  }

  function createCardToolbar(card) {
    const state = {
      card,
      root: document.createElement("div"),
      button: document.createElement("button"),
      panel: document.createElement("div"),
      isLive: isLiveContainer(card),
      open: false,
      measured: false,
      metrics: null,
      layoutObserver: null,
      layoutNodes: new Set(),
      layoutFrame: null,
      wrotePosition: false
    };

    state.wrotePosition = ensureCardPositioned(card);

    state.root.className = "douyin-bgm-filter-toolbar";
    state.root.style.display = "none";
    state.button.className = "douyin-bgm-filter-button";
    state.button.type = "button";
    state.panel.className = "douyin-bgm-filter-panel";

    renderCardToolbarIcon(state);
    applyCardToolbarMetrics(state);
    applyCardToolbarLabels(state);

    state.root.append(state.button, state.panel);

    // 点击必须挡住，不能冒泡给抖音：卡片自己在监听 click / dblclick / mousedown
    // 做播放暂停、拖动进度、双击全屏。挂在 <html> 下时没这个问题，进了卡片就必须拦。
    // 只 stopPropagation，不 preventDefault，否则自己的按钮和选项会失效。
    for (const type of ["click", "dblclick", "mousedown", "pointerdown"]) {
      state.root.addEventListener(type, (event) => event.stopPropagation());
    }

    state.button.addEventListener("click", () => toggleCardPanel(state));

    // 注入到滚动项内部：这样它和视频共享同一个合成器滚动，滚动时无需任何 JS。
    card.appendChild(state.root);
    if (typeof ResizeObserver === "function") {
      state.layoutObserver = new ResizeObserver(() => scheduleCardLayout(state));
    }
    observeCardLayout(state);
    return state;
  }

  function disposeCardToolbar(state) {
    if (!state) return;

    closeCardPanel(state);
    state.layoutObserver?.disconnect();
    if (state.layoutFrame !== null) cancelAnimationFrame(state.layoutFrame);
    state.layoutNodes.clear();
    if (activeToolbar === state) activeToolbar = null;
    state.root?.remove();

    if (state.wrotePosition && state.card?.isConnected) {
      state.card.style.position = state.card.getAttribute(CARD_POSITION_ATTR) || "";
      state.card.removeAttribute(CARD_POSITION_ATTR);
    }

    cardToolbars.delete(state);
  }

  function disposeAllCardToolbars() {
    for (const state of [...cardToolbars]) disposeCardToolbar(state);
  }

  function toggleCardPanel(state) {
    if (state?.panel.classList.contains("open")) closeCardPanel(state);
    else openCardPanel(state);
  }

  function openCardPanel(state) {
    if (!state) return;
    if (openToolbar && openToolbar !== state) closeCardPanel(openToolbar);
    state.open = true;
    openToolbar = state;
    state.panel.classList.add("open");
    positionCardPanel(state);
    renderToolbarPanel(state);
  }

  function closeCardPanel(state) {
    if (!state) return;
    state.open = false;
    state.panel?.classList.remove("open");
    if (openToolbar === state) openToolbar = null;
  }

  // 面板开在按钮上方还是下方，点开这一刻判断一次就够：
  // 开面板时视频是静止的，滑动切视频时面板本来就会关掉。
  function positionCardPanel(state) {
    const rect = state.button.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    state.panel.classList.toggle("above", spaceBelow < 320 && rect.top > 320);
  }

  // 全局只注册一次（放进每卡片工厂里会按卡片数泄漏 document 监听）。
  document.addEventListener("click", (event) => {
    if (!openToolbar) return;
    if (openToolbar.root.contains(event.target)) return;
    closeCardPanel(openToolbar);
  });

  function createRow(label) {
    const row = document.createElement("div");
    row.className = "douyin-bgm-filter-row douyin-bgm-filter-section";

    const rowLabel = document.createElement("div");
    rowLabel.className = "douyin-bgm-filter-section-label";
    rowLabel.textContent = label;

    const chips = document.createElement("div");
    chips.className = "douyin-bgm-filter-chips";

    row.append(rowLabel, chips);
    return row;
  }

  function createChip(rule, text) {
    const label = document.createElement("label");
    label.className = "douyin-bgm-filter-chip";
    label.title = text;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = rule?.key || "";
    input.__douyinBgmFilterRule = rule || null;
    input.addEventListener("change", () => {
      label.classList.toggle("selected", input.checked);
    });

    label.append(input, document.createTextNode(text));
    return label;
  }

  function createUnavailableChip(text) {
    const chip = document.createElement("div");
    chip.className = "douyin-bgm-filter-chip disabled";
    chip.textContent = text;
    return chip;
  }

  function saveBlockedRules(rules, { liveTarget = null, isLive = false } = {}) {
    const cleanRules = (rules || []).filter(Boolean);
    if (!cleanRules.length) return;

    logEvent("info", "保存屏蔽规则", {
      rules: cleanRules.map((rule) => ({ key: rule.key, kind: rule.kind, label: rule.label }))
    });

    const now = Date.now();
    const previousBlocked = { ...settings.blocked };
    for (const rule of cleanRules) {
      settings.blocked[rule.key] = {
        key: rule.key,
        kind: rule.kind,
        value: rule.value,
        label: rule.label,
        addedAt: now
      };
    }

    try {
      const storage = chrome?.storage?.local;
      if (!storage) {
        settings.blocked = previousBlocked;
        return;
      }

      storage.set({ blocked: settings.blocked }, () => {
        // 忽略扩展重载/上下文失效导致的存储错误，避免影响页面。
        const error = chrome?.runtime?.lastError;
        if (error) {
          settings.blocked = previousBlocked;
          logEvent("error", "保存屏蔽规则失败", { message: error.message });
          showLiveNotice("保存规则失败，请重载扩展后重试。");
          return;
        }
        postSettingsToMain();
        if (isLive) {
          if (liveTarget) liveActions.run(liveTarget);
          else showLiveNotice("规则已保存，当前直播已切换，请在当前直播卡片上重试。");
        } else sendNativeNotInterested();
      });
    } catch (error) {
      settings.blocked = previousBlocked;
      logEvent("error", "保存屏蔽规则时抛错", { message: String(error?.message || error) });
    }

  }

  function liveIdentity(entry) {
    return entry ? entry.roomId || entry.authorId || normalizedText(entry.author) : "";
  }

  function currentLiveTarget() {
    const active = findActiveContainer();
    const node = active?.closest(LIVE_CONTAINER_SELECTOR) || active;
    if (!isLiveContainer(node)) return null;
    // 对着真正的当前卡片解析，而不是预加载的邻卡。
    const entry = findBestLiveEntryForCard(node);
    return { container: node, identity: liveIdentity(entry), entry };
  }

  function showLiveNotice(message) {
    let node = document.getElementById("douyin-live-notice");
    if (!node) {
      node = document.createElement("div");
      node.id = "douyin-live-notice";
      node.setAttribute("role", "status");
      node.style.cssText = "position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#222;color:#fff;padding:12px;border-radius:8px;max-width:80vw;pointer-events:none";
      document.documentElement.appendChild(node);
    }
    node.textContent = message;
    clearTimeout(showLiveNotice.timer);
    showLiveNotice.timer = setTimeout(() => node.remove(), 5000);
  }

  const liveActions = globalThis.DouyinLiveActions.create({ document, window, current: currentLiveTarget, log: logEvent, notice: showLiveNotice, invokeCallback: globalThis.DouyinNativeFeedback.invoke });

  function sendNativeNotInterested() {
    const event = new KeyboardEvent("keydown", {
      key: "r",
      code: "KeyR",
      keyCode: 82,
      which: 82,
      bubbles: true,
      cancelable: true
    });

    document.dispatchEvent(event);
  }

  function renderToolbarPanel(state) {
    if (!state?.panel || !state.panel.classList.contains("open")) return;

    const isLive = state.isLive;

    // 先尝试补数据，再取当前可用的条目：本地 SSR 解析是同步的，
    // 这样第一次点开面板就能显示内容，不用等第二次点击。
    // 只认这张卡片自己的数据，不拿相邻卡片兜底。
    if (!isLive) requestEntryForCard(state.card);
    const entry =
      (isLive
        ? findBestLiveEntryForCard(state.card)
        : findBestEntryForCard(state.card)) || {};
    state.panel.textContent = "";

    const title = document.createElement("div");
    title.className = "douyin-bgm-filter-panel-title";
    title.textContent = isLive ? "选择要屏蔽的博主" : "选择要屏蔽的内容";
    state.panel.appendChild(title);

    if (
      !entry.awemeId &&
      !entry.author &&
      !entry.authorId &&
      !entry.musicId &&
      !entry.title
    ) {
      const note = document.createElement("div");
      note.className = "douyin-bgm-filter-empty";
      note.textContent = isLive
        ? "当前直播博主数据还未识别到，可稍后重试。"
        : "当前视频数据还未识别到，可稍后重试。";
      state.panel.appendChild(note);
    }

    const authorRow = createRow("博主");
    const musicRule = musicRuleForEntry(entry);
    const authorRule = authorRuleForEntry(entry);
    const authorText = entry.author || entry.authorId || "未识别";

    if (authorRule) {
      authorRow.querySelector(".douyin-bgm-filter-chips").appendChild(
        createChip(authorRule, authorText)
      );
    } else {
      authorRow
        .querySelector(".douyin-bgm-filter-chips")
        .appendChild(createUnavailableChip("未识别到博主"));
    }

    const rows = [authorRow];
    if (!isLive) {
      const tagRow = createRow("标签");
      const tags = Array.isArray(entry.tags) ? entry.tags : [];

      if (!tags.length) {
        tagRow
          .querySelector(".douyin-bgm-filter-chips")
          .appendChild(createUnavailableChip("未识别到标签"));
      } else {
        for (const tag of tags.slice(0, 16)) {
          const rule = tagRuleForValue(tag);
          tagRow
            .querySelector(".douyin-bgm-filter-chips")
            .appendChild(createChip(rule, `#${tag}`));
        }
      }

      const musicRow = createRow("BGM");
      const musicText = entry.title
        ? `${entry.title}${entry.musicId ? ` · ${entry.musicId}` : ""}`
        : entry.musicId || "未识别";

      if (musicRule) {
        musicRow
          .querySelector(".douyin-bgm-filter-chips")
          .appendChild(createChip(musicRule, musicText));
      } else {
        musicRow
          .querySelector(".douyin-bgm-filter-chips")
          .appendChild(createUnavailableChip("未识别到 BGM"));
      }

      rows.push(tagRow, musicRow);
    }

    const actions = document.createElement("div");
    actions.className = "douyin-bgm-filter-actions";

    const cancelButton = document.createElement("button");
    cancelButton.className = "douyin-bgm-filter-button-secondary";
    cancelButton.type = "button";
    cancelButton.textContent = "取消";

    const blockButton = document.createElement("button");
    blockButton.className = "douyin-bgm-filter-button-primary";
    blockButton.type = "button";
    blockButton.textContent = "屏蔽";
    blockButton.disabled = true;

    const updateBlockButton = () => {
      blockButton.disabled = !state.panel.querySelector(
        ".douyin-bgm-filter-chip input:checked"
      );
    };

    state.panel.onchange = updateBlockButton;
    cancelButton.addEventListener("click", (event) => {
      event.stopPropagation();
      closeCardPanel(state);
    });

    blockButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const rules = Array.from(
        state.panel.querySelectorAll(".douyin-bgm-filter-chip input:checked")
      )
        .map((input) => input.__douyinBgmFilterRule)
        .filter(Boolean);

      const current = isLive ? currentLiveTarget() : null;
      const liveTarget = current?.container === state.card ? current : null;
      saveBlockedRules(rules, { liveTarget, isLive });
      closeCardPanel(state);
    });

    actions.append(cancelButton, blockButton);
    state.panel.append(...rows, actions);
    updateBlockButton();
  }

  function loadSettings() {
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

        // 按钮尺寸变了会让 X 偏移跟着变，所以套用尺寸后要作废缓存、重新量一次。
        for (const state of cardToolbars) {
          renderCardToolbarIcon(state);
          applyCardToolbarMetrics(state);
          state.measured = false;
          state.metrics = null;
        }
        postSettingsToMain();
        updateToolbarPosition();
      });
    } catch (_) {}
  }

  function scheduleBlockedFlush() {
    if (blockedHistorySaveTimer) return;
    blockedHistorySaveTimer = setTimeout(flushBlockedRecords, 0);
  }

  function saveBlockedRecord(record) {
    if (!record) return;

    pendingBlockedRecords.push(record);
    scheduleBlockedFlush();
  }

  function loadBlockedHistory() {
    try {
      const storage = chrome?.storage?.local;
      if (!storage) {
        blockedHistoryLoaded = true;
        return;
      }

      storage.get({ blockedHistory: [] }, (items) => {
        if (chrome?.runtime?.lastError) {
          blockedHistoryLoaded = true;
          return;
        }

        blockedHistory = Array.isArray(items?.blockedHistory)
          ? items.blockedHistory
          : [];
        blockedHistoryLoaded = true;
        if (pendingBlockedRecords.length) scheduleBlockedFlush();
      });
    } catch (_) {
      blockedHistoryLoaded = true;
    }
  }

  // 未就绪时直接返回，等历史加载完成或上一次写入回调再触发；
  // 旧实现在这里用 setTimeout(..., 0) 自排定时器，storage 不回调时会一直空转。
  function flushBlockedRecords() {
    blockedHistorySaveTimer = 0;

    if (!blockedHistoryLoaded || isSavingBlockedHistory) return;
    if (!pendingBlockedRecords.length) return;

    const records = pendingBlockedRecords;
    pendingBlockedRecords = [];
    blockedHistory = [...records, ...blockedHistory].slice(0, 200);
    isSavingBlockedHistory = true;

    try {
      const storage = chrome?.storage?.local;
      if (!storage) {
        isSavingBlockedHistory = false;
        return;
      }

      storage.set({ blockedHistory: [...blockedHistory] }, () => {
        // 忽略扩展重载/上下文失效导致的存储错误，避免影响页面；
        // 未写进去的记录留在内存里，下次继续尝试。
        void chrome?.runtime?.lastError;
        isSavingBlockedHistory = false;
        if (pendingBlockedRecords.length) scheduleBlockedFlush();
      });
    } catch (_) {
      isSavingBlockedHistory = false;
    }
  }

  function isLikelyActive(node) {
    if (!node?.isConnected) return false;

    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;

    const itemCenter = rect.top + rect.height / 2;
    const viewportCenter = window.innerHeight / 2;
    const tolerance = Math.max(rect.height * 0.35, window.innerHeight * 0.2);
    return Math.abs(itemCenter - viewportCenter) <= tolerance;
  }

  function isLiveContainer(node) {
    if (!node?.isConnected) return false;
    return Boolean(node.closest?.(LIVE_CONTAINER_SELECTOR));
  }

  function findActiveContainer() {
    const selectors = [
      '[data-e2e="feed-active-video"]',
      '[data-e2e="slide-list-item"][data-active="true"]',
      '[data-e2e="feed-item"][data-active="true"]',
      '[data-e2e="recommend-item"][data-active="true"]'
    ];

    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (isLikelyActive(node)) return node;
      }
    }

    const liveNodes = document.querySelectorAll?.(
      [
        '[data-e2e="feed-live"]',
        '[data-e2e="live-container"]',
        '[data-e2e="live-feed-item"]',
        '[data-e2e="webcast-feed-item"]'
      ].join(",")
    );

    for (const node of liveNodes || []) {
      if (!isLikelyActive(node)) continue;
      return (
        node.querySelector?.('[data-e2e="feed-active-video"]') || node
      );
    }

    const candidates = document.querySelectorAll(
      [
        '[data-e2e="feed-item"]',
        '[data-e2e="slide-list-item"]',
        '[data-e2e="recommend-item"]',
        '[data-e2e="video-card"]',
        '[data-e2e="feed-video"]'
      ].join(",")
    );

    for (const node of candidates) {
      if (isLikelyActive(node)) return node;
    }

    return null;
  }

  function findContainerAwemeId(node) {
    if (!node) return "";

    const attributes = [
      "data-e2e-vid",
      "data-aweme-id",
      "data-id",
      "data-item-id",
      "data-video-id",
      "data-vid"
    ];

    const roots = [
      node,
      node.closest?.(
        attributes.map((name) => `[${name}]`).join(",")
      )
    ].filter(Boolean);

    for (const root of roots) {
      for (const name of attributes) {
        const value = root.getAttribute?.(name);
        if (value) return value;
      }
    }

    const descendants = node.querySelectorAll?.(
      attributes.map((name) => `[${name}]`).join(",")
    );

    for (const descendant of Array.from(descendants || [])) {
      if (isLiveContainer(descendant)) continue;
      for (const name of attributes) {
        const value = descendant.getAttribute?.(name);
        if (value) return value;
      }
    }

    return "";
  }

  function nonLiveContainerText(node) {
    if (!node) return "";

    const clone = node.cloneNode?.(true);
    if (!clone) return node.textContent || "";

    for (const liveNode of Array.from(
      clone.querySelectorAll?.(LIVE_CONTAINER_SELECTOR) || []
    )) {
      liveNode.remove();
    }

    return clone.textContent || "";
  }

  function findLiveRoomIdForContainer(node) {
    if (!node) return "";

    const attributes = [
      "data-room-id",
      "data-live-room-id",
      "data-webcast-room-id",
      "data-roomid"
    ];
    const selector = attributes.map((name) => `[${name}]`).join(",");
    const candidates = [node, ...Array.from(node.querySelectorAll?.(selector) || [])];

    for (const candidate of candidates) {
      for (const name of attributes) {
        const value = candidate.getAttribute?.(name);
        if (value) return value;
      }
    }

    return "";
  }

  function findBestLiveEntryForCard(card) {
    if (!card || !isLiveContainer(card)) return null;

    const roomId = findLiveRoomIdForContainer(card);
    const text = normalizedText(card.textContent || "");
    let bestEntry = null;
    let bestScore = 0;
    const pageKey = `${window.location.pathname}${window.location.search}`;

    for (const entry of knownLiveEntries.values()) {
      if (entry.pageKey && entry.pageKey !== pageKey) continue;
      if (roomId && entry.roomId === roomId) return entry;

      let score = 0;
      const author = normalizedText(entry.author);
      const authorId = normalizedText(entry.authorId);
      if (author.length >= 2 && text.includes(author)) score += 3;
      if (authorId.length >= 4 && text.includes(authorId)) score += 2;

      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    if (bestEntry) return bestEntry;
    // The current anchor may be visible before its room response arrives.
    const anchor = Array.from(card.querySelectorAll?.('a[href*="/user/"]') || []).find((link) => String(link.textContent || "").trim());
    const author = String(anchor?.textContent || "").trim().replace(/^@/, "");
    const authorId = anchor?.getAttribute?.("href")?.match(/\/user\/([^/?#]+)/)?.[1] || "";
    return author ? { isLive: true, roomId, author, authorId, tags: [] } : null;
  }

  function findBestEntryForCard(card) {
    if (!card) return null;
    if (isLiveContainer(card)) return null;

    const containerId = findContainerAwemeId(card);

    if (containerId && knownEntries.has(containerId)) {
      return knownEntries.get(containerId);
    }

    const textRoot =
      card.matches?.('[data-e2e="feed-active-video"]')
        ? card
        : card.querySelector?.('[data-e2e="feed-active-video"]') || card;
    const text = normalizedText(nonLiveContainerText(textRoot));
    let bestEntry = null;
    let bestScore = 0;

    for (const entry of knownEntries.values()) {
      let score = 0;

      if (entry.author && text.includes(normalizedText(entry.author))) score += 3;
      if (entry.authorId && text.includes(normalizedText(entry.authorId))) score += 2;

      for (const tag of entry.tags || []) {
        if (text.includes(normalizedText(tag))) score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    return bestEntry;
  }

 function handleEntry(entry) {
    if (!entry) return;
    if (
      !entry.awemeId &&
      !entry.musicId &&
      !entry.title &&
      !entry.author &&
      !entry.authorId
    ) {
      return;
    }

    if (entry.isLive) {
      const liveKey = entry.roomId || entry.authorId || normalizedText(entry.author);
      if (liveKey) {
        knownLiveEntries.set(liveKey, entry);
        while (knownLiveEntries.size > 100) {
          knownLiveEntries.delete(knownLiveEntries.keys().next().value);
        }
      }
    } else if (entry.awemeId) {
      knownEntries.set(entry.awemeId, entry);
      while (knownEntries.size > MAX_KNOWN_ENTRIES) {
        const oldest = knownEntries.keys().next().value;
        knownEntries.delete(oldest);
        // 一起放掉请求标记，滚回旧视频时还能重新识别。
        requestedEntries.delete(oldest);
      }
    }

    // 预加载的相邻视频也会走到这里，只有「用户当前看的这个」才值得记一条，
    // 否则日志会被几十条无关记录刷掉。
    const isCurrentVideo = Boolean(lastRequestedAwemeId) && entry.awemeId === lastRequestedAwemeId;
    if (isCurrentVideo) {
      logEvent("info", "识别到当前视频的数据", {
        awemeId: entry.awemeId,
        author: entry.author,
        authorId: entry.authorId,
        musicId: entry.musicId,
        title: entry.title,
        tags: (entry.tags || []).length,
        source: entry.source
      });
    }

    // 新数据到了：重新对一遍卡片（可能有新卡片进场），并把还开着的面板按最新数据重绘。
    // 位置不依赖 entry，所以这条路径基本是空转，只有面板内容需要刷。
    const reopen = openToolbar;

    updateToolbarPosition();

    if (reopen && openToolbar === reopen) {
      renderToolbarPanel(reopen);
    }
  }

function decodeLocalScriptText(text) {
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

function extractLocalScriptString(text, key, fromIndex = 0) {
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

function extractTagsFromDescription(desc) {
  const tags = new Set();
  const matches = String(desc || "").match(/#([^#\s]+)/g) || [];
  for (const match of matches) {
    const tag = match
      .slice(1)
      .replace(/^#+/, "")
      .replace(/[，。！？.,!?]+$/, "");
    if (tag) tags.add(tag);
  }
  return Array.from(tags).slice(0, 30);
}

const SSR_AWEME_ID_KEYS = ['"awemeId"', '"aweme_id"'];
const MAX_LOCAL_SSR_BLOCK_CHARS = 140000;
const MAX_LOCAL_SSR_SCRIPT_CHARS = 6000000;
const localDecodedScriptCache = new WeakMap();

function decodeLocalScriptTextCached(script) {
  const cached = localDecodedScriptCache.get(script);
  if (typeof cached === "string") return cached;

  const decoded = decodeLocalScriptText(script.textContent || "");
  localDecodedScriptCache.set(script, decoded);
  return decoded;
}

// 找出这个 id 在脚本里的确切位置；找不到就返回 -1，绝不在这里做循环重扫。
function findLocalAwemeIndex(text, awemeId) {
  let best = -1;

  for (const key of SSR_AWEME_ID_KEYS) {
    let from = 0;

    for (let guard = 0; guard < 32; guard += 1) {
      const index = text.indexOf(key, from);
      if (index < 0) break;
      from = index + key.length;

      const head = text.slice(index, index + key.length + 80);
      const match = new RegExp(`^${key}\\s*:\\s*"([^"]*)"`).exec(head);
      if (!match || match[1] !== awemeId) continue;
      if (best < 0 || index < best) best = index;
      break;
    }
  }

  return best;
}

function extractLocalSsrEntry(awemeId) {
  if (!awemeId) return null;

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
    // 只有第 1 次真正做解码，之后命中同一个脚本直接用缓存。
    if (!rawText.includes(awemeId)) continue;
    if (rawText.length > MAX_LOCAL_SSR_SCRIPT_CHARS) continue;
    stats.withId += 1;

    const text = decodeLocalScriptTextCached(script);
    stats.decoded += 1;
    const startIndex = findLocalAwemeIndex(text, awemeId);
    if (startIndex < 0) continue;
    stats.idFound += 1;

    const block = text.slice(
      startIndex,
      Math.min(text.length, startIndex + MAX_LOCAL_SSR_BLOCK_CHARS)
    );
    const authorIndex = block.search(/"authorInfo"\s*:/);
    if (authorIndex < 0) continue;
    stats.authorFound += 1;

    const author = extractLocalScriptString(block, "nickname", authorIndex);
    const authorId = extractLocalScriptString(block, "uid", authorIndex);
    const musicIndex = block.search(/"music"\s*:/);
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

  logEvent("info", "本地 SSR 没有解析出视频数据", {
    awemeId,
    ms: Date.now() - started,
    ...stats
  });

  return null;
}

function requestEntryForCard(card) {
  let containerId = findContainerAwemeId(card);
  let idSource = containerId ? "dom" : "";
  if (!containerId) {
    try {
      containerId =
        new URLSearchParams(window.location.search).get("modal_id") || "";
      if (containerId) idSource = "modal_id";
    } catch (_) {}
  }
  if (!containerId) {
    // /video/<id> 这类详情页地址栏里没有 modal_id，直接从路径里取。
    const pathMatch = window.location.pathname.match(/\/video\/(\d{6,})/);
    if (pathMatch) {
      containerId = pathMatch[1];
      idSource = "url-path";
    }
  }

  if (!containerId) return;
  if (knownEntries.has(containerId) || requestedEntries.has(containerId)) return;

  requestedEntries.add(containerId);
  lastRequestedAwemeId = containerId;
  logEvent("info", "开始识别当前视频", { awemeId: containerId, from: idSource });

  const ssrStarted = Date.now();
  const localEntry = extractLocalSsrEntry(containerId);
  if (localEntry) {
    logEvent("info", "本地 SSR 解析成功", {
      awemeId: containerId,
      ms: Date.now() - ssrStarted
    });
    handleEntry(localEntry);
    return;
  }

  logEvent("info", "本地 SSR 未命中，改为向数据层查询", {
    awemeId: containerId,
    ms: Date.now() - ssrStarted
  });

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

// 普通卡片必须有自身的视频；直播以独立直播节点为准，也支持没有 video 的预览。
// 普通视频里的直播缩略图不再独立注入按钮。
function findCards() {
  const found = [];
  let nodes;
  try {
    nodes = document.querySelectorAll(CARD_SELECTOR);
  } catch (_) {
    return found;
  }

  for (const node of nodes) {
    const isLive = isLiveContainer(node);
    const videos = Array.from(node.querySelectorAll?.("video") || []);
    if (!isLive && !videos.some((video) => !isLiveContainer(video))) continue;
    if (found.some((outer) => outer.contains(node))) continue;
    found.push(node);
  }
  return found;
}

function findCardToolbar(card) {
  if (!card) return null;
  for (const state of cardToolbars) {
    if (state.card === card) return state;
  }
  return null;
}

// findActiveContainer() 可能给出内层节点（例如 slide-list-item 里的 feed-active-video），
// 而我们注入的是外层卡片。只按相等匹配会让"正在看的卡片"认不出来，
// 面板一打开就被误判成换了卡片而关掉。候选卡片已去重为最外层，所以 contains 不会串台。
function toolbarForNode(node) {
  if (!node) return null;
  for (const state of cardToolbars) {
    if (state.card === node || state.card.contains(node)) return state;
  }
  return null;
}

function largestVideoRect(card, includeLive) {
  const videos = Array.from(card.querySelectorAll?.("video") || []).filter(
    (video) => includeLive || !isLiveContainer(video)
  );
  let best = null;
  let bestArea = 0;

  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      best = rect;
    }
  }

  return best?.width && best?.height ? best : null;
}

// getBoundingClientRect 给的是变换后的视口坐标，而 absolute 的 top/left 在卡片的
// 局部坐标系里解析。卡片带 transform: scale() 时两者差一个系数，必须除掉。
function cardTransformScale(card) {
  try {
    const transform = getComputedStyle(card).transform;
    if (!transform || transform === "none") return { x: 1, y: 1 };
    const matrix = new DOMMatrixReadOnly(transform);
    return { x: matrix.a || 1, y: matrix.d || 1 };
  } catch (_) {
    return { x: 1, y: 1 };
  }
}

const CARD_MEASURE_RETRIES = 5;

// 只响应实际布局变化，不在 update / scroll 或常驻帧循环里跟踪坐标。
// 评论展开可能只改变视频或操作栏的容器，外层卡片尺寸保持不变。
function observeCardLayout(state) {
  if (!state.layoutObserver) return;
  const nodes = new Set([state.card]);
  for (const target of state.card.querySelectorAll(`video, ${RAIL_SELECTOR}`)) {
    for (let node = target; node && node !== state.card; node = node.parentElement) {
      nodes.add(node);
    }
  }
  for (const node of state.layoutNodes) {
    if (!nodes.has(node)) state.layoutObserver.unobserve(node);
  }
  for (const node of nodes) {
    if (!state.layoutNodes.has(node)) state.layoutObserver.observe(node);
  }
  state.layoutNodes = nodes;
}

function scheduleCardLayout(state) {
  if (!state.card.isConnected || !cardToolbars.has(state)) return;
  if (state.layoutFrame !== null) return;
  state.layoutFrame = requestAnimationFrame(() => {
    state.layoutFrame = null;
    if (!state.card.isConnected || !cardToolbars.has(state)) return;
    repositionCardToolbar(state);
    if (state.open) positionCardPanel(state);
  });
}

// 卡片内偏移量与滚动无关；初次排版、尺寸变化和布局动画结束时才重算。
function repositionCardToolbar(state, retries = CARD_MEASURE_RETRIES) {
  const card = state?.card;
  if (!card?.isConnected) return;

  const cardRect = card.getBoundingClientRect();
  if (!cardRect.width || !cardRect.height) {
    // 还没排版。宁可不出现，也别先出现在错位置再跳（0.5.23 的教训）。
    state.root.style.display = "none";
    state.measured = false;
    if (retries > 0) {
      requestAnimationFrame(() => repositionCardToolbar(state, retries - 1));
    }
    return;
  }

  const targetRect = largestVideoRect(card, state.isLive) || cardRect;
  const rail = findRailForTarget(card, targetRect);
  const anchorCenterX = rail
    ? rail.rect.right - (rail.paddingRight + RAIL_COLUMN_WIDTH / 2) * rail.scale
    : targetRect.right - RAIL_CENTER_INSET_FALLBACK;

  const scale = cardTransformScale(card);
  const size = resolvedButtonSize();
  const metrics = {
    top: Math.max(10, Math.round((targetRect.top - cardRect.top) / scale.y + 10)),
    left: Math.max(8, Math.round((anchorCenterX - cardRect.left) / scale.x - size / 2)),
    w: Math.round(cardRect.width),
    h: Math.round(cardRect.height)
  };

  const previous = state.metrics;
  const unchanged =
    previous &&
    previous.top === metrics.top &&
    previous.left === metrics.left &&
    previous.w === metrics.w &&
    previous.h === metrics.h;

  if (!unchanged) {
    state.root.style.top = `${metrics.top}px`;
    state.root.style.left = `${metrics.left}px`;
  }
  state.root.style.display = "block";
  state.metrics = metrics;

  // 操作栏比按钮晚渲染时，先用兜底几何（±2px）把按钮显示出来，
  // 下一帧找到真实容器再静默修正——修正幅度小于肉眼可辨的跳动。
  if (!rail && retries > 0) {
    requestAnimationFrame(() => repositionCardToolbar(state, retries - 1));
    return;
  }

  if (!state.measured) {
    state.measured = true;
    reportAnchorDrift(card, anchorCenterX, targetRect);
    logEvent("info", "卡片内工具栏已定位", {
      cardDataE2e: card.getAttribute?.("data-e2e") || "",
      cardPosition: getComputedStyle(card).position,
      wrotePosition: state.wrotePosition,
      cardW: metrics.w,
      cardH: metrics.h,
      target: targetRect === cardRect ? "card" : "video",
      railFound: Boolean(rail),
      railPaddingRight: rail?.paddingRight ?? null,
      railScale: rail?.scale ?? null,
      buttonSize: size,
      top: metrics.top,
      left: metrics.left
    });
  }
}

// 补齐/清理卡片按钮。幂等：状态没变时不写任何 DOM。
function toolbarAllowedOnPage() {
  return !/^\/follow(?:\/|$)/.test(window.location.pathname);
}

function reconcileCardToolbar() {
  if (!settings.enabled || !toolbarAllowedOnPage()) {
    disposeAllCardToolbars();
    return;
  }

  activeContainer = findActiveContainer();
  const cards = findCards();

  if (!cards.length) {
    disposeAllCardToolbars();
    return;
  }

  const wanted = new Set(cards);
  for (const state of [...cardToolbars]) {
    if (!wanted.has(state.card) || !state.card.isConnected) disposeCardToolbar(state);
  }

  for (const card of cards) {
    const state = findCardToolbar(card);

    if (!state) {
      const created = createCardToolbar(card);
      cardToolbars.add(created);
      repositionCardToolbar(created);
      continue;
    }

    // 评论或播放器重渲染时重新绑定目标，同时释放被替换的节点。
    observeCardLayout(state);

    // 被页面重渲染摘掉了：补回去，重量一次。
    if (state.root.parentNode !== card) {
      ensureCardPositioned(card);
      card.appendChild(state.root);
      state.measured = false;
      state.metrics = null;
      repositionCardToolbar(state);
      continue;
    }

    const isLive = isLiveContainer(card);
    if (state.isLive !== isLive) {
      state.isLive = isLive;
      applyCardToolbarLabels(state);
      closeCardPanel(state);
      repositionCardToolbar(state);
      continue;
    }

    if (!state.measured) repositionCardToolbar(state);
  }

  activeToolbar = toolbarForNode(activeContainer);
  if (openToolbar && openToolbar !== activeToolbar) closeCardPanel(openToolbar);
}

function updateToolbarPosition() {
  reconcileCardToolbar();
}

function refreshToolbarLayout() {
  reconcileCardToolbar();
  for (const state of cardToolbars) scheduleCardLayout(state);
}

function scheduleToolbarPosition() {
    clearTimeout(toolbarPositionTimer);
    toolbarPositionTimer = setTimeout(updateToolbarPosition, 150);
  }

  // 找出与目标视频重叠最多的操作栏容器，并读出它自己的盒模型参数。
  // 预加载的下一个视频也可能有同样的容器，所以按重叠量挑，不能取第一个。
  // 返回 null 表示没找到——调用方据此判断这次测量是不是可信的。
  function findRailForTarget(container, targetRect) {
    try {
      const rails = container?.querySelectorAll?.(RAIL_SELECTOR);
      if (!rails?.length) return null;

      let best = null;
      let bestOverlap = -1;
      for (const candidate of rails) {
        const rect = candidate.getBoundingClientRect();
        if (!rect.width) continue;
        const overlap =
          Math.min(rect.bottom, targetRect.bottom) - Math.max(rect.top, targetRect.top);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = { element: candidate, rect };
        }
      }
      if (!best) return null;

      const style = getComputedStyle(best.element);
      const matrix = /matrix\(([-\d.]+)/.exec(style.transform || "");
      return {
        rect: best.rect,
        paddingRight: parseFloat(style.paddingRight) || 0,
        scale: matrix ? Number(matrix[1]) || 1 : 1
      };
    } catch (_) {
      return null;
    }
  }

  // 按抖音操作栏容器自己的盒模型算出图标中心 X：
  //   容器右边缘 −（内边距 + 列宽/2）× 缩放
  // 这样换窗口大小、换视频都一致，也不需要去看点赞图标在哪。
  // 返回视口坐标；卡片内定位再减去卡片左边缘。
  function computeRailCenterX(container, targetRect) {
    const rail = findRailForTarget(container, targetRect);
    if (!rail) return targetRect.right - RAIL_CENTER_INSET_FALLBACK;
    return rail.rect.right - (rail.paddingRight + RAIL_COLUMN_WIDTH / 2) * rail.scale;
  }

  // 只做诊断：我们不再用点赞图标定位，但如果算出来的 X 和真实图标中心差得多，
  // 说明抖音换了布局，往日志里记一条（不改变按钮位置，避免又跳一下）。
  function reportAnchorDrift(container, anchorCenterX, targetRect) {
    try {
      const digg = container?.querySelector?.('[data-e2e="video-player-digg"]');
      const diggRect = digg?.getBoundingClientRect();
      if (!diggRect?.width) return;

      const drift = Math.round(diggRect.left + diggRect.width / 2 - anchorCenterX);
      if (Math.abs(drift) <= 6) {
        lastAnchorDrift = drift;
        return;
      }

      if (lastAnchorDrift !== null && Math.abs(lastAnchorDrift - drift) <= 2) return;
      lastAnchorDrift = drift;
      logEvent("info", "按几何算出的按钮 X 与点赞图标中心有偏差", {
        drift,
        videoRight: Math.round(targetRect.right),
        anchorCenterX: Math.round(anchorCenterX)
      });
    } catch (_) {}
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data;
    if (data?.source !== MESSAGE_SOURCE) return;
    if (data.type === "entry" && data.entry) handleEntry(data.entry);
    if (data.type === "entry-not-found" && data.awemeId) {
      requestedEntries.delete(data.awemeId);
    }
    if (data.type === "blocked" && data.record) saveBlockedRecord(data.record);
    if (data.type === "log" && data.record) {
      logEvent(data.record.level || "info", data.record.message || "", data.record.data);
    }
    if (data.type === "ready") postSettingsToMain();
  });

  try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.blockedHistory) {
      blockedHistory = Array.isArray(changes.blockedHistory.newValue)
        ? changes.blockedHistory.newValue
        : [];
      blockedHistoryLoaded = true;
    }
    if (SETTINGS_KEYS.some((key) => changes[key])) loadSettings();
  });
  } catch (_) {}

  const observer = new MutationObserver((records) => {
    if (!settings.enabled) return;

    // 我们自己往卡片里插按钮也会触发 childList，必须滤掉，否则会自激。
    // 只判断 record.target.closest 不够：追加工具栏时 target 是卡片本身，不在工具栏内，
    // 所以还要看 addedNodes 是不是清一色的工具栏节点。
    const onlySelf = records.every((record) => {
      if (record.target instanceof Element && record.target.closest?.(".douyin-bgm-filter-toolbar")) {
        return true;
      }
      return (
        record.addedNodes.length > 0 &&
        Array.from(record.addedNodes).every(
          (node) =>
            node instanceof Element &&
            node.classList?.contains("douyin-bgm-filter-toolbar")
        )
      );
    });
    if (onlySelf) return;

    scheduleToolbarPosition();
  });

  function startObserver() {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  injectStyle();
  loadSettings();
  loadBlockedHistory();
  startObserver();
  loadPreviousDebugLog();
  logEvent("info", "扩展在页面上启动", {
    version: chrome?.runtime?.getManifest?.().version || "",
    scriptsAtStart: document.scripts.length,
    toolbarMode: "card"
  });

  // 没有 scroll 监听：按钮长在卡片里，滚动由浏览器负责，扩展不参与。
  window.addEventListener("resize", refreshToolbarLayout);
  document.addEventListener("fullscreenchange", refreshToolbarLayout);
  // transform / 位移动画不会触发 ResizeObserver，跟随页面动画结束修正最终位置。
  for (const type of ["transitionend", "transitioncancel", "animationend", "animationcancel"]) {
    document.addEventListener(type, (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(".douyin-bgm-filter-toolbar")) return;
      for (const state of cardToolbars) {
        if (state.layoutNodes.has(target) || target.contains(state.card)) scheduleCardLayout(state);
      }
    }, true);
  }
  window.addEventListener("popstate", updateToolbarPosition);
  window.addEventListener("pageshow", updateToolbarPosition);
  window.navigation?.addEventListener("currententrychange", updateToolbarPosition);
})();

