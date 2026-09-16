/**
 * 用 CDP（Chrome DevTools Protocol）自动复现并抓取抖音视频屏蔽扩展的问题。
 *
 * 特点：不依赖任何 npm 包，只用 Node 内置的 fetch + WebSocket（Node 22+）。
 *
 * 用法：
 *   node work/cdp-debug.js --url="https://www.douyin.com/jingxuan?modal_id=..." --click
 *   node work/cdp-debug.js --url="https://www.douyin.com/?recommend=1" --seconds=25
 *
 * 产物：
 *   work/logs/<时间戳>/report.md   人读的汇总（报错、卡顿、按钮/面板状态）
 *   work/logs/<时间戳>/events.json 原始事件（控制台、异常、长任务、失败请求）
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEFAULT_EXT =
  "C:\\Users\\issues\\Documents\\Codex\\2026-09-06\\wo\\outputs\\douyin-bgm-filter-extension";

function parseArgs(argv) {
  const opts = {
    url: "",
    ext: DEFAULT_EXT,
    chrome: DEFAULT_CHROME,
    seconds: 20,
    afterClick: 20,
    click: false,
    headless: false,
    port: 9400 + Math.floor(Math.random() * 400),
    keepProfile: false,
    outDir: "",
    probe: "",
    test: "",
    walk: 0,
    profileDir: "",
    visible: false,
    keepOpen: false,
    attach: 0,
    seedProfile: "",
    windowSize: "1360,900"
  };
  for (const arg of argv) {
    const m = /^--([a-zA-Z]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "click") opts.click = true;
    else if (key === "headless") opts.headless = true;
    else if (key === "keepProfile") opts.keepProfile = true;
    else if (key === "visible") opts.visible = true;
    else if (key === "keepOpen") opts.keepOpen = true;
    else if (key in opts) opts[key] = /^\d+$/.test(value || "") ? Number(value) : value;
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params, msg);
        for (const fn of this.listeners.get("*") || []) fn(msg);
      }
    });
  }

  send(method, params = {}, sessionId, timeoutMs = 30000) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, timeoutMs);
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

async function waitForEndpoint(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error(`等不到 Chrome 调试端口 ${port}`);
}

async function findPageTarget(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
      const page = pages.find((t) => /douyin\.com/.test(t.url || "")) || pages[0];
      if (page) return page;
    } catch {
      /* 重试 */
    }
    await sleep(200);
  }
  throw new Error("找不到可调试的页面目标");
}

// 在页面加载前注入：长任务、未捕获异常、未处理的 Promise 拒绝
const HOOK_SCRIPT = `
  (() => {
    window.__dbgLongTasks = window.__dbgLongTasks || [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__dbgLongTasks.push({
            start: Math.round(e.startTime),
            duration: Math.round(e.duration),
            attribution: (e.attribution || []).map((a) => a.name + (a.containerSrc ? "@" + a.containerSrc : ""))
          });
        }
      }).observe({ entryTypes: ["longtask"] });
    } catch (_) {}
    window.addEventListener("error", (e) => {
      console.error("__DBG_ERROR__ " + JSON.stringify({
        message: e.message, file: e.filename, line: e.lineno, column: e.colno,
        stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 800) : ""
      }));
    });
    window.addEventListener("unhandledrejection", (e) => {
      const r = e.reason;
      console.error("__DBG_REJECTION__ " + JSON.stringify({
        message: r && (r.message || String(r)),
        stack: r && r.stack ? String(r.stack).slice(0, 800) : ""
      }));
    });

    // 采样屏蔽按钮出现过程中的位置，用来判断「先出现在右边再跳过去」。
    window.__posSamples = [];
    const sampler = setInterval(() => {
      try {
        const toolbar = document.querySelector(".douyin-bgm-filter-toolbar");
        if (!toolbar) return;
        const display = getComputedStyle(toolbar).display;
        const rect = toolbar.getBoundingClientRect();
        const digg = document.querySelector('[data-e2e="video-player-digg"]');
        const diggRect = digg ? digg.getBoundingClientRect() : null;
        window.__posSamples.push({
          t: Math.round(performance.now()),
          display,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          diggCenter: diggRect ? Math.round(diggRect.x + diggRect.width / 2) : null
        });
      } catch (_) {}
    }, 50);
    setTimeout(() => clearInterval(sampler), 12000);
  })();
`;

const PAGE_DIAGNOSTICS = `(() => {
  const q = (s) => document.querySelector(s);
  const scripts = Array.from(document.scripts);
  const scriptStats = scripts.map((s) => {
    const text = s.textContent || "";
    return {
      src: s.src ? s.src.slice(0, 160) : "(inline)",
      length: text.length,
      hasAwemeId: text.includes("awemeId"),
      hasAuthorInfo: text.includes("authorInfo"),
      hasModalId: text.includes("modal_id") || text.includes("modalId")
    };
  }).filter((s) => s.length > 0 || s.src !== "(inline)");
  const biggest = scriptStats.slice().sort((a, b) => b.length - a.length).slice(0, 8);
  return {
    url: location.href,
    title: document.title,
    bodyTextHead: (document.body ? document.body.innerText : "").slice(0, 300),
    loginModal: !!q("[data-e2e='login-modal'], .login-mask, #login-panel-new"),
    videos: document.querySelectorAll("video").length,
    styleInjected: !!document.querySelector("#douyin-bgm-filter-style"),
    toolbarEl: !!document.querySelector(".douyin-bgm-filter-toolbar"),
    toolbarButton: !!q(".douyin-bgm-filter-button"),
    toolbarVisible: (() => {
      const el = q(".douyin-bgm-filter-toolbar");
      return el ? getComputedStyle(el).display !== "none" : false;
    })(),
    panelOpen: !!q(".douyin-bgm-filter-panel.open"),
    panelText: (q(".douyin-bgm-filter-panel") ? q(".douyin-bgm-filter-panel").innerText : "").slice(0, 500),
    diggIcon: !!q("[data-e2e='video-player-digg']"),
    scriptCount: scripts.length,
    scriptsWithAwemeId: scriptStats.filter((s) => s.hasAwemeId).length,
    scriptsWithAuthorInfo: scriptStats.filter((s) => s.hasAuthorInfo).length,
    biggestScripts: biggest,
    longTasks: (window.__dbgLongTasks || []).slice(-40),
    longTaskTotalMs: (window.__dbgLongTasks || []).reduce((n, t) => n + t.duration, 0)
  };
})()`;

// 用来直接看页面真实数据的探针：精选页 / 详情页的 SSR 结构、DOM 上的 vid 等。
const PROBES = {
  ssr: `(() => {
    const modalId = new URLSearchParams(location.search).get("modal_id") || "";
    const scripts = Array.from(document.scripts);
    const hitScripts = scripts.filter((s) => (s.textContent || "").includes(modalId));

    const describe = (raw) => {
      const index = raw.indexOf(modalId);
      const around = index >= 0 ? raw.slice(Math.max(0, index - 160), index + 160) : "";
      const keys = ["awemeId", "aweme_id", "itemId", "item_id", "group_id", "groupId"];
      const keyHits = {};
      for (const key of keys) {
        const i = raw.indexOf('"' + key + '"');
        keyHits[key] = i >= 0 ? raw.slice(i, i + 120) : null;
      }
      const escaped = raw.indexOf('\\\\"' + "awemeId" + '\\\\"');
      const encoded = raw.indexOf('%22awemeId%22');
      return {
        length: raw.length,
        hasPlainKeys: { awemeId: raw.includes('"awemeId"'), authorInfo: raw.includes('"authorInfo"'), music: raw.includes('"music"') },
        hasEscapedQuotes: raw.includes('\\\\"'),
        escapedAwemeIdIndex: escaped,
        percentEncodedAwemeIdIndex: encoded,
        aroundModalId: around,
        keyHits
      };
    };

    const context = (el, chars) => {
      if (!el) return null;
      return (el.textContent || "").replace(/\\s+/g, " ").slice(0, chars);
    };

    return {
      modalId,
      domVideos: Array.from(document.querySelectorAll("[data-e2e-vid]")).map((el) => el.getAttribute("data-e2e-vid")),
      videoIdsOnPage: Array.from(document.querySelectorAll("[id]")).map((el) => el.id).filter((id) => /^\\d{15,}$/.test(id)).slice(0, 10),
      scriptCount: scripts.length,
      scriptsContainingModalId: hitScripts.length,
      hits: hitScripts.slice(0, 3).map((s) => describe(s.textContent || "")),
  titleBlockSample: context(document.querySelector("h1"), 200),
      authorBlockSample: context(document.querySelector("[data-e2e='video-detail-author']"), 200)
    };
  })()`,

  decode: `(() => {
    const modalId = new URLSearchParams(location.search).get("modal_id") || "";
    const script = Array.from(document.scripts).find((s) => (s.textContent || "").includes(modalId));
    if (!script) return { error: "没有任何 script 包含这个 id" };

    const raw = script.textContent || "";
    let decoded = raw;
    let mode = "decodeURIComponent";
    try {
      decoded = decodeURIComponent(raw);
    } catch (error) {
      mode = "逐段解码(" + error.name + ")";
      decoded = raw.replace(new RegExp("(?:%[0-9A-Fa-f]{2})+", "g"), (part) => {
        try {
          return decodeURIComponent(part);
        } catch (err) {
          return part;
        }
      });
    }

    const quote = String.fromCharCode(34);
    const needle = quote + "awemeId" + quote + ":" + quote + modalId + quote;
    const loosely = quote + "awemeId" + quote;
    const authorKey = quote + "authorInfo" + quote;
    const musicKey = quote + "music" + quote;
    const index = decoded.indexOf(needle);
    const looseIndex = decoded.indexOf(loosely);

    const window500 = (from) =>
      from >= 0 ? decoded.slice(from, from + 500).replace(new RegExp("\\s+", "g"), " ") : null;

    return {
      mode,
      rawLength: raw.length,
      decodedLength: decoded.length,
      strictNeedleFound: index,
      looseNeedleFound: looseIndex,
      strictAround: window500(index),
      looseAround: window500(looseIndex),
      authorInfoAfterStrict: index >= 0 ? decoded.indexOf(authorKey, index) : -1,
      musicAfterStrict: index >= 0 ? decoded.indexOf(musicKey, index) : -1,
      firstAuthorInfo: decoded.indexOf(authorKey),
      firstMusic: decoded.indexOf(musicKey),
      distanceToAuthor: index >= 0 && decoded.indexOf(authorKey, index) >= 0 ? decoded.indexOf(authorKey, index) - index : -1,
      decodedHead: decoded.slice(0, 240).replace(new RegExp("\\s+", "g"), " ")
    };
  })()`,

  // 点击按钮后，把扩展自己在 window 上来回传的消息全录下来。
  // 页面内切换视频的尝试：注意抖音会忽略脚本合成的按键，所以这个探针通常切不动，
  // 真正的切换用 Node 侧的 --walk（走 CDP 的真输入事件）。
  // 看弹窗页里作者 / 标签 / 音乐这些信息在 DOM 上的真实结构，供兜底识别使用。
  // 屏蔽按钮「出现时先偏右、再挪一下」的量化：看它第一次可见时的位置准不准。
  // 找「哪个祖先元素的右边缘到点赞图标中心的距离是固定值」，用它当几何基准。
  anchor: `(() => {
    const digg = document.querySelector('[data-e2e="video-player-digg"]');
    if (!digg) return { error: "页面上没有点赞图标" };
    const dr = digg.getBoundingClientRect();
    const center = dr.x + dr.width / 2;
    const chain = [];
    let el = digg.parentElement;
    for (let i = 0; i < 8 && el; i += 1, el = el.parentElement) {
      const r = el.getBoundingClientRect();
      chain.push({
        level: i + 1,
        tag: el.tagName,
        dataE2e: el.getAttribute("data-e2e") || "",
        cls: String(el.className || "").slice(0, 36),
        right: Math.round(r.right),
        width: Math.round(r.width),
        rightToCenter: Math.round(r.right - center)
      });
    }
    const video = document.querySelector("video");
    const vr = video ? video.getBoundingClientRect() : null;
    return {
      diggCenter: Math.round(center),
      diggWidth: Math.round(dr.width),
      videoRight: vr ? Math.round(vr.right) : null,
      videoToCenter: vr ? Math.round(vr.right - center) : null,
      windowWidth: window.innerWidth,
      chain
    };
  })()`,

  flash: `(() => {
    const all = window.__posSamples || [];
    const samples = all.filter((s) => s.display !== "none" && s.w > 0);
    if (!samples.length) {
      return {
        note: "采样期间按钮没有可见过",
        rawSampleCount: all.length,
        rawFirst: all.slice(0, 6)
      };
    }

    const first = samples[0];
    const firstOffset = first.diggCenter === null ? null : first.x + first.w / 2 - first.diggCenter;
    const xValues = [];
    for (const s of samples) {
      if (!xValues.length || Math.abs(xValues[xValues.length - 1] - s.x) >= 2) xValues.push(s.x);
    }

    return {
      firstVisible: first,
      firstOffsetFromDiggCenter: firstOffset,
      distinctX: xValues,
      movedAfterShow: xValues.length > 1,
      samples: samples.slice(0, 30)
    };
  })()`,

  dom: `(() => {
    const tidy = (text) => String(text || "").replace(/[\\n\\t ]+/g, " ").trim();
    const pick = (selector) =>
      Array.from(document.querySelectorAll(selector)).slice(0, 8).map((el) => ({
        tag: el.tagName,
        text: tidy(el.innerText).slice(0, 90),
        href: el.getAttribute("href") || "",
        dataE2e: el.getAttribute("data-e2e") || ""
      }));

    return {
      dataE2eAll: Array.from(document.querySelectorAll("[data-e2e]"))
        .map((el) => el.getAttribute("data-e2e"))
        .filter((name, index, list) => name && list.indexOf(name) === index)
        .slice(0, 60),
      authorLinks: pick('a[href*="/user/"]'),
      musicLinks: pick('a[href*="/music/"]'),
      h1: pick("h1"),
      descCandidates: pick('[data-e2e="video-desc"], [class*="desc"], [class*="Desc"]'),
      musicCandidates: pick('[class*="music"], [class*="Music"]'),
      authorCandidates: pick('[class*="author"], [class*="Author"], [class*="userName"], [class*="nickname"]')
    };
  })()`,

  walksynth: `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const tidy = (text) => String(text || "").replace(/[\\n\\t ]+/g, " ").trim();

    const currentVideo = () => {
      let best = null;
      let bestArea = 0;
      for (const el of document.querySelectorAll("[data-e2e-vid]")) {
        const rect = el.getBoundingClientRect();
        const visible =
          Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0)) * rect.width;
        if (visible > bestArea) {
          bestArea = visible;
          best = el;
        }
      }
      return {
        id: best ? best.getAttribute("data-e2e-vid") : null,
        visibleArea: Math.round(bestArea)
      };
    };

    const snapshot = (label) => {
      const panel = document.querySelector(".douyin-bgm-filter-panel");
      const toolbar = document.querySelector(".douyin-bgm-filter-toolbar");
      const rect = toolbar ? toolbar.getBoundingClientRect() : null;
      return {
        label,
        modalId: new URLSearchParams(location.search).get("modal_id"),
        url: location.pathname + location.search,
        video: currentVideo(),
        toolbarDisplay: toolbar ? getComputedStyle(toolbar).display : null,
        toolbarPos: rect ? [Math.round(rect.x), Math.round(rect.y)] : null,
        panelText: panel ? tidy(panel.innerText).slice(0, 220) : null
      };
    };

    const advance = async () => {
      // 抖音网页版切下一个视频：优先键盘，再补一次滚轮。
      for (const target of [document, document.body, window]) {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true }));
        target.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true }));
      }

      const host = document.querySelector("[data-e2e-vid]") || document.body;
      host.dispatchEvent(new WheelEvent("wheel", { deltaY: 900, bubbles: true, cancelable: true }));
      await sleep(4000);
    };

    const steps = [snapshot("初始")];
    for (let round = 0; round < 3; round += 1) {
      const button = document.querySelector(".douyin-bgm-filter-button");
      if (button) {
        button.click();
        await sleep(2000);
        steps.push(snapshot("第 " + (round + 1) + " 次点击后面板"));
        button.click();
        await sleep(300);
      } else {
        steps.push({ label: "第 " + (round + 1) + " 次点击：没有按钮" });
      }

      await advance();
      steps.push(snapshot("切到下一个视频后"));
    }

    return { steps, videos: document.querySelectorAll("[data-e2e-vid]").length };
  })()`,

  flow: `(async () => {
    const traffic = [];
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data.source !== "string") return;
      if (data.source.indexOf("douyin-bgm-filter/") !== 0) return;
      traffic.push({
        source: data.source,
        type: data.type,
        awemeId: data.awemeId,
        entry: data.entry
          ? {
              awemeId: data.entry.awemeId,
              author: data.entry.author,
              title: data.entry.title,
              musicId: data.entry.musicId,
              tags: data.entry.tags,
              source: data.entry.source
            }
          : null
      });
    });

    const button = document.querySelector(".douyin-bgm-filter-button");
    if (!button) return { error: "页面上没有屏蔽按钮" };

    const tidy = (text) => String(text || "").replace(/[\\n\\t ]+/g, " ").trim();
    const snapshot = () => {
      const panel = document.querySelector(".douyin-bgm-filter-panel");
      const toolbar = document.querySelector(".douyin-bgm-filter-toolbar");
      const rect = toolbar ? toolbar.getBoundingClientRect() : null;
      return {
        panelOpen: panel ? panel.classList.contains("open") : null,
        panelText: panel ? tidy(panel.innerText).slice(0, 260) : null,
        toolbarDisplay: toolbar ? getComputedStyle(toolbar).display : null,
        toolbarRect: rect ? [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)] : null
      };
    };

    const steps = [{ at: "点击前", ...snapshot() }];
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    steps.push({ at: "第一次点击后 2.5s", ...snapshot() });
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    steps.push({ at: "第二次点击后 2.5s", ...snapshot() });

    const firstVideo = document.querySelector("[data-e2e-vid]");
    return {
      traffic,
      steps,
      domVideoId: firstVideo ? firstVideo.getAttribute("data-e2e-vid") : null
    };
  })()`
};

// 从扩展源码里按名字抠出函数体，塞进页面里跑，验证的才是真正会上线的代码。
function detectExtensionId(contexts) {
  for (const [, info] of contexts) {
    const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(info.origin || "");
    if (match) return match[1];
  }
  return "";
}

async function openBrowserCdp(port) {
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("连接浏览器级 CDP 失败")), { once: true });
  });
  return new Cdp(ws);
}

// 真正打开扩展的 popup 页面、点一次「导出诊断日志」，再把下载下来的文件读回来。
// 用 CDP 的真输入事件在精选/推荐里连续切几个视频，看第 2 个以后还能不能识别。
const WALK_SNAPSHOT = `(() => {
  let best = null;
  let bestArea = 0;
  for (const el of document.querySelectorAll("[data-e2e-vid]")) {
    const rect = el.getBoundingClientRect();
    const visible =
      Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0)) * rect.width;
    if (visible > bestArea) {
      bestArea = visible;
      best = { el, rect };
    }
  }

  const panel = document.querySelector(".douyin-bgm-filter-panel");
  const toolbar = document.querySelector(".douyin-bgm-filter-toolbar");
  const toolbarRect = toolbar ? toolbar.getBoundingClientRect() : null;
  const button = document.querySelector(".douyin-bgm-filter-button");
  const buttonRect = button ? button.getBoundingClientRect() : null;
  const digg = document.querySelector('[data-e2e="video-player-digg"]');
  const diggRect = digg ? digg.getBoundingClientRect() : null;
  const video = document.querySelector("video");
  const videoRect = video ? video.getBoundingClientRect() : null;

  return {
    modalId: new URLSearchParams(location.search).get("modal_id"),
    url: location.pathname + location.search,
    videoId: best ? best.el.getAttribute("data-e2e-vid") : null,
    videoCenter: best
      ? [Math.round(best.rect.x + best.rect.width / 2), Math.round(best.rect.y + best.rect.height / 2)]
      : [Math.round(innerWidth / 2), Math.round(innerHeight / 2)],
    toolbarDisplay: toolbar ? getComputedStyle(toolbar).display : null,
    buttonRect: buttonRect
      ? [Math.round(buttonRect.x), Math.round(buttonRect.y), Math.round(buttonRect.width), Math.round(buttonRect.height)]
      : null,
    buttonCenterX: buttonRect && buttonRect.width ? Math.round(buttonRect.x + buttonRect.width / 2) : null,
    diggCenterX: diggRect && diggRect.width ? Math.round(diggRect.x + diggRect.width / 2) : null,
    videoRect: videoRect
      ? [Math.round(videoRect.x), Math.round(videoRect.y), Math.round(videoRect.width), Math.round(videoRect.height)]
      : null,
    videoRight: videoRect ? Math.round(videoRect.right) : null,
    diggInsetFromVideoRight:
      diggRect && diggRect.width && videoRect
        ? Math.round(videoRect.right - (diggRect.x + diggRect.width / 2))
        : null,
    panelText: panel
      ? String(panel.innerText || "").replace(/[\\n\\t ]+/g, " ").trim().slice(0, 220)
      : null
  };
})()`;

async function runWalk({ cdp, rounds, outDir }) {
  const snapshot = () => evaluate(cdp, WALK_SNAPSHOT, undefined, { timeoutMs: 20000 });
  const clickButton = () =>
    evaluate(
      cdp,
      `(() => {
        const button = document.querySelector(".douyin-bgm-filter-button");
        if (!button) return false;
        button.click();
        return true;
      })()`,
      undefined,
      { timeoutMs: 20000 }
    );

  const steps = [{ label: "初始", ...(await snapshot()) }];

  for (let round = 0; round < rounds; round += 1) {
    const clicked = await clickButton();
    await sleep(2200);
    const afterClick = { label: `第 ${round + 1} 次点击后`, clicked, ...(await snapshot()) };

    if (round === 0) {
      // 按钮第一次可见时的位置采样：判断有没有「先偏右、再挪一下」。
      afterClick.positionSamples = await evaluate(
        cdp,
        `(window.__posSamples || []).filter((s) => s.display !== "none" && s.w > 0).slice(0, 12)`,
        undefined,
        { timeoutMs: 15000 }
      );
    }

    steps.push(afterClick);

    await clickButton();
    await sleep(300);

    const before = await snapshot();
    const [x, y] = before.videoCenter || [600, 400];

    // 用真实输入事件切换视频：优先点抖音自己的「下一个」箭头，再退回滚轮/方向键。
    const inputErrors = [];

    // 登录弹窗会挡住点击，先把能关的关掉。
    await evaluate(
      cdp,
      `(() => {
        const selectors = [
          '[aria-label="关闭"]',
          '[data-e2e="close"]',
          '[class*="close"]',
          '[class*="Close"]'
        ];
        const clicked = [];
        for (const selector of selectors) {
          for (const el of document.querySelectorAll(selector)) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.width < 80) {
              el.click();
              clicked.push(selector);
              break;
            }
          }
        }
        return clicked;
      })()`,
      undefined,
      { timeoutMs: 15000 }
    );

    // 先直接触发一次箭头点击（有些按钮是普通 DOM 监听，合成点击也认）。
    await evaluate(
      cdp,
      `(() => {
        const arrow = document.querySelector('[data-e2e="video-switch-next-arrow"]');
        if (arrow) arrow.click();
        const list = document.querySelector('[data-e2e="slideList"]');
        if (list) {
          list.scrollTop = list.scrollTop + list.clientHeight;
          list.dispatchEvent(new Event("scroll", { bubbles: true }));
        }
        return true;
      })()`,
      undefined,
      { timeoutMs: 15000 }
    );
    await sleep(2500);

    const arrow = await evaluate(
      cdp,
      `(() => {
        const el = document.querySelector('[data-e2e="video-switch-next-arrow"]');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      })()`,
      undefined,
      { timeoutMs: 15000 }
    );

    if (arrow && !arrow.__error) {
      try {
        await cdp.send(
          "Input.dispatchMouseEvent",
          { type: "mouseMoved", x: arrow.x, y: arrow.y, pointerType: "mouse" },
          undefined,
          6000
        );
        await cdp.send(
          "Input.dispatchMouseEvent",
          { type: "mousePressed", x: arrow.x, y: arrow.y, button: "left", clickCount: 1, pointerType: "mouse" },
          undefined,
          6000
        );
        await cdp.send(
          "Input.dispatchMouseEvent",
          { type: "mouseReleased", x: arrow.x, y: arrow.y, button: "left", clickCount: 1, pointerType: "mouse" },
          undefined,
          6000
        );
      } catch (error) {
        inputErrors.push(String(error.message || error));
      }
    } else {
      inputErrors.push("没有找到 video-switch-next-arrow");
    }

    const keyEvent = (type) => ({
      type,
      windowsVirtualKeyCode: 40,
      nativeVirtualKeyCode: 40,
      code: "ArrowDown",
      key: "ArrowDown"
    });

    try {
      await cdp.send("Input.dispatchKeyEvent", keyEvent("rawKeyDown"), undefined, 6000);
      await cdp.send("Input.dispatchKeyEvent", keyEvent("keyUp"), undefined, 6000);
      await sleep(800);
      await cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mouseWheel", x, y, deltaX: 0, deltaY: 800, pointerType: "mouse" },
        undefined,
        6000
      );
    } catch (error) {
      inputErrors.push(String(error.message || error));
    }
    await sleep(3500);

    steps.push({
      label: `切到下一个视频后（第 ${round + 1} 次）`,
      inputErrors,
      ...(await snapshot())
    });
  }

  const result = { steps };
  fs.writeFileSync(path.join(outDir, "walk.json"), JSON.stringify(result, null, 2), "utf8");
  return result;
}

async function runPopupExportTest({ port, extId, outDir }) {
  const browser = await openBrowserCdp(port);
  const downloadDir = path.join(outDir, "downloads");
  fs.mkdirSync(downloadDir, { recursive: true });

  const pageErrors = [];
  browser.on("Runtime.exceptionThrown", (p) => {
    pageErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
  });

  await browser.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir,
    eventsEnabled: true
  });

  const { targetId } = await browser.send("Target.createTarget", {
    url: `chrome-extension://${extId}/popup.html`
  });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  await browser.send("Runtime.enable", {}, sessionId);
  await browser.send("Page.enable", {}, sessionId);
  await sleep(1500);

  const evaluated = await browser.send(
    "Runtime.evaluate",
    {
      expression: `(async () => {
        const status = document.getElementById("logStatus");
        const button = document.getElementById("exportLog");
        if (!button) return { error: "popup 里没有导出按钮" };
        const before = status ? status.textContent : "";
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 2500));
        return {
          before,
          after: status ? status.textContent : "",
          hasCopyButton: Boolean(document.getElementById("copyLog")),
          hasClearButton: Boolean(document.getElementById("clearLog"))
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    },
    sessionId
  );

  await sleep(2000);
  const files = fs.readdirSync(downloadDir).map((name) => {
    const full = path.join(downloadDir, name);
    const content = fs.readFileSync(full, "utf8");
    return {
      name,
      bytes: Buffer.byteLength(content, "utf8"),
      lineCount: content.split(/\r?\n/).length,
      lines: content.split(/\r?\n/).slice(0, 40)
    };
  });

  try {
    await browser.send("Target.closeTarget", { targetId });
  } catch (_) {}

  return { extId, downloadDir, popup: evaluated?.result?.value, files, pageErrors };
}

function extractFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return "";
}

function buildIsolatedParseProbe() {
  const file = path.join(opts0.ext, "content-isolated.js");
  const source = fs.readFileSync(file, "utf8");
  const parts = [
    "const SSR_AWEME_ID_KEYS = ['\"awemeId\"', '\"aweme_id\"'];",
    "const MAX_LOCAL_SSR_BLOCK_CHARS = 140000;",
    "const MAX_LOCAL_SSR_SCRIPT_CHARS = 6000000;",
    "const localDecodedScriptCache = new WeakMap();",
    extractFunctionSource(source, "decodeLocalScriptText"),
    extractFunctionSource(source, "extractLocalScriptString"),
    extractFunctionSource(source, "extractTagsFromDescription"),
    extractFunctionSource(source, "findLocalAwemeIndex"),
    extractFunctionSource(source, "extractLocalSsrEntry")
  ].join("\n");

  return `(() => {
${parts}
  const id = new URLSearchParams(location.search).get("modal_id") || "";
  const started = performance.now();
  let entry = null;
  let error = null;
  try {
    entry = extractLocalSsrEntry(id);
  } catch (err) {
    error = String((err && err.stack) || err);
  }
  const elapsed = Math.round(performance.now() - started);
  const perScript = [];
  for (const script of document.scripts) {
    const raw = script.textContent || "";
    if (!raw.includes(id)) continue;
    let text = "";
    try {
      text = decodeLocalScriptText(raw);
    } catch (err) {
      perScript.push({ rawLength: raw.length, decodeError: String(err) });
      continue;
    }
    perScript.push({
      rawLength: raw.length,
      decodedLength: text.length,
      index: findLocalAwemeIndex(text, id)
    });
  }
  return { id, elapsedMs: elapsed, entry, error, perScript };
})()`;
}

let opts0 = { ext: DEFAULT_EXT };

async function evaluate(cdp, expression, sessionId, { awaitPromise = false, timeoutMs = 30000 } = {}) {
  try {
    const res = await cdp.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise, userGesture: true },
      sessionId,
      timeoutMs
    );
    if (res.exceptionDetails) {
      return { __error: res.exceptionDetails.text || "evaluate 抛错" };
    }
    return res.result?.value;
  } catch (err) {
    return { __error: String(err.message || err) };
  }
}

function formatEventLine(ev) {
  const time = new Date(ev.ts).toISOString().slice(11, 23);
  switch (ev.kind) {
    case "console": {
      const args = ev.args.map((a) => a.value ?? a.description ?? a.type).join(" ");
      return `[${time}] console.${ev.level} (${ev.context}) ${args}`;
    }
    case "exception":
      return `[${time}] !! 未捕获异常 (${ev.context}) ${ev.text}${ev.stack ? "\n    " + ev.stack.split("\n").slice(0, 6).join("\n    ") : ""}`;
    case "log":
      return `[${time}] log.${ev.level} (${ev.source}) ${ev.text}`;
    case "requestFailed":
      return `[${time}] 请求失败 ${ev.method} ${ev.url} — ${ev.errorText}`;
    case "responseError":
      return `[${time}] HTTP ${ev.status} ${ev.url}`;
    case "navigation":
      return `[${time}] 导航 → ${ev.url}`;
    case "api":
      return `[${time}] 接口 ${ev.method} ${ev.url}`;
    default:
      return `[${time}] ${ev.kind} ${JSON.stringify(ev).slice(0, 300)}`;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  opts0 = opts;
  if (!opts.url) {
    console.error("必须提供 --url=...");
    process.exit(2);
  }
  if (!fs.existsSync(path.join(opts.ext, "manifest.json"))) {
    console.error(`扩展目录里没有 manifest.json：${opts.ext}`);
    process.exit(2);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = opts.outDir || path.join(__dirname, "logs", stamp);
  fs.mkdirSync(outDir, { recursive: true });

  // 固定配置目录用来「登录一次、长期复用」；没指定就用一次性临时目录。
  const profileDir = opts.profileDir
    ? path.resolve(opts.profileDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), "douyin-cdp-"));
  if (opts.profileDir) fs.mkdirSync(profileDir, { recursive: true });

  // 从一个已有的配置里「继承登录状态」：只拷 Cookie 和解密用的 Local State，
  // 其它一律不要，这样新配置依然干净、扩展能正常加载。
  if (opts.seedProfile) {
    const seed = path.resolve(opts.seedProfile);
    const inherited = [
      "Local State",
      path.join("Default", "Network", "Cookies"),
      path.join("Default", "Preferences")
    ];

    for (const relative of inherited) {
      const from = path.join(seed, relative);
      if (!fs.existsSync(from)) {
        console.log(`没有找到可继承的文件：${relative}`);
        continue;
      }

      const to = path.join(profileDir, relative);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      console.log(`继承登录状态：${relative}`);
    }
  }

  const chromeArgs = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${opts.port}`,
    `--load-extension=${opts.ext}`,
    `--disable-extensions-except=${opts.ext}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,OptimizationHints,MediaRouter,CalculateNativeWinOcclusion",
    // 窗口移到屏幕外时 Chrome 会把页面当成被遮挡/后台页面，输入事件和定时器会被节流，
    // 这里显式关掉，保证自动操作和长任务测量都准确。
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    `--window-size=${opts.windowSize}`,
    "--lang=zh-CN",
    "about:blank"
  ];
  if (!opts.visible) chromeArgs.push("--window-position=-32000,-32000");
  if (opts.headless) chromeArgs.unshift("--headless=new");

  let chrome = null;
  if (opts.attach) {
    opts.port = Number(opts.attach);
    console.log(`连接到已经运行的调试浏览器（端口 ${opts.port}）…`);
    await waitForEndpoint(opts.port);
  } else {
    console.log(`启动浏览器（端口 ${opts.port}，配置目录 ${profileDir}）…`);
    // keepOpen 时让浏览器脱离父进程，脚本退出后它继续留着给用户登录 / 后续 attach 使用。
    chrome = spawn(opts.chrome, chromeArgs, {
      stdio: "ignore",
      detached: Boolean(opts.keepOpen)
    });
    if (opts.keepOpen) chrome.unref();
  }

  const events = [];
  const contexts = new Map();
  const record = (ev) => events.push({ ts: Date.now(), ...ev });

  let exitCode = 0;
  let page = null;
  let cdp = null;
  try {
    await waitForEndpoint(opts.port);
    page = await findPageTarget(opts.port);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("连接 CDP WebSocket 失败")), { once: true });
    });
    cdp = new Cdp(ws);

    cdp.on("Runtime.executionContextCreated", ({ context }) => {
      contexts.set(context.id, {
        name: context.auxData?.type || context.name || "unknown",
        origin: context.origin || context.auxData?.origin || ""
      });
    });
    cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }) => {
      contexts.delete(executionContextId);
    });
    cdp.on("Runtime.consoleAPICalled", (p) => {
      record({
        kind: "console",
        level: p.type,
        context: contexts.get(p.executionContextId)?.name || String(p.executionContextId),
        args: (p.args || []).map((a) => ({
          type: a.type,
          value: a.value,
          description: a.description
        })),
        stack: p.stackTrace?.callFrames?.slice(0, 4).map((f) => `${f.functionName || "(anon)"} @ ${f.url}:${f.lineNumber + 1}`)
      });
    });
    cdp.on("Runtime.exceptionThrown", (p) => {
      const d = p.exceptionDetails || {};
      record({
        kind: "exception",
        context: contexts.get(d.executionContextId)?.name || String(d.executionContextId),
        text: d.exception?.description || d.text || "未知异常",
        stack: d.stackTrace?.callFrames
          ?.slice(0, 8)
          .map((f) => `${f.functionName || "(anon)"} @ ${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1}`)
          .join("\n"),
        url: d.url,
        line: d.lineNumber
      });
    });
    cdp.on("Log.entryAdded", ({ entry }) => {
      record({
        kind: "log",
        level: entry.level,
        source: entry.source,
        text: entry.text,
        url: entry.url,
        line: entry.lineNumber
      });
    });
    cdp.on("Network.loadingFailed", (p) => {
      record({ kind: "requestFailed", errorText: p.errorText, type: p.type, url: (p.requestId || "").slice(0, 0) });
    });
    cdp.on("Network.responseReceived", (p) => {
      if (p.response.status >= 400) {
        record({ kind: "responseError", status: p.response.status, url: p.response.url.slice(0, 200) });
      }
    });
    cdp.on("Network.requestWillBeSent", (p) => {
      const url = p.request?.url || "";
      if (!/\/aweme\/v1\/web\//i.test(url)) return;
      record({ kind: "api", method: p.request.method, url: url.slice(0, 240) });
    });
    cdp.on("Page.frameNavigated", (p) => {
      if (!p.frame.parentId) record({ kind: "navigation", url: p.frame.url });
    });

    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK_SCRIPT });

    console.log(`打开：${opts.url}`);
    await cdp.send("Page.navigate", { url: opts.url });
    await sleep(opts.seconds * 1000);

    const beforeClick = await evaluate(cdp, PAGE_DIAGNOSTICS);

    if (opts.probe) {
      const probe = opts.probe === "isolated" ? buildIsolatedParseProbe() : PROBES[opts.probe];
      if (!probe) {
        console.error(
          `没有名为 ${opts.probe} 的探针，可选：isolated, ${Object.keys(PROBES).join(", ")}`
        );
        exitCode = 2;
        return;
      }
      const probeResult = await evaluate(cdp, probe, undefined, {
        awaitPromise: true,
        timeoutMs: 180000
      });
      fs.writeFileSync(path.join(outDir, "probe.json"), JSON.stringify(probeResult, null, 2), "utf8");
      console.log(`探针 ${opts.probe} 结果：\n${JSON.stringify(probeResult, null, 2)}`);
      if (!opts.test) return;
    }

    if (opts.walk) {
      const walkResult = await runWalk({ cdp, rounds: opts.walk, outDir });
      console.log(`连续切换视频结果：\n${JSON.stringify(walkResult, null, 2)}`);
      if (!opts.test) return;
    }

    if (opts.test === "popupexport") {
      const extId = detectExtensionId(contexts);
      if (!extId) throw new Error("没有找到扩展 ID（隔离世界上下文里没有 chrome-extension 来源）");

      // 先真在页面上操作一遍，日志里才有识别/过滤记录可以导出。
      if (opts.click && !opts.probe) {
        await evaluate(
          cdp,
          `(() => {
            const button = document.querySelector(".douyin-bgm-filter-button");
            if (!button) return false;
            button.click();
            return true;
          })()`
        );
      await sleep(3200);
      }

      const result = await runPopupExportTest({ port: opts.port, extId, outDir });
      fs.writeFileSync(path.join(outDir, "popup-test.json"), JSON.stringify(result, null, 2), "utf8");
      console.log(`Popup 导出测试：\n${JSON.stringify(result, null, 2)}`);
      return;
    }

    let afterClick = null;
    let clickResult = null;
    if (opts.click) {
      console.log("点击页面里的屏蔽按钮…");
      clickResult = await evaluate(
        cdp,
        `(() => {
          const btn = document.querySelector(".douyin-bgm-filter-button");
          if (!btn) return { clicked: false, reason: "页面上没有 .douyin-bgm-filter-button" };
          const r = btn.getBoundingClientRect();
          btn.click();
          return { clicked: true, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
        })()`
      );
      const t0 = events.length;
      await sleep(3000);
      const midPanel = await evaluate(cdp, PAGE_DIAGNOSTICS);
      await sleep(Math.max(0, opts.afterClick - 3) * 1000);
      afterClick = await evaluate(cdp, PAGE_DIAGNOSTICS);
      afterClick.eventsDuringClick = events.slice(t0);
      afterClick.panelOpenedEarly = midPanel.panelOpen;
      afterClick.panelTextEarly = midPanel.panelText;
    }

    const report = renderReport({
      opts,
      beforeClick,
      clickResult,
      afterClick,
      events,
      profileDir,
      contexts: Array.from(contexts.entries())
    });
    fs.writeFileSync(path.join(outDir, "report.md"), report, "utf8");
    fs.writeFileSync(path.join(outDir, "events.json"), JSON.stringify(events, null, 2), "utf8");
    console.log(`\n报告：${path.join(outDir, "report.md")}`);
    console.log(report);
  } catch (err) {
    exitCode = 1;
    console.error("调试过程出错：", err.message);
  } finally {
    if (opts.keepOpen) {
      console.log("保留了调试浏览器（--keepOpen），下次可以直接 --attach 连上来。");
    } else {
      try {
        if (cdp && !opts.attach) await cdp.send("Browser.close");
      } catch {
        /* 忽略 */
      }
      await sleep(600);
      try {
        chrome?.kill();
      } catch {
        /* 忽略 */
      }
    }

    if (!opts.keepProfile && !opts.profileDir && !opts.keepOpen) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch {
        /* 忽略 */
      }
    } else {
      console.log(`配置目录保留：${profileDir}`);
    }
  }
  process.exit(exitCode);
}

function renderReport({ opts, beforeClick, clickResult, afterClick, events, profileDir, contexts = [] }) {
  const lines = [];
  lines.push("# 抖音视频屏蔽 — 自动调试报告");
  lines.push("");
  lines.push(`- 时间：${new Date().toISOString()}`);
  lines.push(`- 目标页面：${opts.url}`);
  lines.push(`- 扩展目录：${opts.ext}`);
  lines.push(`- 临时配置目录：${profileDir}`);
  lines.push(`- 预热时长：${opts.seconds}s${opts.click ? `，点击后观察 ${opts.afterClick}s` : ""}`);
  const isolated = contexts.filter(([, info]) => info.name !== "default");
  lines.push(
    `- 执行上下文：共 ${contexts.length} 个（隔离世界 ${isolated.length} 个：${isolated.map(([, info]) => info.name).join(", ") || "无"}）`
  );
  lines.push("");

  const summarize = (title, diag) => {
    lines.push(`## ${title}`);
    if (!diag || diag.__error) {
      lines.push(`（没有取到状态：${diag?.__error || "未知"}）`);
      lines.push("");
      return;
    }
    lines.push(`- URL：${diag.url}`);
    lines.push(`- 标题：${diag.title}`);
    lines.push(`- video 元素：${diag.videos}，登录弹窗：${diag.loginModal ? "有" : "无"}`);
    lines.push(
      `- 样式已注入：${diag.styleInjected ? "是" : "否"}；工具栏元素：${diag.toolbarEl ? "有" : "无"}；屏蔽按钮：${diag.toolbarButton ? "有" : "无"}；工具栏可见：${diag.toolbarVisible ? "是" : "否"}；面板打开：${diag.panelOpen ? "是" : "否"}`
    );
    if (!diag.styleInjected) {
      lines.push(`  → content script 似乎没有在这个页面运行`);
    }
    lines.push(`- 点赞图标命中：${diag.diggIcon ? "是" : "否"}`);
    lines.push(
      `- script 总数 ${diag.scriptCount}，含 "awemeId" 的 ${diag.scriptsWithAwemeId} 个，含 "authorInfo" 的 ${diag.scriptsWithAuthorInfo} 个`
    );
    lines.push(`- 长任务累计 ${diag.longTaskTotalMs} ms`);
    if (diag.longTasks?.length) {
      lines.push("");
      lines.push("| 开始(ms) | 时长(ms) | 归因 |");
      lines.push("| --- | --- | --- |");
      for (const t of diag.longTasks.slice(-15)) {
        lines.push(`| ${t.start} | **${t.duration}** | ${(t.attribution || []).join(", ")} |`);
      }
    }
    if (diag.biggestScripts?.length) {
      lines.push("");
      lines.push("最大的 script 标签：");
      lines.push("");
      lines.push("| 长度 | awemeId | authorInfo | src |");
      lines.push("| --- | --- | --- | --- |");
      for (const s of diag.biggestScripts) {
        lines.push(`| ${s.length} | ${s.hasAwemeId ? "有" : "-"} | ${s.hasAuthorInfo ? "有" : "-"} | ${s.src} |`);
      }
    }
    if (diag.panelText) {
      lines.push("");
      lines.push("面板内容：");
      lines.push("");
      lines.push("```text");
      lines.push(diag.panelText);
      lines.push("```");
    }
    lines.push("");
  };

  summarize("打开页面后的状态", beforeClick);
  if (opts.click) {
    lines.push("## 点击屏蔽按钮");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(clickResult, null, 2));
    lines.push("```");
    lines.push("");
    summarize("点击后状态", afterClick);
    if (afterClick?.eventsDuringClick?.length) {
      lines.push(`点击后新增事件 ${afterClick.eventsDuringClick.length} 条：`);
      lines.push("");
    }
  }

  const interesting = events.filter(
    (e) =>
      e.kind === "exception" ||
      e.kind === "log" ||
      e.kind === "requestFailed" ||
      e.kind === "responseError" ||
      e.kind === "navigation" ||
      (e.kind === "console" && ["error", "warning", "assert"].includes(e.level))
  );
  lines.push(`## 异常与告警（${interesting.length} 条）`);
  lines.push("");
  if (!interesting.length) {
    lines.push("没有捕获到异常或 warning。");
  } else {
    lines.push("```text");
    for (const ev of interesting.slice(0, 120)) lines.push(formatEventLine(ev));
    lines.push("```");
  }
  lines.push("");

  const verbose = events.filter((e) => e.kind === "console" && !["error", "warning", "assert"].includes(e.level));
  lines.push(`## 其它控制台输出（${verbose.length} 条，节选）`);
  lines.push("");
  lines.push("```text");
  for (const ev of verbose.slice(0, 60)) lines.push(formatEventLine(ev));
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

main();
