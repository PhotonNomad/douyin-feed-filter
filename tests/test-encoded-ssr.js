const fs = require("fs");
const vm = require("vm");
(async () => {
const id = "7684253090765180179";
const obj = {
  awemeId: id,
  authorInfo: { nickname: "测试作者", uid: "u1" },
  music: { mid: "m1", title: "测试音乐" },
  desc: "#测试标签 内容"
};
const encoded = encodeURIComponent(JSON.stringify(obj));
const messages = [];
const listeners = [];
class XHR { open(){} send(){} addEventListener(){} }
global.document = { scripts: [{ textContent: encoded }] };
global.window = {
  location: { origin: "https://www.douyin.com" },
  addEventListener(type, listener) { listeners.push(listener); },
  postMessage(data) { messages.push(data); },
  fetch: async () => { throw new Error("not used"); }
};
global.XMLHttpRequest = XHR;
vm.runInThisContext(fs.readFileSync("extension/content-main.js", "utf8"));
const settingsListener = listeners.find(fn => true);
settingsListener({ source: window, origin: window.location.origin, data: { source: "douyin-bgm-filter/isolated", type: "settings", enabled: true, blocked: {} } });
settingsListener({ source: window, origin: window.location.origin, data: { source: "douyin-bgm-filter/isolated", type: "request-entry", awemeId: id } });
await new Promise(resolve => setTimeout(resolve, 0));
const entries = messages.filter(m => m.type === "entry").map(m => m.entry);
if (!entries.some(e => e.awemeId === id && e.author === "测试作者" && e.title === "测试音乐" && e.tags.includes("测试标签"))) {
  throw new Error("encoded SSR parse failed: " + JSON.stringify(messages, null, 2));
}
console.log("encoded SSR parse passed", entries[0]);
})();
