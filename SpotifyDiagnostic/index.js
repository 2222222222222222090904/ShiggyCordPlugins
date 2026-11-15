(function(exports, vendetta) {
  "use strict";

  const metro = vendetta.metro;
  const common = vendetta.metro.common;
  const dispatcher = common.FluxDispatcher;
  const SpotifyStore = metro.findByStoreName?.("SpotifyStore");
  const SpotifyProtocolStore = metro.findByStoreName?.("SpotifyProtocolStore");
  const subscriptions = [];
  let unpatchDispatch = null;
  let timer = null;
  let previousSnapshot = "";

  const eventNames = [
    "SPOTIFY_PLAYER_STATE",
    "SPOTIFY_PLAYER_STATE_UPDATE",
    "SPOTIFY_PROTOCOL_CONNECTED",
    "SPOTIFY_PROTOCOL_DISCONNECTED",
    "SPOTIFY_PROTOCOL_REGISTERED",
    "SPOTIFY_SOCKET_STATE_CHANGED",
    "SPOTIFY_DEVICE_UPDATE",
    "SPOTIFY_PROFILE_UPDATE"
  ];

  function methodNames(store) {
    if (!store) return [];
    return [...new Set([
      ...Object.keys(store),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(store) || {})
    ])].filter(key => typeof store[key] === "function");
  }

  function safeKeys(value) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return [];
    return [...new Set([
      ...Object.keys(value),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(value) || {})
    ])].filter(key => !/(token|auth|cookie|header|secret|credential)/i.test(key));
  }

  function reportModuleInventory() {
    try {
      const matches = metro.findAll?.(value => {
        if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
        return Object.keys(value).some(key => /spotify/i.test(key));
      }) ?? [];
      console.log("[SpotifyDiag] module inventory", matches.slice(0, 40).map(safeKeys));
    } catch (error) {
      console.warn("[SpotifyDiag] module inventory failed", String(error));
    }
  }

  function reportApiShape() {
    try {
      const apiModule = metro.findByProps?.("SpotifyAPI", "subscribePlayerStateNotifications");
      const api = apiModule?.SpotifyAPI;
      const subscribe = apiModule?.subscribePlayerStateNotifications;
      console.log("[SpotifyDiag] api shape", {
        module: safeKeys(apiModule),
        api: safeKeys(api),
        apiType: typeof api,
        subscribeType: typeof subscribe,
        subscribeArity: typeof subscribe === "function" ? subscribe.length : null,
        apiSubscribeArity: typeof api?.subscribePlayerStateNotifications === "function"
          ? api.subscribePlayerStateNotifications.length
          : null
      });
    } catch (error) {
      console.warn("[SpotifyDiag] api shape failed", String(error));
    }
  }

  function readSnapshot() {
    let active = null;
    let player = null;
    let registered = null;

    try { active = SpotifyStore?.getActiveSocketAndDevice?.() ?? null; }
    catch (error) { console.warn("[SpotifyDiag] active read failed", String(error)); }
    try { player = SpotifyStore?.getPlayerState?.() ?? null; }
    catch (error) { console.warn("[SpotifyDiag] player read failed", String(error)); }
    try { registered = SpotifyProtocolStore?.isProtocolRegistered?.() ?? null; }
    catch (error) { console.warn("[SpotifyDiag] protocol read failed", String(error)); }

    const socket = active?.socket ?? active?.spotifySocket ?? active?.[0] ?? null;
    const device = active?.device ?? active?.spotifyDevice ?? active?.[1] ?? null;
    const track = player?.track ?? player?.item ?? null;

    return {
      protocolRegistered: registered === null ? null : Boolean(registered),
      hasActiveSocket: Boolean(socket),
      hasActiveDevice: Boolean(device),
      hasPlayerState: Boolean(player),
      isPlaying: player?.isPlaying ?? player?.is_playing ?? player?.playing ?? null,
      trackId: track?.id ?? player?.trackId ?? player?.track_id ?? null,
      positionMs: player?.position ?? player?.positionMs ?? player?.position_ms ?? null,
      durationMs: track?.duration ?? track?.durationMs ?? track?.duration_ms ?? null
    };
  }

  function reportSnapshot(reason) {
    const snapshot = readSnapshot();
    const encoded = JSON.stringify(snapshot);
    if (encoded === previousSnapshot && reason === "poll") return;
    previousSnapshot = encoded;
    console.log("[SpotifyDiag] snapshot", reason, snapshot);
  }

  function subscribeEvent(type) {
    if (!dispatcher?.subscribe) return;
    const handler = payload => {
      // Deliberately log only the event type and safe state derived from stores.
      console.log("[SpotifyDiag] event", type);
      setTimeout(() => reportSnapshot(type), 0);
    };
    dispatcher.subscribe(type, handler);
    subscriptions.push(() => dispatcher.unsubscribe(type, handler));
  }

  const plugin = {
    onLoad() {
      console.log("[SpotifyDiag] loaded", {
        spotifyStore: Boolean(SpotifyStore),
        protocolStore: Boolean(SpotifyProtocolStore),
        spotifyMethods: methodNames(SpotifyStore),
        protocolMethods: methodNames(SpotifyProtocolStore)
      });
      try {
        const active = SpotifyStore?.getActiveSocketAndDevice?.() ?? null;
        const socket = active?.socket ?? active?.spotifySocket ?? active?.[0] ?? null;
        const device = active?.device ?? active?.spotifyDevice ?? active?.[1] ?? null;
        console.log("[SpotifyDiag] active shape", {
          active: safeKeys(active),
          socket: safeKeys(socket),
          device: safeKeys(device)
        });
      } catch (error) {
        console.warn("[SpotifyDiag] active shape failed", String(error));
      }
      reportModuleInventory();
      reportApiShape();
      eventNames.forEach(subscribeEvent);
      if (dispatcher?.dispatch && vendetta.patcher?.before) {
        unpatchDispatch = vendetta.patcher.before("dispatch", dispatcher, args => {
          const type = args?.[0]?.type;
          if (typeof type !== "string" || !type.toUpperCase().includes("SPOTIFY")) return;
          console.log("[SpotifyDiag] dispatch", type, safeKeys(args?.[0]));
          setTimeout(() => reportSnapshot(`dispatch:${type}`), 0);
        });
        console.log("[SpotifyDiag] dispatch trace enabled");
      }
      reportSnapshot("load");
      timer = setInterval(() => reportSnapshot("poll"), 1000);
    },
    onUnload() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      try { unpatchDispatch?.(); }
      catch (error) { console.warn("[SpotifyDiag] dispatch unpatch failed", String(error)); }
      unpatchDispatch = null;
      while (subscriptions.length) {
        try { subscriptions.pop()(); }
        catch (error) { console.warn("[SpotifyDiag] unsubscribe failed", String(error)); }
      }
      console.log("[SpotifyDiag] unloaded");
    }
  };

  exports.default = plugin;
  Object.defineProperty(exports, "__esModule", { value: true });
  return exports;
})({}, vendetta);
