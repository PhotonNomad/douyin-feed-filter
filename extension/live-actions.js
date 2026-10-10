(() => {
  function create({ current, log, notice, invokeCallback, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    let busy = false;
    function same(target) {
      const active = current();
      return active?.container === target.container && active.identity === target.identity;
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
      try {
        await invokeCallback(target.container, target.container, "anchor");
        log("info", "已直接执行直播主播屏蔽回调", { identity: target.identity });
        if (!(await changed(target))) notice("已提交不想看该主播；页面尚未自动切换。");
        return true;
      } catch (error) {
        log("error", "执行直播主播屏蔽回调失败", { message: error.message });
        notice(`规则已保存，主播屏蔽失败：${error.message}`);
        return false;
      } finally { busy = false; }
    }
    return { run };
  }
  globalThis.DouyinLiveActions = { create };
})();
