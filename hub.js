(function(exports, vendetta) {
  "use strict";
  let active = false;
  const base = vendetta.plugin.id.endsWith("/") ? vendetta.plugin.id : vendetta.plugin.id + "/";
  const repository = "https://api.github.com/repos/2222222222222222090904/ShiggyCordPlugins/contents";

  async function discover() {
    try {
      const response = await fetch(repository);
      if (!response.ok) throw new Error("GitHub returned " + response.status);
      const entries = await response.json();
      if (!Array.isArray(entries)) throw new Error("Unexpected GitHub response");

      for (const entry of entries) {
        if (!active) return;
        if (entry?.type !== "dir" || !/^[A-Za-z0-9_-]+$/.test(entry.name)) continue;
        const url = new URL(entry.name + "/", base).toString();
        if (vendetta.plugins.plugins[url]) continue;

        try {
          const manifest = await fetch(url + "manifest.json");
          if (!manifest.ok) continue;
          const data = await manifest.json();
          if (!data?.name || !data?.main || !data?.hash) continue;
          if (!active) return;
          await vendetta.plugins.installPlugin(url, false);
          console.log("[MyPluginHub] added disabled plugin", entry.name);
        } catch (error) {
          console.warn("[MyPluginHub] skipped", entry.name, String(error));
        }
      }
    } catch (error) {
      console.warn("[MyPluginHub] discovery failed", String(error));
    }
  }

  const plugin = {
    onLoad() { active = true; discover(); },
    onUnload() { active = false; }
  };
  exports.default = plugin;
  Object.defineProperty(exports, "__esModule", {value: true});
  return exports;
})({}, vendetta);
