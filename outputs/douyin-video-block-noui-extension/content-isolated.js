(() => {
  if (window.__douyinVideoBlockNoUiInstalled) return;
  window.__douyinVideoBlockNoUiInstalled = true;

  const MESSAGE_SOURCE = "douyin-bgm-filter/main";
  const ISOLATED_MESSAGE_SOURCE = "douyin-bgm-filter/isolated";
  const DEFAULT_SETTINGS = {
    enabled: true,
    blocked: {}
  };

  let settings = structuredClone(DEFAULT_SETTINGS);

  function postSettingsToMain() {
    try {
      window.postMessage(
        {
          source: ISOLATED_MESSAGE_SOURCE,
          type: "settings",
          enabled: Boolean(settings.enabled),
          blocked: settings.blocked || {}
        },
        window.location.origin
      );
    } catch (_) {}
  }

  function loadSettings() {
    chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
      settings = {
        ...structuredClone(DEFAULT_SETTINGS),
        ...items
      };

      if (!settings.blocked || typeof settings.blocked !== "object") {
        settings.blocked = {};
      }

      postSettingsToMain();
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data;
    if (data?.source !== MESSAGE_SOURCE) return;
    if (data.type === "ready") postSettingsToMain();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    loadSettings();
  });

  loadSettings();
})();
