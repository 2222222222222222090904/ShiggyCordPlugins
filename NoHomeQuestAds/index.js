(function(exports, vendetta) {
  "use strict";

  const unpatches = [];
  const timers = new Set();
  const paths = [
    "modules/quests/native/QuestDock/QuestDock.tsx",
    "modules/quests/native/QuestDock/QuestDockContentCollapsed.tsx",
    "modules/quests/native/QuestDock/QuestDockContentExpanded.tsx"
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

    let patched = 0;
    for (const path of paths) {
      const module = metro.findByFilePath(path, false);
      if (!module) continue;

      if (suppressComponent(module, "default", module.default, path)) {
        patched++;
        continue;
      }

      for (const key of Object.keys(module)) {
        if (suppressComponent(module, key, module[key], `${path}:${key}`)) {
          patched++;
          break;
        }
      }

      console.warn("[NoHomeQuestAds] module found without patchable component", path, Object.keys(module));
    }

    if (!patched) console.warn("[NoHomeQuestAds] QuestDock module not found");
    return patched > 0;
  }

  function refreshQuestDock() {
    const metro = vendetta.metro;
    const store = metro.findByStoreName?.("QuestDockStore");
    const keys = store
      ? [...new Set([...Object.keys(store), ...Object.getOwnPropertyNames(Object.getPrototypeOf(store) ?? {})])]
      : [];
    console.log("[NoHomeQuestAds] QuestDockStore", !!store, keys);

    try { store?.emitChange?.(); }
    catch (error) { console.warn("[NoHomeQuestAds] store refresh failed", String(error)); }

    const dispatcher = metro.findByProps?.("dispatch", "subscribe");
    try { dispatcher?.dispatch?.({ type: "QUESTS_FETCH_SUCCESS" }); }
    catch (error) { console.warn("[NoHomeQuestAds] dispatcher refresh failed", String(error)); }
  }

  const plugin = {
    onLoad() {
      patchQuestDock();
      for (const delay of [0, 500, 2000]) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          refreshQuestDock();
        }, delay);
        timers.add(timer);
      }
    },
    onUnload() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
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
