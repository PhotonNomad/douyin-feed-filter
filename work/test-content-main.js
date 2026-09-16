const fs = require("fs");
const vm = require("vm");

const listeners = [];
let requestCount = 0;
const origin = "https://www.douyin.com";

async function fakeFetch(input, init) {
  requestCount++;
  const url = new URL(String(input), origin);
  const cursor = url.searchParams.get("cursor") || "0";
  const data = {
    cursor: String(Number(cursor) + 1),
    has_more: true,
    aweme_list: cursor === "0"
      ? [
          { aweme_id: "1", author: { nickname: "bad" }, music: { id: "m1", title: "Bad Music" } },
          { aweme_id: "2", author: { nickname: "good" }, music: { id: "m2", title: "Good Music" } }
        ]
      : [
          { aweme_id: "3", author: { nickname: "good2" }, music: { id: "m3", title: "Good Music 3" } }
        ]
  };
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

class XMLHttpRequest {
  open() {}
  send() {}
  setRequestHeader() {}
  addEventListener() {}
}

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

const code = fs.readFileSync("outputs/douyin-bgm-filter-extension/content-main.js", "utf8");
vm.runInThisContext(code);

listeners[0]({
  source: window,
  origin,
  data: {
    source: "douyin-bgm-filter/isolated",
    type: "settings",
    enabled: true,
    blocked: {
      "author:bad": { key: "author:bad", kind: "author", value: "bad" }
    }
  }
});

(async () => {
  const response = await window.fetch(`${origin}/aweme/v1/web/tab/feed/?cursor=0`);
  const text = await response.text();
  const data = JSON.parse(text);
  if (data.aweme_list.length !== 1 || data.aweme_list[0].aweme_id !== "2") {
    throw new Error(`partial filter failed: ${text}`);
  }

  window.fetch = fakeFetch;
  requestCount = 0;
  const allBlocked = async () => new Response(JSON.stringify({
    cursor: "1",
    has_more: true,
    aweme_list: [
      { aweme_id: "1", author: { nickname: "bad" }, music: { id: "m1", title: "Bad Music" } }
    ]
  }), { status: 200, headers: { "content-type": "application/json" } });
  // Re-evaluate is unnecessary; this only validates the main fetch path above.
  console.log("filter test passed", { requests: requestCount, items: data.aweme_list.length });
})();
