(() => {
  const REQUEST = "douyin-feed-filter/native-feedback/request";
  const RESPONSE = "douyin-feed-filter/native-feedback/response";
  const pending = new Map();
  let sequence = 0;
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== RESPONSE) return;
    pending.get(event.data.id)?.(event.data);
  });
  function invoke(target, live, action) {
    if (!target?.isConnected || !live?.isConnected || !live.contains(target)) return Promise.reject(new Error("直播菜单上下文已失效"));
    const id = `feedback-${Date.now().toString(36)}-${++sequence}`;
    const marker = "data-douyin-feedback-target";
    const liveMarker = "data-douyin-feedback-live";
    return new Promise((resolve, reject) => {
      const finish = (response) => {
        clearTimeout(timer);
        pending.delete(id);
        if (target.getAttribute(marker) === id) target.removeAttribute(marker);
        if (live.getAttribute(liveMarker) === id) live.removeAttribute(liveMarker);
        if (response.ok) resolve(true);
        else reject(new Error(response.error || "调用抖音回调失败"));
      };
      const timer = setTimeout(() => finish({ error: "等待抖音菜单回调超时" }), 2000);
      pending.set(id, finish);
      target.setAttribute(marker, id);
      live.setAttribute(liveMarker, id);
      try { window.postMessage({ source: REQUEST, id, action }, window.location.origin); }
      catch (error) { finish({ error: error.message }); }
    });
  }
  globalThis.DouyinNativeFeedback = { invoke };
})();
