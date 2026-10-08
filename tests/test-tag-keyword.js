const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

// Exercise the popup's actual add/cancel handlers and persisted rules.
function popup() {
  const elements = new Map();
  function element() {
    return {
      value: "", children: [], listeners: {}, classList: { add() {} },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); },
      setAttribute() {},
      set textContent(value) { this.text = value; this.children = []; },
      get textContent() { return this.text; }
    };
  }
  const data = {};
  const context = vm.createContext({
    structuredClone,
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      createElement: element
    },
    chrome: {
      storage: {
        local: {
          get(defaults, callback) {
            const result = structuredClone({ ...defaults, ...data });
            if (callback) callback(result);
            return Promise.resolve(result);
          },
          set(items, callback) {
            Object.assign(data, structuredClone(items));
            callback?.();
          },
          remove() {}
        },
        onChanged: { addListener() {} }
      },
      tabs: { async query() { return []; } }
    }
  });
  vm.runInContext(fs.readFileSync("extension/popup.js", "utf8"), context);
  return {
    data, elements,
    add(kind, value) {
      elements.get("manualType").value = kind;
      elements.get("manualInput").value = value;
      elements.get("manualAdd").listeners.click();
    }
  };
}

const origin = "https://www.douyin.com";
const feedUrl = `${origin}/aweme/v1/web/tab/feed/`;
const items = [
  { aweme_id: "1", desc: "#夏日穿搭 #旅行" },
  { aweme_id: "2", text_extra: [{ hashtag_name: "日常穿搭" }] },
  { aweme_id: "3", hashtag_list: [{ name: "MyOuTfIt" }] },
  { aweme_id: "4", desc: "正文聊穿搭", author: { nickname: "穿搭" }, music: { title: "穿搭" } },
  { aweme_id: "5", tags: ["旅行"] },
  { aweme_id: "6", desc: "#穿搭" },
  { aweme_id: "7", room_id: "live-room", desc: "#穿搭", live_status: 1 }
];

function dataLayer() {
  let listener;
  const messages = [];
  class XHR {
    constructor() { this.listeners = {}; this.responseType = ""; }
    open() {}
    send() {}
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }
    dispatch(type) { for (const fn of this.listeners[type] || []) fn.call(this, { type }); }
  }
  const payload = () => ({ aweme_list: structuredClone(items), cursor: "9", has_more: false });
  const window = {
    location: { origin },
    addEventListener(type, fn) { if (type === "message") listener = fn; },
    postMessage(message) { messages.push(message); },
    async fetch() {
      return new Response(JSON.stringify(payload()), { headers: { "content-type": "application/json" } });
    }
  };
  const context = vm.createContext({ window, XMLHttpRequest: XHR, URL, Response, Request, Headers, setTimeout });
  vm.runInContext(fs.readFileSync("extension/content-main.js", "utf8"), context);
  return {
    messages,
    settings(blocked, enabled = true) {
      listener({ source: window, origin, data: { source: "douyin-bgm-filter/isolated", type: "settings", enabled, blocked } });
    },
    async fetch(url = feedUrl) { return (await window.fetch(url)).json(); },
    xhr() {
      const xhr = new XHR();
      xhr.open("GET", feedUrl);
      xhr.send();
      Object.assign(xhr, {
        readyState: 4, status: 200, responseURL: feedUrl,
        responseText: JSON.stringify(payload())
      });
      xhr.dispatch("readystatechange");
      return JSON.parse(xhr.responseText);
    }
  };
}

const ids = (data) => data.aweme_list.map((item) => item.aweme_id);

test("popup persists normalized keyword rules, rejects empty hashtags, and cancels", () => {
  const ui = popup();
  ui.add("tagKeyword", " ##穿搭 ");
  ui.add("tagKeyword", " #OUTFIT ");
  ui.add("tagKeyword", "outfit");
  ui.add("tagKeyword", "### ");
  assert.deepEqual(Object.keys(ui.data.blocked).sort(), ["tagKeyword:outfit", "tagKeyword:穿搭"]);
  assert.equal(ui.data.blocked["tagKeyword:穿搭"].value, "穿搭");
  assert.equal(ui.data.blocked["tagKeyword:穿搭"].label, "标签包含 穿搭");
  const row = ui.elements.get("blockedList").children.find((row) => row.children[0].children[0].textContent === "标签包含 穿搭");
  row.children[1].listeners.click();
  assert.equal(ui.data.blocked["tagKeyword:穿搭"], undefined);
  ui.add("tag", "穿搭");
  assert.equal(ui.data.blocked["tag:穿搭"].kind, "tag");
});

test("fetch and XHR filter any matching tag keyword, with history and live exclusion", async () => {
  const ui = popup();
  ui.add("tagKeyword", "#穿搭");
  ui.add("tagKeyword", "OUTFIT");
  const layer = dataLayer();
  layer.settings(ui.data.blocked);
  for (const result of [await layer.fetch(), layer.xhr()]) {
    assert.deepEqual(ids(result), ["4", "5", "7"]);
    assert.equal(result.cursor, "9");
    assert.equal(result.has_more, false);
  }
  const records = layer.messages.filter((m) => m.type === "blocked").map((m) => m.record);
  assert.ok(records.some((record) => record.awemeId === "1" && record.ruleKey === "tagKeyword:穿搭" && record.ruleLabel === "标签包含 穿搭"));
  assert.ok(records.every((record) => record.ruleKind === "tagKeyword"));
  // Removing rules and disabling filtering must immediately affect subsequent responses.
  layer.settings({});
  assert.deepEqual(ids(await layer.fetch()), ids({ aweme_list: items }));
  layer.settings(ui.data.blocked, false);
  assert.deepEqual(ids(layer.xhr()), ids({ aweme_list: items }));
  layer.settings(ui.data.blocked);
  assert.deepEqual(ids(await layer.fetch(`${origin}/aweme/v1/web/aweme/detail/`)), ids({ aweme_list: items }));
});

test("exact tag rules remain exact and invalid keyword rules do not block everything", async () => {
  const layer = dataLayer();
  layer.settings({ "tag:穿搭": {}, empty: { kind: "tagKeyword", value: "###" }, malformed: null });
  assert.deepEqual(ids(await layer.fetch()), ["1", "2", "3", "4", "5", "7"]);
});

test("isolated page matching agrees with keyword and exact rules", () => {
  // Stop before startup/DOM side effects while exposing the real matching functions.
  const source = fs.readFileSync("extension/content-isolated.js", "utf8");
  const prefix = source.slice(0, source.indexOf("  function injectStyle()"));
  const context = vm.createContext({ window: { addEventListener() {} }, structuredClone });
  vm.runInContext(`${prefix}\nglobalThis.matcher = { matchEntry, set: (blocked, enabled = true) => { settings.blocked = blocked; settings.enabled = enabled; } }; })();`, context);
  const { matcher } = context;
  const ui = popup();
  ui.add("tagKeyword", "#穿搭");
  matcher.set(ui.data.blocked);
  assert.equal(matcher.matchEntry({ tags: ["夏日穿搭"] }).key, "tagKeyword:穿搭");
  assert.equal(matcher.matchEntry({ tags: [], videoTitle: "穿搭" }), null);
  matcher.set({ "tag:穿搭": {} });
  assert.equal(matcher.matchEntry({ tags: ["夏日穿搭"] }), null);
  assert.equal(matcher.matchEntry({ tags: ["穿搭"] }).key, "tag:穿搭");
  matcher.set(ui.data.blocked, false);
  assert.equal(matcher.matchEntry({ tags: ["穿搭"] }), null);
});
