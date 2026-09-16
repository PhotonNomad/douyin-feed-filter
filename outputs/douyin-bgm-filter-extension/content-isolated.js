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
  const requestedEntries = new Set();

  let activeContainer = null;
  let toolbar = null;
  let toolbarButton = null;
  let toolbarPanel = null;
  let lastToolbarContainer = null;
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

    return null;
  }

  function injectStyle() {
    if (document.getElementById("douyin-bgm-filter-style")) return;

    const style = document.createElement("style");
    style.id = "douyin-bgm-filter-style";
    style.textContent = `
      .douyin-bgm-filter-toolbar {
        position: fixed;
        z-index: 2147483000;
        pointer-events: none;
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
        overflow: auto;
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

  function renderToolbarButtonIcon() {
    if (!toolbarButton) return;

    const iconName =
      settings.buttonIcon === "custom" && settings.customImage
        ? "custom"
        : BUTTON_ICONS[settings.buttonIcon]
          ? settings.buttonIcon
          : "not-interested";

    toolbarButton.textContent = "";

    if (iconName === "custom") {
      const image = document.createElement("img");
      image.src = settings.customImage;
      image.alt = "";
      image.draggable = false;
      toolbarButton.appendChild(image);
      return;
    }

    toolbarButton.insertAdjacentHTML(
      "beforeend",
      BUTTON_ICONS[iconName] || BUTTON_ICONS["not-interested"]
    );
  }

  function applyToolbarButtonMetrics() {
    if (!toolbarButton) return;

    const size = Math.min(
      56,
      Math.max(32, Number(settings.buttonSize) || 40)
    );

    toolbarButton.style.width = `${size}px`;
    toolbarButton.style.height = `${size}px`;
  }

  function findActionRailIcons(container) {
    if (!container?.isConnected) return [];

    const selector = ACTION_RAIL_SELECTORS.join(",");
    const nodes = Array.from(container.querySelectorAll(selector));
    const visibleNodes = nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    if (!visibleNodes.length) {
      const documentNodes = Array.from(document.querySelectorAll(selector)).filter(
        (node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
      );

      if (documentNodes.length) {
        const groups = new Map();
        for (const node of documentNodes) {
          const rect = node.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const groupKey = Math.round(centerX / 12);
          if (!groups.has(groupKey)) groups.set(groupKey, []);
          groups.get(groupKey).push(node);
        }

        const containerRect = container.getBoundingClientRect();
        const containerRightEdge = containerRect.right;
        let bestGroup = [];
        let bestScore = Infinity;

        for (const group of groups.values()) {
          const groupCenterX =
            group.reduce((sum, node) => {
              const rect = node.getBoundingClientRect();
              return sum + rect.left + rect.width / 2;
            }, 0) / group.length;

          const score =
            Math.abs(groupCenterX - containerRightEdge) -
            group.length * 2;

          if (score < bestScore) {
            bestScore = score;
            bestGroup = group;
          }
        }

        if (bestGroup.length) {
          return bestGroup.sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            return aRect.top - bRect.top || aRect.left - bRect.left;
          });
        }
      }
    }

    return visibleNodes.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return aRect.top - bRect.top || aRect.left - bRect.left;
    });
  }

  function positionToolbarToActionRail(icons) {
    if (!icons.length || !toolbar || !toolbarButton) return false;

    const firstIcon = icons[0];
    const lastIcon = icons[icons.length - 1];
    const anchorIcon =
      icons.find((icon) => icon.matches?.('[data-e2e="video-player-share"]')) ||
      icons.find((icon) => icon.matches?.('[data-e2e="video-player-collect"]')) ||
      lastIcon;
    const firstRect = firstIcon.getBoundingClientRect();
    const lastRect = anchorIcon.getBoundingClientRect();
    const buttonRect = toolbarButton.getBoundingClientRect();
    const buttonSize = buttonRect.width || 40;
    const previousIcon = icons.length > 1 ? icons[icons.length - 2] : null;
    const gap = previousIcon
      ? Math.max(
          6,
          Math.round(
            lastRect.top - previousIcon.getBoundingClientRect().bottom
          )
        )
      : 10;

    const centerX =
      icons.reduce((sum, icon) => {
        const rect = icon.getBoundingClientRect();
        return sum + rect.left + rect.width / 2;
      }, 0) / icons.length;

    let top = lastRect.bottom + gap;
    if (top + buttonSize > window.innerHeight - 12) {
      top = firstRect.top - gap - buttonSize;
    }

    const left = centerX - buttonSize / 2;
    toolbar.style.display = "block";
    toolbar.style.top = `${Math.max(12, top)}px`;
    toolbar.style.left = `${Math.max(12, left)}px`;
    toolbar.style.right = "auto";

    const spaceBelow = window.innerHeight - (top + buttonSize);
    const spaceAbove = top;
    toolbarPanel?.classList.toggle(
      "above",
      spaceBelow < 340 && spaceAbove > 340
    );

    return true;
  }

  function ensureToolbar() {
    if (toolbar?.isConnected) return;

    toolbar = document.createElement("div");
    toolbar.className = "douyin-bgm-filter-toolbar";
    toolbar.style.display = "none";

    toolbarButton = document.createElement("button");
    toolbarButton.className = "douyin-bgm-filter-button";
    toolbarButton.title = "屏蔽音乐 / 博主 / 标签";
    toolbarButton.setAttribute("aria-label", "屏蔽音乐、博主或标签");
    toolbarButton.type = "button";

    renderToolbarButtonIcon();
    applyToolbarButtonMetrics();

    toolbarPanel = document.createElement("div");
    toolbarPanel.className = "douyin-bgm-filter-panel";

    toolbar.append(toolbarButton, toolbarPanel);
    document.documentElement.appendChild(toolbar);

    toolbarButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toolbarPanel.classList.toggle("open");
      renderToolbarPanel();
    });

    document.addEventListener("click", (event) => {
      if (!toolbarPanel.classList.contains("open")) return;
      if (toolbarPanel.contains(event.target)) return;
      toolbarPanel.classList.remove("open");
    });
  }

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

  function saveBlockedRules(rules) {
    const cleanRules = (rules || []).filter(Boolean);
    if (!cleanRules.length) return;

    const now = Date.now();
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
      if (!storage) return;

      storage.set({ blocked: settings.blocked }, () => {
        // 忽略扩展重载/上下文失效导致的存储错误，避免影响页面。
      });
    } catch (_) {}

    sendNativeNotInterested();
  }

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

  function renderToolbarPanel() {
    if (!toolbarPanel || !toolbarPanel.classList.contains("open")) return;

    const entry = findBestEntryForActiveContainer() || {};
    requestEntryForActiveContainer();
    toolbarPanel.textContent = "";

    const title = document.createElement("div");
    title.className = "douyin-bgm-filter-panel-title";
    title.textContent = "选择要屏蔽的内容";
    toolbarPanel.appendChild(title);

    if (!entry.awemeId && !entry.author && !entry.musicId && !entry.title) {
      const note = document.createElement("div");
      note.className = "douyin-bgm-filter-empty";
      note.textContent = "当前视频数据还未识别到，可稍后重试。";
      toolbarPanel.appendChild(note);
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
      blockButton.disabled = !toolbarPanel.querySelector(
        ".douyin-bgm-filter-chip input:checked"
      );
    };

    toolbarPanel.onchange = updateBlockButton;
    cancelButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toolbarPanel.classList.remove("open");
    });

    blockButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const rules = Array.from(
        toolbarPanel.querySelectorAll(".douyin-bgm-filter-chip input:checked")
      )
        .map((input) => input.__douyinBgmFilterRule)
        .filter(Boolean);

      saveBlockedRules(rules);
      toolbarPanel.classList.remove("open");
    });

    actions.append(cancelButton, blockButton);
    toolbarPanel.append(authorRow, tagRow, musicRow, actions);
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

        renderToolbarButtonIcon();
        applyToolbarButtonMetrics();
        postSettingsToMain();
        updateToolbarPosition();
      });
    } catch (_) {}
  }

  function saveBlockedRecord(record) {
    if (!record) return;

    pendingBlockedRecords.push(record);

    if (!blockedHistorySaveTimer) {
      blockedHistorySaveTimer = setTimeout(flushBlockedRecords, 0);
    }
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
        if (pendingBlockedRecords.length) flushBlockedRecords();
      });
    } catch (_) {
      blockedHistoryLoaded = true;
    }
  }

  function flushBlockedRecords() {
    blockedHistorySaveTimer = 0;

    if (!blockedHistoryLoaded || isSavingBlockedHistory) {
      if (!blockedHistorySaveTimer) {
        blockedHistorySaveTimer = setTimeout(flushBlockedRecords, 0);
      }
      return;
    }

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
        if (chrome?.runtime?.lastError) {
          // 保留内存记录，避免页面报错；下次仍会尝试同步。
        }
        isSavingBlockedHistory = false;
      });
    } catch (_) {
      isSavingBlockedHistory = false;
    }
  }

  function isLikelyActive(node) {
    if (!node?.isConnected) return false;

    if (
      node.matches?.('[data-e2e="feed-active-video"]') ||
      node.querySelector?.('[data-e2e="feed-active-video"]')
    ) {
      return true;
    }

    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const itemCenter = rect.top + rect.height / 2;
    const viewportCenter = window.innerHeight / 2;
    const tolerance = Math.max(rect.height * 0.35, window.innerHeight * 0.2);
    return Math.abs(itemCenter - viewportCenter) <= tolerance;
  }

  function isLiveContainer(node) {
    if (!node?.isConnected) return false;

    const liveSelector = [
      '[data-e2e="feed-live"]',
      '[data-e2e="live-container"]',
      '[data-e2e="live-feed-item"]',
      '[data-e2e="webcast-feed-item"]'
    ].join(",");

    return Boolean(
      node.closest?.(liveSelector) || node.querySelector?.(liveSelector)
    );
  }

  function nodeMatchesAwemeId(node, awemeId) {
    if (!node || !awemeId) return false;

    const candidates = [
      node.getAttribute?.("data-aweme-id"),
      node.getAttribute?.("data-id"),
      node.getAttribute?.("data-item-id"),
      node.getAttribute?.("data-video-id"),
      node.getAttribute?.("data-vid"),
      node.getAttribute?.("data-e2e")
    ];

    return candidates.some((value) => {
      if (!value) return false;
      return value === awemeId || value.endsWith(`-${awemeId}`);
    });
  }

  function findAwemeNodes(awemeId) {
    if (!awemeId) return [];

    const selector = [
      "[data-aweme-id]",
      "[data-id]",
      "[data-item-id]",
      "[data-video-id]",
      "[data-vid]",
      "[data-e2e]"
    ].join(",");

    return Array.from(document.querySelectorAll(selector)).filter((node) =>
      nodeMatchesAwemeId(node, awemeId)
    );
  }

  function containerForNode(node) {
    return (
      node.closest?.(
        [
          '[data-e2e="feed-item"]',
          '[data-e2e="feed-active-video"]',
          '[data-e2e="slide-list-item"]',
          '[data-e2e="recommend-item"]',
          '[data-e2e="video-card"]',
          '[data-e2e="feed-video"]'
        ].join(",")
      ) || node
    );
  }

  function findActiveContainer() {
    const selectors = [
      '[data-e2e="feed-active-video"]',
      '[data-e2e="slide-list-item"][data-active="true"]',
      '[data-e2e="feed-item"][data-active="true"]',
      '[data-e2e="recommend-item"][data-active="true"]'
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) return node;
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
      for (const name of attributes) {
        const value = descendant.getAttribute?.(name);
        if (value) return value;
      }
    }

    return "";
  }

  function findBestEntryForActiveContainer() {
    if (!activeContainer) return null;
    if (isLiveContainer(activeContainer)) return null;

    const containerId = findContainerAwemeId(activeContainer);

    if (containerId && knownEntries.has(containerId)) {
      return knownEntries.get(containerId);
    }

    const textRoot =
      activeContainer.matches?.('[data-e2e="feed-active-video"]')
        ? activeContainer
        : activeContainer.querySelector?.('[data-e2e="feed-active-video"]') ||
          activeContainer;
    const text = normalizedText(textRoot.textContent || "");
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
  if (!entry.awemeId && !entry.musicId && !entry.title && !entry.author) return;

  if (entry.awemeId) {
    knownEntries.set(entry.awemeId, entry);
  }

  updateToolbarPosition();
  if (toolbarPanel?.classList.contains("open")) {
    renderToolbarPanel();
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

function extractLocalSsrEntry(awemeId) {
  if (!awemeId) return null;

  for (const script of document.scripts) {
    const rawText = script.textContent || "";
    if (!rawText.includes("awemeId")) continue;

    const text = decodeLocalScriptText(rawText);
    const match = text.match(
      new RegExp(`"awemeId"\\s*:\\s*"${awemeId}"`)
    );
    if (!match) continue;

    const startIndex = match.index;
    const block = text.slice(startIndex, startIndex + 140000);
    const authorIndex = block.search(/"authorInfo"\\s*:/);
    if (authorIndex < 0) continue;

    const author = extractLocalScriptString(block, "nickname", authorIndex);
    const authorId = extractLocalScriptString(block, "uid", authorIndex);
    const musicIndex = block.search(/"music"\\s*:/);
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

  const digg = activeContainer.querySelector?.('[data-e2e="video-player-digg"]');
  const buttonSize = toolbarButton?.getBoundingClientRect().width || 40;
  const diggRect = digg?.getBoundingClientRect();

  toolbar.style.display = "block";
  toolbar.style.position = "fixed";
  toolbar.style.top = `${Math.max(10, targetRect.top + 10)}px`;

  if (diggRect?.width) {
    const diggCenter = diggRect.left + diggRect.width / 2;
    toolbar.style.left = `${Math.max(8, diggCenter - buttonSize / 2)}px`;
    toolbar.style.right = "auto";
  } else {
    toolbar.style.left = "auto";
    toolbar.style.right = `${Math.max(10, window.innerWidth - targetRect.right + 10)}px`;
  }

  toolbar.style.width = "";
  toolbar.style.height = "";
  toolbar.style.margin = "";

  const spaceBelow = window.innerHeight - targetRect.bottom;
  toolbarPanel.classList.toggle(
    "above",
    spaceBelow < 320 && targetRect.top > 320
  );
}

function scheduleToolbarPosition() {
    clearTimeout(toolbarPositionTimer);
    toolbarPositionTimer = setTimeout(updateToolbarPosition, 150);
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
    loadSettings();
  });
  } catch (_) {}

  const observer = new MutationObserver(() => {
    if (!settings.enabled) return;
    scheduleToolbarPosition();
  });

  function startObserver() {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  injectStyle();
  ensureToolbar();
  loadSettings();
  loadBlockedHistory();
  startObserver();

  window.addEventListener("scroll", updateToolbarPosition, { passive: true });
  window.addEventListener("resize", updateToolbarPosition);
  window.addEventListener("fullscreenchange", updateToolbarPosition);
})();

