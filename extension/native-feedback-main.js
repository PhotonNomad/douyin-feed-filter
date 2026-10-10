(() => {
  if (window.__douyinNativeFeedbackInstalled) return;
  window.__douyinNativeFeedbackInstalled = true;
  const REQUEST = "douyin-feed-filter/native-feedback/request";
  const RESPONSE = "douyin-feed-filter/native-feedback/response";
  const MARKER = "data-douyin-feedback-target";
  const LIVE_MARKER = "data-douyin-feedback-live";
  const LIVE = '[data-e2e="feed-live"], [data-e2e="live-container"], [data-e2e="live-feed-item"], [data-e2e="webcast-feed-item"]';
  const ANCHOR_EVENT = "liveViewDotliveDislikeAnchor";
  const callbacks = [];
  const originalAdd = document.addEventListener;
  const originalRemove = document.removeEventListener;
  const captureOf = options => typeof options === "boolean" ? options : Boolean(options?.capture);

  // At document_start, retain the official active-live handler before the
  // optional submenu is mounted. All original registrations still run normally.
  document.addEventListener = function(type, callback, options) {
    const result = originalAdd.call(this, type, callback, options);
    if (this === document && type === ANCHOR_EVENT && callback && !options?.signal?.aborted) {
      const capture = captureOf(options);
      if (!callbacks.some(item => item.callback === callback && item.capture === capture)) {
        callbacks.push({ callback, capture, once: Boolean(options?.once), signal: options?.signal });
      }
    }
    return result;
  };
  document.removeEventListener = function(type, callback, options) {
    const result = originalRemove.call(this, type, callback, options);
    if (this === document && type === ANCHOR_EVENT) {
      const capture = captureOf(options);
      const index = callbacks.findIndex(item => item.callback === callback && item.capture === capture);
      if (index !== -1) callbacks.splice(index, 1);
    }
    return result;
  };

  window.addEventListener("message", async (event) => {
    const request = event.data;
    if (event.source !== window || event.origin !== window.location.origin || request?.source !== REQUEST) return;
    if (!/^[a-z0-9-]{1,80}$/.test(request.id || "") || request.action !== "anchor") return;
    let error = "";
    try {
      const target = document.querySelector(`[${MARKER}="${request.id}"]`);
      const live = document.querySelector(`[${LIVE_MARKER}="${request.id}"]`);
      if (target !== live || !live?.isConnected || !live.matches(LIVE)) throw new Error("直播上下文已失效");
      const rect = live.getBoundingClientRect();
      if (rect.top > window.innerHeight / 2 || rect.bottom < window.innerHeight / 2) throw new Error("直播已离开当前视口");
      const active = callbacks.filter(item => !item.once && !item.signal?.aborted);
      if (active.length !== 1) throw new Error(active.length ? "主播屏蔽回调不唯一" : "未捕获主播屏蔽回调，请重新加载扩展并完整刷新抖音页面");
      const binding = active[0];
      // The observed official handler closes over the current room and takes
      // no arguments. Call it directly: no DOM event, click, key or menu action.
      if (typeof binding.callback === "function") await binding.callback.call(document);
      else await binding.callback.handleEvent.call(binding.callback);
    } catch (reason) { error = String(reason?.message || reason); }
    window.postMessage({ source: RESPONSE, id: request.id, ok: !error, error }, window.location.origin);
  });
})();
