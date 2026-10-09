(() => {
  if (window.__douyinNativeFeedbackInstalled) return;
  window.__douyinNativeFeedbackInstalled = true;
  const REQUEST = "douyin-feed-filter/native-feedback/request";
  const RESPONSE = "douyin-feed-filter/native-feedback/response";
  const MARKER = "data-douyin-feedback-target";
  const LIVE_MARKER = "data-douyin-feedback-live";
  const LIVE = '[data-e2e="feed-live"], [data-e2e="live-container"], [data-e2e="live-feed-item"], [data-e2e="webcast-feed-item"]';
  const labels = { open: "不感兴趣", anchor: "不想看该主播" };

  window.addEventListener("message", async (event) => {
    const request = event.data;
    if (event.source !== window || event.origin !== window.location.origin || request?.source !== REQUEST) return;
    if (!/^[a-z0-9-]{1,80}$/.test(request.id || "") || !["show-menu", "open", "anchor"].includes(request.action)) return;
    let error = "";
    try {
      const target = document.querySelector(`[${MARKER}="${request.id}"]`);
      const live = document.querySelector(`[${LIVE_MARKER}="${request.id}"]`);
      if (!target?.isConnected || !live?.isConnected || !live.matches(LIVE) || !live.contains(target)) throw new Error("直播菜单上下文已失效");
      const rect = live.getBoundingClientRect();
      if (rect.top > window.innerHeight / 2 || rect.bottom < window.innerHeight / 2) throw new Error("直播已离开当前视口");
      const callbackName = request.action === "show-menu" ? "onMouseEnter" : "onClick";
      let binding = null;
      for (let node = target; node && live.contains(node); node = node.parentElement) {
        if (request.action === "show-menu" ? node !== live : node.textContent.trim() !== labels[request.action]) continue;
        const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
        const callback = key && node[key]?.[callbackName];
        if (typeof callback === "function") { binding = { node, callback }; break; }
      }
      if (!binding) throw new Error("未找到抖音菜单绑定的回调");
      // The live anchor callback reads nativeEvent.target and dispatches its
      // own CustomEvent; provide its bound DOM node without dispatching a click.
      const nativeEvent = { target: binding.node, currentTarget: binding.node, type: request.action === "show-menu" ? "mouseenter" : "click" };
      const callbackEvent = {
        ...nativeEvent, nativeEvent, preventDefault() {}, stopPropagation() {}, persist() {},
        isDefaultPrevented: () => false, isPropagationStopped: () => false
      };
      await binding.callback(callbackEvent);
    } catch (reason) { error = String(reason?.message || reason); }
    window.postMessage({ source: RESPONSE, id: request.id, ok: !error, error }, window.location.origin);
  });
})();
