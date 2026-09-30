const fs = require("fs");
const vm = require("vm");
const origin = "https://www.douyin.com";
const listeners = [];
let loadCount = 0;
let readyCount = 0;

class FakeEvent {
  constructor(type) { this.type = type; }
  stopImmediatePropagation() { throw new Error("XHR events must not be stopped"); }
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
    }
    const handler = this[`on${event.type}`];
    if (typeof handler === "function") handler.call(this, event);
    return true;
  }
  open(method, url) { this.__method = method; this.__url = url; }
  send() {}
}

const window = {
  location: { origin },
  addEventListener(type, listener) { listeners.push(listener); },
  postMessage() {},
  fetch: async () => { throw new Error("XHR filtering must not issue a fetch"); }
};
global.window = window;
global.XMLHttpRequest = XHR;
global.Event = FakeEvent;
global.ProgressEvent = FakeEvent;
vm.runInThisContext(fs.readFileSync("extension/content-main.js", "utf8"));
listeners[0]({ source: window, origin, data: { source: "douyin-bgm-filter/isolated", type: "settings", enabled: true, blocked: { "author:bad": {} } } });

const xhr = new XHR();
xhr.onload = () => loadCount++;
xhr.onreadystatechange = () => readyCount++;
xhr.open("GET", `${origin}/aweme/v1/web/tab/feed/?cursor=0`);
xhr.send();
xhr.readyState = 4;
xhr.status = 200;
xhr.statusText = "OK";
xhr.responseURL = `${origin}/aweme/v1/web/tab/feed/?cursor=0`;
xhr.responseText = JSON.stringify({
  cursor: "9",
  has_more: true,
  aweme_list: [
    { aweme_id: "1", author: { nickname: "bad" }, music: { id: "m1", title: "Bad Music" } },
    { aweme_id: "2", author: { nickname: "good" }, music: { id: "m2", title: "Good Music" } }
  ]
});
xhr.dispatchEvent(new FakeEvent("readystatechange"));
xhr.dispatchEvent(new FakeEvent("load"));

const data = JSON.parse(xhr.responseText);
if (data.aweme_list.length !== 1 || data.aweme_list[0].aweme_id !== "2" || data.cursor !== "9" || loadCount !== 1 || readyCount !== 1) {
  throw new Error(`XHR test failed: load=${loadCount}, ready=${readyCount}, data=${xhr.responseText}`);
}
console.log("data-layer XHR test passed", { items: data.aweme_list.length, cursor: data.cursor, loadCount, readyCount });
