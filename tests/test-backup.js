const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function setup(initial = {}) {
  let data = structuredClone(initial);
  let writes = 0;
  let failWrite = false;
  const listeners = [];
  const elements = new Map();
  const downloads = [];
  const storage = {
    async get(defaults) { return structuredClone({ ...defaults, ...data }); },
    async set(items) {
      writes++;
      if (failWrite) throw new Error("QUOTA_BYTES");
      Object.assign(data, structuredClone(items));
      for (const listener of listeners) listener({ backupRollback: {} }, "local");
    }
  };
  const element = () => ({
    value: "merge", files: [], disabled: false, textContent: "", handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    click() { downloads.push(this); }, remove() {}
  });
  const blobs = [];
  const context = vm.createContext({
    structuredClone, Blob, setTimeout() {},
    URL: { createObjectURL(blob) { blobs.push(blob); return "blob:test"; }, revokeObjectURL() {} },
    document: {
      body: { appendChild() {} }, createElement: element,
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }
    },
    chrome: { runtime: { getManifest() { return { version: "0.5.27" }; } }, storage: { local: storage, onChanged: { addListener(fn) { listeners.push(fn); } } } }
  });
  vm.runInContext(fs.readFileSync("extension/backup.js", "utf8"), context);
  return {
    api: context.DouyinBackup, storage, elements, downloads, blobs,
    get data() { return data; }, get writes() { return writes; },
    fail() { failWrite = true; },
    ui() { vm.runInContext(fs.readFileSync("extension/backup-ui.js", "utf8"), context); },
    async choose(content) {
      elements.get("backupFile").files = [{ size: content.length, async text() { return content; } }];
      await elements.get("backupFile").handlers.change();
    }
  };
}
const rule = (value) => ({ key: `author:${value}`, kind: "author", value, label: `博主 ${value}`, addedAt: 123 });
const sample = {
  enabled: false, blocked: { "author:old": rule("old") },
  buttonIcon: "custom", customImage: "data:image/png;base64,YQ==", buttonSize: 48,
  blockedHistory: [{ awemeId: "123", author: "旧作者", ruleKey: "author:old", blockedAt: 200 }],
  debugLog: [{ message: "不应包含" }], unrelated: "保留"
};
const plain = (value) => JSON.parse(JSON.stringify(value));

test("backup round-trip preserves settings, rules and history but excludes logs and unknown keys", () => {
  const { api } = setup();
  const backup = api.create(sample, "0.5.26");
  assert.equal(backup.extensionVersion, "0.5.26");
  assert.deepEqual(plain(api.parse(JSON.stringify(backup))), plain(backup.data));
  assert.equal(backup.data.debugLog, undefined);
  assert.equal(backup.data.unrelated, undefined);
  assert.equal(backup.data.customImage, sample.customImage);
  assert.equal(backup.data.blockedHistory[0].author, "旧作者");
});

test("merge keeps existing rules, deduplicates records, and can be undone after reopening", async () => {
  const env = setup(sample);
  const incoming = { ...sample, enabled: true, blocked: { "author:new": rule("new") }, blockedHistory: [...sample.blockedHistory, { awemeId: "456", blockedAt: 300 }] };
  await env.api.restore(env.storage, incoming, "merge", "0.5.27");
  assert.deepEqual(Object.keys(env.data.blocked).sort(), ["author:new", "author:old"]);
  assert.equal(env.data.blockedHistory.length, 2);
  assert.equal(env.data.blockedHistory[0].awemeId, "456");
  assert.equal(env.data.enabled, true);
  assert.equal(env.data.unrelated, "保留");
  const reopened = setup(env.data);
  await reopened.api.undo(reopened.storage);
  assert.deepEqual(reopened.data.blocked, sample.blocked);
  assert.deepEqual(reopened.data.blockedHistory, sample.blockedHistory);
  assert.equal(reopened.data.enabled, false);
  assert.equal(reopened.data.backupRollback, null);
});

test("replace restores an empty backup without clearing unrelated diagnostics", async () => {
  const env = setup(sample);
  await env.api.restore(env.storage, env.api.DEFAULTS, "replace", "0.5.27");
  assert.deepEqual(env.data.blocked, {});
  assert.deepEqual(env.data.blockedHistory, []);
  assert.deepEqual(env.data.debugLog, sample.debugLog);
  await env.api.undo(env.storage);
  assert.deepEqual(env.data.blocked, sample.blocked);
});

test("invalid schemas, malformed rules, unsafe images and invalid settings never write storage", async () => {
  const env = setup(sample);
  const backup = plain(env.api.create(sample));
  for (const bad of ["{", "[]", JSON.stringify({ ...backup, schemaVersion: 99 }), JSON.stringify({ ...backup, format: "other" })]) {
    assert.throws(() => env.api.parse(bad));
  }
  for (const bad of [
    { ...sample, enabled: "false" }, { ...sample, blocked: [] },
    { ...sample, blocked: { "author:old": { ...rule("old"), key: "author:other" } } },
    { ...sample, blockedHistory: [null] }, { ...sample, buttonSize: 100 },
    { ...sample, customImage: "https://example.com/track.png" },
    { ...sample, blocked: JSON.parse('{"__proto__":{"kind":"author","key":"__proto__","value":"bad"}}') }
  ]) await assert.rejects(env.api.restore(env.storage, bad, "merge", "0.5.27"));
  assert.equal(env.writes, 0);
  assert.deepEqual(env.data, sample);
});

test("quota failure leaves original data intact", async () => {
  const env = setup(sample);
  env.fail();
  await assert.rejects(env.api.restore(env.storage, env.api.DEFAULTS, "replace", "0.5.27"), /QUOTA_BYTES/);
  assert.deepEqual(env.data, sample);
});

test("popup exports JSON, previews before writing, restores only on submit, and reports invalid files", async () => {
  const env = setup(sample);
  env.ui();
  await env.elements.get("exportBackup").handlers.click();
  assert.match(env.downloads[0].download, /^douyin-feed-filter-backup-.*\.json$/);
  const text = await env.blobs[0].text();
  assert.equal(JSON.parse(text).data.blockedHistory.length, 1);
  await env.choose(text);
  assert.equal(env.writes, 0);
  assert.equal(env.elements.get("restoreBackup").disabled, false);
  assert.match(env.elements.get("backupStatus").textContent, /1 条规则、1 条记录/);
  await env.elements.get("restoreBackupForm").handlers.submit({ preventDefault() {} });
  assert.equal(env.writes, 1);
  assert.match(env.elements.get("backupStatus").textContent, /恢复成功/);
  await env.elements.get("undoRestore").handlers.click();
  assert.equal(env.data.backupRollback, null);
  await env.choose("not json");
  assert.equal(env.elements.get("restoreBackup").disabled, true);
  assert.match(env.elements.get("backupStatus").textContent, /读取失败/);
});
