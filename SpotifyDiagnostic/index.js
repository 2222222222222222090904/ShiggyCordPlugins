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
      eventNames.forEach(subscribeEvent);
      if (dispatcher?.dispatch && vendetta.patcher?.before) {
        unpatchDispatch = vendetta.patcher.before("dispatch", dispatcher, args => {
          const type = args?.[0]?.type;
          if (typeof type !== "string" || !type.toUpperCase().includes("SPOTIFY")) return;
          console.log("[SpotifyDiag] dispatch", type);
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
