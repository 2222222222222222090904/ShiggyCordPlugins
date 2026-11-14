(function(exports, metro, patcher, vendetta, common) {
  "use strict";
  const dispatcher = metro.findByProps("dispatch", "subscribe");
  const api = metro.findByProps("get", "post", "del", "patch");
  const users = metro.findByProps("getUser", "getCurrentUser");
  const userUtils = metro.findByProps("fetchProfile", "getUser", "fetchUser");
  const messages = metro.findByStoreName?.("MessageStore") ?? metro.findByProps("getMessages", "getMessage");
  const selected = metro.findByStoreName?.("SelectedChannelStore") ?? metro.findByProps("getChannelId");
  const mention = /<@!?(\d{17,19})>/g;
  const seen = new Set();
  const pending = new Map();
  const refreshTimers = new Map();
  const rowPatches = [];
  const timers = new Set();
  let active = false;
  let running = 0;
  const waiting = [];
  let lastChannelId;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function limited(work, priority) {
    let entry;
    const promise = new Promise(resolve => {
      entry = {priority, run: async () => {
        running++;
        try { resolve(await work()); }
        catch (error) {
          console.warn("[ValidUserAuto] lookup failed", String(error));
          resolve(false);
        }
        finally {
          running--;
          waiting.sort((a, b) => b.priority - a.priority);
          waiting.shift()?.run();
        }
      }};
      if (running < 3) entry.run();
      else waiting.push(entry);
    });
    return {promise, entry};
  }

  function ids(message) {
    const result = new Set();
    const scan = value => {
      if (typeof value !== "string") return;
      for (const match of value.matchAll(mention)) {
        if (!users?.getUser?.(match[1])) result.add(match[1]);
      }
    };
    scan(message?.content);
    for (const embed of message?.embeds ?? []) {
      scan(embed.rawTitle ?? embed.title);
      scan(embed.rawDescription ?? embed.description);
      for (const field of embed.fields ?? []) {
        scan(field.rawName ?? field.name);
        scan(field.rawValue ?? field.value);
      }
    }
    const scanComponents = components => {
      for (const component of components ?? []) {
        scan(component?.content);
        scanComponents(component?.components);
      }
    };
    scanComponents(message?.components);
    for (const snapshot of message?.messageSnapshots ?? []) {
      scan(snapshot?.message?.content);
      scanComponents(snapshot?.message?.components);
    }
    return [...result];
  }

  async function refreshMessage(message, channelId, key) {
    if (!active) return;
    dispatcher.dispatch({type: "MESSAGE_UPDATE", message: {
      id: message.id, channel_id: channelId,
      content: (message.content ?? "") + "\u200B ", embeds: message.embeds
    }});
    await pause(110);
    if (!active) return;
    dispatcher.dispatch({type: "MESSAGE_UPDATE", message: {
      id: message.id, channel_id: channelId,
      content: message.content, attachments: message.attachments,
      embeds: message.embeds, components: message.components, flags: message.flags
    }});
    console.log("[ValidUserAuto] refreshed", key);
  }

  function scheduleRefresh(message, channelId, key) {
    if (refreshTimers.has(key)) return;
    const timer = setTimeout(() => {
      refreshTimers.delete(key);
      refreshMessage(message, channelId, key).catch(error =>
        console.warn("[ValidUserAuto] message refresh failed", String(error)));
    }, 120);
    refreshTimers.set(key, timer);
  }

  function fetchUser(id, priority) {
    if (users?.getUser?.(id)) return Promise.resolve(true);
    if (pending.has(id)) {
      const existing = pending.get(id);
      existing.entry.priority = Math.max(existing.entry.priority, priority);
      return existing.promise;
    }
    const job = limited(async () => {
      if (typeof userUtils?.fetchUser === "function") {
        try {
          await userUtils.fetchUser(id);
          if (users?.getUser?.(id)) return true;
        } catch (error) {
          console.warn("[ValidUserAuto] native lookup failed", error?.status ?? String(error));
        }
      }
      for (let attempt = 0; attempt < 3 && active; attempt++) {
        try {
          const response = await api.get({url: `/users/${id}`});
          if (response?.body?.id) {
            dispatcher.dispatch({type: "USER_UPDATE", user: response.body});
            return true;
          }
          return false;
        } catch (error) {
          if (error?.status !== 429) return false;
          console.log("[ValidUserAuto] rate limited", attempt + 1);
          await pause(Math.min(30000, Math.max(1000, Number(error?.body?.retry_after ?? 1000))));
        }
      }
      return false;
    }, priority);
    pending.set(id, job);
    job.promise.finally(() => pending.delete(id));
    return job.promise;
  }

  function inspect(message, priority = 0) {
    if (!active || !message?.id) return;
    const channelId = message.channel_id ?? message.channelId;
    if (!channelId) return;
    const key = `${channelId}:${message.id}`;
    if (seen.has(key)) {
      for (const id of ids(message)) {
        const existing = pending.get(id);
        if (existing) existing.entry.priority = Math.max(existing.entry.priority, priority);
      }
      return;
    }
    const missing = ids(message);
    if (!missing.length) return;
    seen.add(key);
    Promise.all(missing.map(id => fetchUser(id, priority).then(ok => {
      if (active && ok) scheduleRefresh(message, channelId, key);
      return ok;
    }))).then(results => {
      if (results.some(result => !result)) seen.delete(key);
    }).catch(error => console.warn("[ValidUserAuto] message refresh failed", String(error)));
  }

  function scanSelected(channelHint) {
    const channelId = selected?.getChannelId?.() ?? channelHint ?? lastChannelId;
    if (channelId) lastChannelId = channelId;
    const collection = channelId && messages?.getMessages?.(channelId);
    const entries = collection?._array ?? collection?.toArray?.() ?? collection?.messages ?? [];
    const list = Array.isArray(entries) ? entries : Object.values(entries ?? {});
    list.forEach(message => inspect(message, 0));
    console.log("[ValidUserAuto] scan", !!channelId, list.length, !!messages?.getMessages);
  }

  const events = ["MESSAGE_CREATE", "LOAD_MESSAGES_SUCCESS", "MESSAGE_LOAD_SUCCESS", "CHANNEL_SELECT", "CHANNEL_SELECTED"];
  const handlers = new Map();
  const plugin = {
    onLoad() {
      active = true;
      console.log("[ValidUserAuto] loaded", !!dispatcher, !!api, !!users, !!messages, !!selected);
      if (!dispatcher?.subscribe || !api?.get || !users?.getUser) return;
      for (const name of ["MessageListItem", "MessagesItem", "MessageRow", "ChatMessage", "MessageContent"]) {
        const matches = metro.findByTypeNameAll?.(name) ?? [];
        console.log("[ValidUserAuto] row candidate", name, matches.length);
        for (const component of matches) {
          if (typeof component?.type !== "function") continue;
          rowPatches.push(patcher.after("type", component, args => {
            const props = args?.[0];
            const message = props?.message ?? props?.item?.message ?? props?.item;
            if (message?.id && (message?.channel_id || message?.channelId)) inspect(message, 3000);
          }));
        }
      }
      for (const event of events) {
        const handler = payload => {
          if (event === "MESSAGE_CREATE") inspect(payload?.message, 2000);
          else {
            const batch = payload?.messages;
            const channelHint = payload?.channelId ?? payload?.channel_id ?? payload?.channel?.id;
            if (channelHint) lastChannelId = channelHint;
            const currentChannel = selected?.getChannelId?.() ?? lastChannelId;
            if (Array.isArray(batch) && (!currentChannel || channelHint === currentChannel))
              batch.forEach(message => inspect(message, 0));
            const timer = setTimeout(() => {timers.delete(timer); scanSelected(channelHint);}, 300);
            timers.add(timer);
          }
        };
        dispatcher.subscribe(event, handler);
        handlers.set(event, handler);
      }
      for (const delay of [500, 2000, 5000]) {
        const timer = setTimeout(() => {timers.delete(timer); scanSelected();}, delay);
        timers.add(timer);
      }
    },
    onUnload() {
      active = false;
      for (const [event, handler] of handlers) dispatcher.unsubscribe(event, handler);
      handlers.clear();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const timer of refreshTimers.values()) clearTimeout(timer);
      refreshTimers.clear();
      for (const unpatch of rowPatches) unpatch();
      rowPatches.length = 0;
      seen.clear();
    }
  };
  exports.default = plugin;
  Object.defineProperty(exports, "__esModule", {value: true});
  return exports;
})({}, vendetta.metro, vendetta.patcher, vendetta, vendetta.metro.common);
