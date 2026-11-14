(function(exports, vendetta) {
  "use strict";

  const unpatches = [];
  const paths = [
    "modules/quests/native/QuestDock/QuestDock.tsx"
  ];

  function suppressComponent(owner, key, component, label) {
    if (typeof component === "function") {
      unpatches.push(vendetta.patcher.instead(key, owner, () => null));
      console.log("[NoHomeQuestAds] suppressed", label, "function export");
      return true;
    }

    if (typeof component?.type === "function") {
      unpatches.push(vendetta.patcher.instead("type", component, () => null));
      console.log("[NoHomeQuestAds] suppressed", label, "memo type");
      return true;
    }

    if (typeof component?.render === "function") {
      unpatches.push(vendetta.patcher.instead("render", component, () => null));
      console.log("[NoHomeQuestAds] suppressed", label, "forward-ref render");
      return true;
    }

    return false;
  }

  function patchQuestDock() {
    const metro = globalThis.bunny?.metro;
    if (typeof metro?.findByFilePath !== "function") {
      console.warn("[NoHomeQuestAds] ShiggyCord file-path finder unavailable");
      return false;
    }

    for (const path of paths) {
      const module = metro.findByFilePath(path, false);
      if (!module) continue;

      if (suppressComponent(module, "default", module.default, path)) return true;

      for (const key of Object.keys(module)) {
        if (suppressComponent(module, key, module[key], `${path}:${key}`)) return true;
      }

      console.warn("[NoHomeQuestAds] module found without patchable component", path, Object.keys(module));
    }

    console.warn("[NoHomeQuestAds] QuestDock module not found");
    return false;
  }

  const plugin = {
    onLoad() {
      patchQuestDock();
    },
    onUnload() {
      while (unpatches.length) {
        try { unpatches.pop()(); }
        catch (error) { console.warn("[NoHomeQuestAds] unpatch failed", String(error)); }
      }
    }
  };

  exports.default = plugin;
  Object.defineProperty(exports, "__esModule", { value: true });
  return exports;
})({}, vendetta);
