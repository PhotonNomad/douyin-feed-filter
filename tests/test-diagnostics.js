const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup(pageLogs = false) {
  const elements = new Map();
  const stored = { debugLog: [{ t: 1000, level: "info", message: "本地记录" }] };
  const blobs = [];
  let copied;
  const context = vm.createContext({
    Blob, setTimeout() {},
    URL: { createObjectURL(blob) { blobs.push(blob); return "blob:test"; }, revokeObjectURL() {} },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { textContent: "", handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } });
        return elements.get(id);
      },
      body: { appendChild() {} }, createElement() { return { click() {}, remove() {} }; }
    },
    navigator: { clipboard: { async writeText(value) { copied = value; } } },
    chrome: {
      runtime: { getManifest() { return { version: "0.5.29" }; } },
      storage: { local: {
        async get() { return stored; }, async set(value) { Object.assign(stored, value); }
      } },
      tabs: {
        async query(options) { return options.active ? [{ id: 1 }] : [{ id: 1 }, { id: 2 }]; },
        async sendMessage(id, message) {
          if (pageLogs && id === 2 && message.type === "douyin-bgm-filter/dump-log") {
            return { events: [{ t: 2000, level: "info", message: "页面记录" }], meta: { url: "https://www.douyin.com/" } };
          }
          throw new Error("No receiver");
        }
      }
    }
  });
  // No popup.js or backup globals are loaded on this page.
  vm.runInContext(fs.readFileSync("extension/diagnostics.js", "utf8"), context);
  return { context, elements, stored, blobs, get copied() { return copied; } };
}

test("standalone diagnostics falls back to another Douyin tab for its live buffer", async () => {
  const env = setup(true);
  const result = await env.context.collectDiagnosticLog();
  assert.equal(result.events[0].message, "页面记录");
  assert.equal(result.meta.url, "https://www.douyin.com/");
  await env.context.copyDiagnosticLog();
  assert.match(env.copied, /0\.5\.29/);
  assert.match(env.copied, /页面记录/);
});

test("standalone diagnostics can export stored logs and clear them without a connected page", async () => {
  const env = setup();
  await env.context.exportDiagnosticLog();
  assert.match(await env.blobs[0].text(), /本地记录/);
  await env.elements.get("clearLog").handlers.click();
  assert.deepEqual(Array.from(env.stored.debugLog), []);
  assert.match(env.elements.get("logStatus").textContent, /已清空/);
});
