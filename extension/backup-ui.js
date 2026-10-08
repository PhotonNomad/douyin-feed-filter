(() => {
  const exportButton = document.getElementById("exportBackup");
  const fileInput = document.getElementById("backupFile");
  const form = document.getElementById("restoreBackupForm");
  const modeInput = document.getElementById("backupMode");
  const restoreButton = document.getElementById("restoreBackup");
  const undoButton = document.getElementById("undoRestore");
  const status = document.getElementById("backupStatus");
  let pendingData = null;
  let fileRevision = 0;
  let busy = false;
  const version = () => chrome.runtime.getManifest().version;
  const summary = (data) => `${Object.keys(data.blocked).length} 条规则、${data.blockedHistory.length} 条记录`;
  function updateButtons() {
    exportButton.disabled = busy;
    fileInput.disabled = busy;
    modeInput.disabled = busy;
    restoreButton.disabled = busy || !pendingData;
  }
  async function refreshUndo() {
    try {
      const { backupRollback } = await chrome.storage.local.get({ backupRollback: null });
      undoButton.disabled = busy || !backupRollback;
    } catch (_) { undoButton.disabled = true; }
  }
  exportButton.addEventListener("click", async () => {
    try {
      const data = await chrome.storage.local.get(DouyinBackup.DEFAULTS);
      const backup = DouyinBackup.create(data, version());
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `douyin-feed-filter-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status.textContent = `已生成备份（${summary(backup.data)}），请确认文件已下载保存。`;
    } catch (error) { status.textContent = `导出失败：${error.message}`; }
  });
  fileInput.addEventListener("change", async () => {
    const revision = ++fileRevision;
    pendingData = null;
    updateButtons();
    const file = fileInput.files?.[0];
    if (!file) { status.textContent = "未选择备份文件。"; return; }
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("备份文件超过 10 MB");
      const data = DouyinBackup.parse(await file.text());
      if (revision !== fileRevision) return;
      pendingData = data;
      status.textContent = `已读取 ${summary(data)}。请选择恢复方式，再点击「确认恢复」；设置将以备份为准。`;
    } catch (error) {
      if (revision === fileRevision) status.textContent = `读取失败：${error.message}`;
    }
    updateButtons();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !pendingData) return;
    busy = true;
    updateButtons();
    undoButton.disabled = true;
    try {
      const data = await DouyinBackup.restore(chrome.storage.local, pendingData, modeInput.value, version());
      pendingData = null;
      fileInput.value = "";
      status.textContent = `恢复成功（${summary(data)}）。请刷新抖音页面；可撤销本次恢复。`;
    } catch (error) { status.textContent = `恢复失败：${error.message}。原数据未主动清空。`; }
    finally { busy = false; updateButtons(); await refreshUndo(); }
  });
  undoButton.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    updateButtons();
    undoButton.disabled = true;
    try {
      await DouyinBackup.undo(chrome.storage.local);
      status.textContent = "已还原到恢复前的数据，请刷新抖音页面。";
    } catch (error) { status.textContent = `撤销失败：${error.message}`; }
    finally { busy = false; updateButtons(); await refreshUndo(); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.backupRollback) refreshUndo();
  });
  refreshUndo();
})();
