(() => {
  function create({ document, window, current, log, notice, invokeCallback, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    let busy = false;
    function visible(element) {
      if (!element?.isConnected || element.disabled) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight && style.display !== "none" && style.visibility !== "hidden";
    }
    function byText(root, text, includeHidden = false) {
      const matches = Array.from(root.querySelectorAll('button, [role="menuitem"], span, div')).filter((element) =>
        element.textContent.trim() === text && (includeHidden ? element.isConnected && !element.disabled : visible(element)) && !element.closest('.douyin-bgm-filter-toolbar')
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
    async function run(target) {
      if (!target?.identity || busy || !same(target)) return false;
      busy = true;
      let submenu = null;
      try {
        submenu = byText(target.container, "不想看该主播");
        if (!submenu) {
          let first = byText(target.container, "不感兴趣", true);
          if (!first && !submenu) {
            await invokeCallback(target.container, target.container, "show-menu");
            first = await waitFor(target, () => byText(target.container, "不感兴趣", true));
          }
          if (first && !submenu && same(target)) {
            await invokeCallback(first, target.container, "open");
            submenu = await waitFor(target, () => byText(target.container, "不想看该主播"));
          }
        }
        if (submenu && same(target)) {
          await invokeCallback(submenu, target.container, "anchor");
          log("info", "已调用直播不想看该主播回调", { identity: target.identity });
          if (!(await changed(target))) {
            notice("已提交不想看该主播；页面尚未自动切换。");
          }
          return true;
        } else {
          if (!same(target)) return true;
          log("warn", "未找到直播不想看该主播菜单", { identity: target.identity });
          notice("规则已保存，未找到不想看该主播菜单，请在抖音的不感兴趣菜单中手动选择。");
          return false;
        }
      } catch (error) {
        log("error", "提交直播不感兴趣失败", { message: error.message });
        notice("规则已保存，提交不感兴趣失败，请在抖音菜单中手动选择不想看该主播。");
        return false;
      } finally { busy = false; }
    }
    return { run };
  }
  globalThis.DouyinLiveActions = { create };
})();
