const fs = require("fs");
const vm = require("vm");
const listeners = [];
const origin = "https://www.douyin.com";
let requestCount = 0;

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

class XMLHttpRequest { open() {} send() {} setRequestHeader() {} addEventListener() {} }
const window = {
  location: { origin },
  addEventListener(type, listener) { listeners.push(listener); },
  postMessage() {},
  fetch: fakeFetch
};
global.window = window;
global.XMLHttpRequest = XMLHttpRequest;
global.Event = class Event {};
global.ProgressEvent = class ProgressEvent {};
vm.runInThisContext(fs.readFileSync("outputs/douyin-bgm-filter-extension/content-main.js", "utf8"));
listeners[0]({ source: window, origin, data: { source: "douyin-bgm-filter/isolated", type: "settings", enabled: true, blocked: { "author:bad": {} } } });
(async () => {
  const response = await window.fetch(`${origin}/aweme/v1/web/tab/feed/?cursor=0`);
  const data = JSON.parse(await response.text());
  if (requestCount !== 2 || data.aweme_list[0].aweme_id !== "2") {
    throw new Error(`retry test failed: requests=${requestCount}, data=${JSON.stringify(data)}`);
  }
  console.log("retry test passed", { requestCount, awemeId: data.aweme_list[0].aweme_id });
})();
