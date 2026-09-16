const fs = require("fs");
const vm = require("vm");
const origin = "https://www.douyin.com";
const listeners = [];
let requestCount = 0;
let loadCount = 0;
let readyCount = 0;

async function fakeFetch(input) {
  requestCount++;
  const url = new URL(String(input), origin);
  const cursor = url.searchParams.get("cursor") || "0";
  const item = cursor === "0"
    ? { aweme_id: "1", author: { nickname: "bad" }, music: { id: "m1", title: "Bad Music" } }
    : { aweme_id: "2", author: { nickname: "good" }, music: { id: "m2", title: "Good Music" } };
  return new Response(JSON.stringify({ cursor: "1", has_more: true, aweme_list: [item] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

class FakeEvent {
  constructor(type) { this.type = type; }
  stopImmediatePropagation() { this.stopped = true; }
}
class XHR {
  constructor() {
    this.readyState = 0;
    this.responseType = "";
    this.responseText = "";
    this.responseURL = "";
    this.status = 0;
    this.statusText = "";
    this.__listeners = new Map();
  }
  addEventListener(type, listener) {
    if (!this.__listeners.has(type)) this.__listeners.set(type, []);
    this.__listeners.get(type).push(listener);
  }
  dispatchEvent(event) {
    for (const listener of this.__listeners.get(event.type) || []) {
      listener.call(this, event);
      if (event.stopped) return true;
    }
    const handler = this[`on${event.type}`];
    if (typeof handler === "function") handler.call(this, event);
    return true;
  }
  open(method, url) { this.__method = method; this.__url = url; }
  send() {}
  setRequestHeader() {}
}

const window = {
  location: { origin },
  addEventListener(type, listener) { listeners.push(listener); },
  postMessage() {},
  fetch: fakeFetch
};
global.window = window;
global.XMLHttpRequest = XHR;
global.Event = FakeEvent;
global.ProgressEvent = FakeEvent;
vm.runInThisContext(fs.readFileSync("outputs/douyin-bgm-filter-extension/content-main.js", "utf8"));
listeners[0]({ source: window, origin, data: { source: "douyin-bgm-filter/isolated", type: "settings", enabled: true, blocked: { "author:bad": {} } } });

const xhr = new XMLHttpRequest();
xhr.onload = () => loadCount++;
xhr.onreadystatechange = () => readyCount++;
xhr.open("GET", `${origin}/aweme/v1/web/tab/feed/?cursor=0`);
xhr.send();
xhr.readyState = 4;
xhr.status = 200;
xhr.statusText = "OK";
xhr.responseURL = `${origin}/aweme/v1/web/tab/feed/?cursor=0`;
xhr.responseText = JSON.stringify({ cursor: "1", has_more: true, aweme_list: [{ aweme_id: "1", author: { nickname: "bad" }, music: { id: "m1", title: "Bad Music" } }] });
xhr.dispatchEvent(new FakeEvent("readystatechange"));

setTimeout(() => {
  const data = JSON.parse(xhr.responseText);
  if (requestCount !== 2 || data.aweme_list[0].aweme_id !== "2" || loadCount !== 1 || readyCount !== 1) {
    throw new Error(`xhr test failed: requests=${requestCount}, load=${loadCount}, ready=${readyCount}, data=${xhr.responseText}`);
  }
  console.log("xhr test passed", { requestCount, loadCount, readyCount, awemeId: data.aweme_list[0].aweme_id });
}, 50);
