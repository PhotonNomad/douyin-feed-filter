(() => {
  const FORMAT = "douyin-feed-filter-backup";
  const DEFAULTS = {
    enabled: true, blocked: {}, buttonIcon: "not-interested",
    customImage: "", buttonSize: 40, blockedHistory: []
  };
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const fail = (message) => { throw new Error(message); };
  function text(value, field, limit = 8192) {
    if (typeof value !== "string" || value.length > limit) fail(`${field}格式不正确`);
    return value;
  }
  function timestamp(value, field) {
    if (!Number.isFinite(value) || value < 0) fail(`${field}格式不正确`);
    return value;
  }
  function validateData(source) {
    if (!isObject(source) || !isObject(source.blocked)) fail("备份缺少有效的屏蔽规则");
    const data = structuredClone(DEFAULTS);
    for (const [key, rule] of Object.entries(source.blocked)) {
      if (!isObject(rule) || !["music", "author", "tag", "tagKeyword"].includes(rule.kind)) fail("存在不支持的屏蔽规则");
      const prefixes = rule.kind === "music" ? ["music:", "title:"] : [`${rule.kind}:`];
      if (!prefixes.some((prefix) => key.startsWith(prefix) && key.slice(prefix.length).trim())) fail("屏蔽规则键不正确");
      if (rule.key !== key || !text(rule.value, "规则内容").trim()) fail("屏蔽规则内容不正确");
      data.blocked[key] = { key, kind: rule.kind, value: rule.value };
      if (rule.label !== undefined) data.blocked[key].label = text(rule.label, "规则名称");
      if (rule.addedAt !== undefined) data.blocked[key].addedAt = timestamp(rule.addedAt, "规则时间");
    }
    if (source.enabled !== undefined) {
      if (typeof source.enabled !== "boolean") fail("启用设置格式不正确");
      data.enabled = source.enabled;
    }
    if (source.buttonIcon !== undefined) data.buttonIcon = text(source.buttonIcon, "按钮图标", 64);
    if (source.buttonSize !== undefined) {
      if (!Number.isInteger(source.buttonSize) || source.buttonSize < 32 || source.buttonSize > 56) fail("按钮大小必须在 32–56 之间");
      data.buttonSize = source.buttonSize;
    }
    if (source.customImage !== undefined) {
      data.customImage = text(source.customImage, "自定义图片", 2 * 1024 * 1024);
      if (data.customImage && !/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(data.customImage)) fail("自定义图片格式不正确");
    }
    if (source.blockedHistory !== undefined) {
      if (!Array.isArray(source.blockedHistory)) fail("屏蔽记录格式不正确");
      data.blockedHistory = source.blockedHistory.map((record) => {
        if (!isObject(record)) fail("屏蔽记录格式不正确");
        const result = {};
        for (const field of ["awemeId", "author", "authorId", "title", "videoTitle", "musicId", "ruleKey", "ruleLabel", "ruleKind"]) {
          if (record[field] !== undefined) result[field] = text(record[field], "屏蔽记录字段");
        }
        if (record.blockedAt !== undefined) result.blockedAt = timestamp(record.blockedAt, "屏蔽记录时间");
        return result;
      });
    }
    return data;
  }
  function create(data, extensionVersion = "") {
    return {
      format: FORMAT, schemaVersion: 1, extensionVersion,
      exportedAt: new Date().toISOString(), data: validateData(data)
    };
  }
  function parse(value) {
    const backup = typeof value === "string" ? JSON.parse(value.replace(/^\uFEFF/, "")) : value;
    if (!isObject(backup) || backup.format !== FORMAT || backup.schemaVersion !== 1) fail("不是受支持的抖音屏蔽备份文件");
    return validateData(backup.data);
  }
  function merge(current, imported, mode) {
    const before = validateData(current);
    const incoming = validateData(imported);
    if (mode === "replace") return incoming;
    if (mode !== "merge") fail("恢复方式不正确");
    // Imported settings win; existing rules remain unless their keys are in the backup.
    const records = new Map();
    for (const record of [...before.blockedHistory, ...incoming.blockedHistory]) {
      records.set(JSON.stringify([record.awemeId || "", record.ruleKey || "", record.blockedAt || 0]), record);
    }
    return {
      ...incoming, blocked: { ...before.blocked, ...incoming.blocked },
      blockedHistory: [...records.values()].sort((a, b) => (b.blockedAt || 0) - (a.blockedAt || 0)).slice(0, 200)
    };
  }
  async function restore(storage, imported, mode, version) {
    const incoming = validateData(imported);
    const current = await storage.get(DEFAULTS);
    const data = merge(current, incoming, mode);
    await storage.set({ ...data, backupRollback: create(current, version) });
    return data;
  }
  async function undo(storage) {
    const { backupRollback } = await storage.get({ backupRollback: null });
    if (!backupRollback) fail("没有可撤销的恢复");
    const data = parse(backupRollback);
    await storage.set({ ...data, backupRollback: null });
    return data;
  }
  globalThis.DouyinBackup = { DEFAULTS, create, parse, merge, restore, undo };
})();
