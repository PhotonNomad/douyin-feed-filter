const fs = require("fs");
const vm = require("vm");
const listeners = [];
const origin = "https://www.douyin.com";
let requestCount = 0;

async function fakeFetch(input) {
  requestCount++;
  const url = new URL(String(input), origin);
  const cursor = url.searchParams.get("cursor") || "0";
  const items = cursor === "0"
    ? [
        { aweme_id: "1", author: { nickname: "bad" }, music: { id: "m1", title: "Bad Music" } },
        { aweme_id: "2", author: { nickname: "good" }, music: { id: "m2", title: "Good Music" } }
      ]
    : cursor === "1"
      ? [
          { aweme_id: "1", author: { nickname: "bad" }, music: { id: "m1", title: "Bad Music" } }
        ]
    : [
        { aweme_id: "3", author: { nickname: "good" }, music: { id: "m3", title: "Good Music" } }
      ];
  const nextCursor = String(Number(cursor) + 1);
  return new Response(JSON.stringify({ cursor: nextCursor, has_more: true, aweme_list: items }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

class XMLHttpRequest { open() {} send() {} addEventListener() {} }
const window = {
  location: { origin },
  addEventListener(type, listener) { listeners.push(listener); },
  postMessage() {},
  fetch: fakeFetch
};
global.window = window;
global.XMLHttpRequest = XMLHttpRequest;
vm.runInThisContext(fs.readFileSync("extension/content-main.js", "utf8"));
listeners[0]({ source: window, origin, data: { source: "douyin-bgm-filter/isolated", type: "settings", enabled: true, blocked: { "author:bad": {} } } });

(async () => {
  const partial = JSON.parse(await (await window.fetch(`${origin}/aweme/v1/web/tab/feed/?cursor=0`)).text());
  if (partial.aweme_list.length !== 1 || partial.aweme_list[0].aweme_id !== "2" || partial.cursor !== "1") {
    throw new Error(`partial filter failed: ${JSON.stringify(partial)}`);
  }

  const allBlocked = JSON.parse(await (await window.fetch(`${origin}/aweme/v1/web/tab/feed/?cursor=1`)).text());
  if (
    requestCount !== 3 ||
    allBlocked.aweme_list.length !== 1 ||
    allBlocked.aweme_list[0].aweme_id !== "3" ||
    allBlocked.cursor !== "3" ||
    allBlocked.has_more !== true
  ) {
    throw new Error(`all-blocked behavior failed: requests=${requestCount}, data=${JSON.stringify(allBlocked)}`);
  }

  console.log("data-layer fetch test passed", {
    requestCount,
    partialItems: partial.aweme_list.length,
    prefetchedItems: allBlocked.aweme_list.length,
    cursor: allBlocked.cursor
  });
})();
