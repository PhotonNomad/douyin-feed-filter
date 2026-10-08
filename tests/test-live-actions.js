const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup({ menu = true, nativeAdvances = true, next = true, cancelAt = 0 } = {}) {
  const calls = [];
  const notices = [];
  let active;
  let elapsed = 0;
  let firstOpen = false;
  let submenuOpen = false;
  const element = (text, click, hidden = false) => ({
    textContent: text, isConnected: true, hidden,
    click() { calls.push(text); click?.(); },
    getBoundingClientRect() { return { width: 30, height: 30, top: 10, bottom: 40 }; },
    closest() { return null; }, contains() { return false; }
  });
  const more = element("more", () => { firstOpen = true; });
  const first = element("不感兴趣", () => { submenuOpen = true; });
  const anchor = element("不想看该主播", () => { if (nativeAdvances) active = null; });
  const nextArrow = element("next", () => { active = null; });
  const hiddenChoice = element("不想看该主播", () => { throw new Error("hidden menu clicked"); }, true);
  const textNodes = () => [hiddenChoice, ...(menu && firstOpen ? [first] : []), ...(menu && submenuOpen ? [anchor] : [])];
  const container = {
    querySelectorAll(selector) { return selector.includes('data-e2e') ? (menu ? [more] : []) : textNodes(); }
  };
  const target = { container, identity: "room-1" };
  active = target;
  const document = {
    querySelectorAll(selector) { return selector.includes('video-switch-next-arrow') ? (next ? [nextArrow] : []) : textNodes(); }
  };
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync("extension/live-actions.js", "utf8"), context);
  const flow = context.DouyinLiveActions.create({
    document,
    window: { innerHeight: 800, getComputedStyle(el) { return { display: el.hidden ? "none" : "block", visibility: "visible" }; } },
    current: () => active, log() {}, notice: (message) => notices.push(message),
    async sleep(ms) { elapsed += ms; if (cancelAt && elapsed >= cancelAt) active = { container: {}, identity: "another-room" }; }
  });
  return { flow, target, calls, notices, switchRoom() { active = { container: {}, identity: "another-room" }; } };
}

test("live feedback chooses the anchor submenu and does not double-skip when native feedback advances", async () => {
  const env = setup();
  assert.equal(await env.flow.run(env.target, { feedback: true }), true);
  assert.deepEqual(env.calls, ["more", "不感兴趣", "不想看该主播"]);
});

test("live feedback that leaves the room open falls back to exactly one native next click", async () => {
  const env = setup({ nativeAdvances: false });
  assert.equal(await env.flow.run(env.target, { feedback: true }), true);
  assert.deepEqual(env.calls, ["more", "不感兴趣", "不想看该主播", "next"]);
});

test("missing native menu still skips via next; independent room without next shows a notice", async () => {
  const feed = setup({ menu: false });
  assert.equal(await feed.flow.run(feed.target, { feedback: true }), true);
  assert.deepEqual(feed.calls, ["next"]);
  const standalone = setup({ menu: false, next: false });
  assert.equal(await standalone.flow.run(standalone.target, { feedback: true }), false);
  assert.match(standalone.notices[0], /没有下一条按钮/);
});

test("automatic blocked-anchor skip bypasses feedback and ignores duplicate attempts", async () => {
  const env = setup({ next: false });
  await env.flow.run(env.target, { automatic: true });
  const count = env.notices.length;
  assert.equal(await env.flow.run(env.target, { automatic: true }), false);
  assert.equal(env.notices.length, count);
  assert.deepEqual(env.calls, []);
  const feed = setup();
  await feed.flow.run(feed.target, { automatic: true });
  assert.deepEqual(feed.calls, ["next"]);
});

test("navigating during feedback never clicks next on a different room", async () => {
  const env = setup({ menu: false, next: false, cancelAt: 100 });
  // Precondition cancellation before the run is rejected without any UI action.
  env.switchRoom();
  assert.equal(await env.flow.run(env.target, { feedback: true }), false);
  assert.deepEqual(env.calls, []);
  const pending = setup({ nativeAdvances: false, cancelAt: 100 });
  await pending.flow.run(pending.target, { feedback: true });
  assert.deepEqual(pending.calls, ["more", "不感兴趣", "不想看该主播"]);
});

test("an ordinary-video container with a nested live thumbnail is not classified as live", () => {
  const code = fs.readFileSync("extension/content-isolated.js", "utf8");
  const start = code.indexOf("  function isLiveContainer(");
  const end = code.indexOf("  function nodeMatchesAwemeId(", start);
  const context = vm.createContext({ LIVE_CONTAINER_SELECTOR: "live" });
  vm.runInContext(code.slice(start, end) + "globalThis.classify = isLiveContainer;", context);
  assert.equal(context.classify({ isConnected: true, closest() { return null; }, querySelector() { return {}; } }), false);
  assert.equal(context.classify({ isConnected: true, closest() { return {}; } }), true);
  assert.equal(context.classify({ isConnected: false }), false);
});

test("live DOM fallback skips empty avatar links while ordinary matching stays separate", () => {
  const code = fs.readFileSync("extension/content-isolated.js", "utf8");
  const start = code.indexOf("  function findBestLiveEntryForActiveContainer(");
  const end = code.indexOf(" function handleEntry(", start);
  const container = {
    kind: "live", textContent: "主播", querySelector() { return null; }, matches() { return false; },
    querySelectorAll() { return [{ textContent: "" }, { textContent: "@主播", getAttribute() { return "/user/anchor-1"; } }]; }
  };
  const context = vm.createContext({
    activeContainer: container, knownLiveEntries: new Map(), knownEntries: new Map(),
    window: { location: { pathname: "/", search: "" } },
    isLiveContainer: (node) => node.kind === "live", normalizedText: (text) => String(text || "").trim().toLowerCase(),
    findLiveRoomIdForContainer: () => "room-1", findContainerAwemeId: () => "", nonLiveContainerText: () => "ordinary"
  });
  vm.runInContext(code.slice(start, end) + "globalThis.matchers = { live: findBestLiveEntryForActiveContainer, video: findBestEntryForActiveContainer };", context);
  assert.equal(context.matchers.live().author, "主播");
  assert.equal(context.matchers.live().authorId, "anchor-1");
  assert.equal(context.matchers.video(), null);
  container.kind = "video";
  assert.equal(context.matchers.live(), null);
  assert.equal(context.matchers.video(), null);
});

test("webcast responses expose the room author without removing live data or misclassifying ordinary awemes", async () => {
  const messages = [];
  const listeners = [];
  const payload = {
    data: { room: { id: "888", owner: { nickname: "主播", sec_uid: "anchor-1" } } },
    aweme_list: [{ aweme_id: "12345", live_status: 1, author: { nickname: "视频作者" }, video: {} }]
  };
  const window = {
    location: { origin: "https://www.douyin.com", pathname: "/", search: "" },
    postMessage(message) { messages.push(message); }, addEventListener(type, fn) { listeners.push(fn); },
    async fetch() { return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }); }
  };
  class XHR { open() {} send() {} addEventListener() {} }
  const context = vm.createContext({ window, XMLHttpRequest: XHR, Response, Request, Headers, URL, setTimeout });
  vm.runInContext(fs.readFileSync("extension/content-main.js", "utf8"), context);
  listeners[0]({ source: window, origin: window.location.origin, data: { source: "douyin-bgm-filter/isolated", type: "settings", blocked: {}, enabled: true } });
  const response = await window.fetch("https://www.douyin.com/webcast/room/web/enter/");
  assert.deepEqual(await response.json(), payload);
  // Parsing cloned responses is intentionally asynchronous.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const entries = messages.filter((message) => message.type === "entry").map((message) => message.entry);
  assert.ok(entries.some((entry) => entry.isLive && entry.roomId === "888" && entry.author === "主播"));
  assert.ok(entries.some((entry) => entry.awemeId === "12345" && !entry.isLive));
});
