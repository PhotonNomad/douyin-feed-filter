(() => {
  function create({ document, window, current, log, notice, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    let busy = false;
    let attempted = new WeakMap();
    function visible(element) {
      if (!element?.isConnected || element.disabled) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight && style.display !== "none" && style.visibility !== "hidden";
    }
    function byText(root, text) {
      const matches = Array.from(root.querySelectorAll('button, [role="menuitem"], span, div')).filter((element) =>
        element.textContent.trim() === text && visible(element) && !element.closest('.douyin-bgm-filter-toolbar')
      );
      return matches.find((element) => !matches.some((other) => other !== element && element.contains(other))) || null;
    }
    function same(target) {
      const active = current();
      return active?.container === target.container && active.identity === target.identity;
    }
    async function waitFor(target, find, timeout = 1200) {
      for (let elapsed = 0; elapsed <= timeout; elapsed += 100) {
        if (!same(target)) return null;
        const element = find();
        if (element) return element;
        await sleep(100);
      }
      return null;
    }
    async function changed(target, timeout = 1000) {
      for (let elapsed = 0; elapsed <= timeout; elapsed += 100) {
        if (!same(target)) return true;
        await sleep(100);
      }
      return !same(target);
    }
    async function run(target, { feedback = false, automatic = false } = {}) {
      if (!target?.identity || busy || !same(target)) return false;
      if (automatic && attempted.get(target.container) === target.identity) return false;
      attempted.set(target.container, target.identity);
      busy = true;
      let submenu = null;
      try {
        if (feedback) {
          submenu = byText(document, "不想看该主播");
          if (!submenu) {
            let first = byText(target.container, "不感兴趣");
            if (!first) {
              const more = Array.from(target.container.querySelectorAll('[data-e2e="video-play-more"]')).find(visible);
              if (more) {
                more.click();
                first = await waitFor(target, () => byText(target.container, "不感兴趣") || byText(document, "不感兴趣"));
              }
            }
            if (first && same(target)) {
              first.click();
              submenu = await waitFor(target, () => byText(document, "不想看该主播"));
            }
          }
          if (submenu && same(target)) {
            submenu.click();
            log("info", "已点击直播不想看该主播", { identity: target.identity });
            if (await changed(target)) return true;
          } else {
            log("warn", "未找到直播不想看该主播菜单，尝试下一条", { identity: target.identity });
          }
        }
        if (!same(target)) return true;
        const next = Array.from(document.querySelectorAll('[data-e2e="video-switch-next-arrow"]')).find(visible);
        if (!next) {
          notice("规则已保存；当前直播页面没有下一条按钮，可返回推荐页继续浏览。");
          log("warn", "直播页面没有下一条按钮", { identity: target.identity });
          return false;
        }
        // Exactly one click; do not send a second synthetic scroll/key event.
        next.click();
        const advanced = await changed(target);
        log(advanced ? "info" : "warn", advanced ? "已跳过被屏蔽的直播" : "点击下一条后未检测到直播切换", { identity: target.identity });
        if (!advanced) notice("规则已保存，但未检测到直播切换，请手动切换下一条。");
        return advanced;
      } catch (error) {
        log("error", "跳过直播失败", { message: error.message });
        notice("规则已保存，跳过直播失败，请手动切换下一条。");
        return false;
      } finally { busy = false; }
    }
    return { run, reset() { attempted = new WeakMap(); } };
  }
  globalThis.DouyinLiveActions = { create };
})();
