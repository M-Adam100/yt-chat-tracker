// Background service worker: single source of truth for monitor state and matches.
// Content scripts (running in the live_chat iframe) send matches here; this worker
// serializes writes to chrome.storage.local so the popup and results page can react.

const DEFAULT_MONITOR = {
  active: false,
  streamUrl: "",
  usernamesRaw: "",
  keywordsRaw: "",
  usernames: [],
  keywords: [],
  usernameContains: false,
  caseSensitive: false,
  sessionId: null,
  startedAt: null,
};

const DEFAULT_STATUS = { state: "idle", ts: null };

// In-memory cache. Rebuilt from storage whenever the worker wakes up.
let cache = null;
let writeChain = Promise.resolve();

function parseList(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function keyOf(m) {
  return `${(m.author || "").toLowerCase()}|${m.chatTime || ""}|${m.message || ""}`;
}

async function ensureCache() {
  if (cache) return cache;
  const data = await chrome.storage.local.get(["monitor", "matches", "status"]);
  const matches = Array.isArray(data.matches) ? data.matches : [];
  cache = {
    monitor: { ...DEFAULT_MONITOR, ...(data.monitor || {}) },
    matches,
    status: { ...DEFAULT_STATUS, ...(data.status || {}) },
    keys: new Set(matches.map(keyOf)),
  };
  return cache;
}

// Run a task with exclusive access to the cache/storage to avoid races between
// matches arriving from multiple frames at once.
function enqueue(task) {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => {});
  return run;
}

async function updateBadge(count, active) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: active ? "#e11d48" : "#6b7280" });
    await chrome.action.setBadgeText({ text: count > 0 ? formatBadge(count) : "" });
  } catch (_) {
    /* action API may be unavailable in some contexts */
  }
}

function formatBadge(n) {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return Math.round(n / 1000) + "k";
}

async function setStatus(state) {
  return enqueue(async () => {
    const c = await ensureCache();
    c.status = { state, ts: Date.now() };
    await chrome.storage.local.set({ status: c.status });
    return c.status;
  });
}

async function addMatch(payload) {
  return enqueue(async () => {
    const c = await ensureCache();
    if (!c.monitor.active) return { added: false, reason: "inactive" };
    const key = keyOf(payload);
    if (c.keys.has(key)) return { added: false, reason: "duplicate" };
    c.keys.add(key);
    payload.sessionId = c.monitor.sessionId;
    c.matches.push(payload);
    await chrome.storage.local.set({ matches: c.matches });
    await updateBadge(c.matches.length, true);
    return { added: true, total: c.matches.length };
  });
}

async function startMonitor(config, clearPrevious) {
  return enqueue(async () => {
    const c = await ensureCache();
    if (clearPrevious) {
      c.matches = [];
      c.keys = new Set();
      await chrome.storage.local.set({ matches: [] });
    }
    c.monitor = {
      ...c.monitor,
      active: true,
      streamUrl: config.streamUrl || "",
      usernamesRaw: config.usernames || "",
      keywordsRaw: config.keywords || "",
      usernames: parseList(config.usernames),
      keywords: parseList(config.keywords),
      usernameContains: !!config.usernameContains,
      caseSensitive: !!config.caseSensitive,
      sessionId:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now()),
      startedAt: Date.now(),
    };
    c.status = { state: "searching", ts: Date.now() };
    await chrome.storage.local.set({ monitor: c.monitor, status: c.status });
    await updateBadge(c.matches.length, true);
    return c.monitor;
  });
}

async function stopMonitor() {
  return enqueue(async () => {
    const c = await ensureCache();
    c.monitor = { ...c.monitor, active: false };
    c.status = { state: "stopped", ts: Date.now() };
    await chrome.storage.local.set({ monitor: c.monitor, status: c.status });
    await updateBadge(c.matches.length, false);
    return c.monitor;
  });
}

async function clearMatches() {
  return enqueue(async () => {
    const c = await ensureCache();
    c.matches = [];
    c.keys = new Set();
    await chrome.storage.local.set({ matches: [] });
    await updateBadge(0, c.monitor.active);
    return { cleared: true };
  });
}

function parseVideoId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    const live = u.pathname.match(/\/live\/([^/?]+)/);
    if (live) return live[1];
    return null;
  } catch (_) {
    return null;
  }
}

function normalizeStreamUrl(input) {
  const raw = (input || "").trim();
  if (!raw) return null;
  const vid = parseVideoId(raw);
  if (vid) return `https://www.youtube.com/watch?v=${vid}`;
  try {
    const u = new URL(raw);
    if (u.hostname.endsWith("youtube.com")) return raw;
  } catch (_) {
    /* not a URL */
  }
  return null;
}

async function openStream(streamUrl) {
  const url = normalizeStreamUrl(streamUrl);
  if (!url) return { ok: false, error: "invalid_url" };
  const vid = parseVideoId(url);
  if (vid) {
    const tabs = await chrome.tabs.query({ url: "*://www.youtube.com/*" });
    const existing = tabs.find((t) => parseVideoId(t.url) === vid);
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId != null) {
        try {
          await chrome.windows.update(existing.windowId, { focused: true });
        } catch (_) {}
      }
      return { ok: true, tabId: existing.id, reused: true };
    }
  }
  const tab = await chrome.tabs.create({ url });
  return { ok: true, tabId: tab.id, reused: false };
}

async function openResults() {
  const url = chrome.runtime.getURL("results/results.html");
  const tabs = await chrome.tabs.query({ url });
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId != null) {
      try {
        await chrome.windows.update(tabs[0].windowId, { focused: true });
      } catch (_) {}
    }
    return { ok: true, tabId: tabs[0].id, reused: true };
  }
  const tab = await chrome.tabs.create({ url });
  return { ok: true, tabId: tab.id, reused: false };
}

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["monitor", "matches", "status"]);
  const patch = {};
  if (!data.monitor) patch.monitor = DEFAULT_MONITOR;
  if (!Array.isArray(data.matches)) patch.matches = [];
  if (!data.status) patch.status = DEFAULT_STATUS;
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "match": {
        sendResponse(await addMatch(msg.payload));
        break;
      }
      case "status": {
        sendResponse(await setStatus(msg.status));
        break;
      }
      case "getState": {
        const c = await ensureCache();
        sendResponse({ monitor: c.monitor, matches: c.matches, status: c.status });
        break;
      }
      case "startMonitor": {
        const monitor = await startMonitor(msg.config, msg.clearPrevious !== false);
        let stream = { ok: true };
        if (msg.openTab !== false) stream = await openStream(monitor.streamUrl);
        if (msg.openResults) await openResults();
        sendResponse({ monitor, stream });
        break;
      }
      case "stopMonitor": {
        sendResponse({ monitor: await stopMonitor() });
        break;
      }
      case "clearMatches": {
        sendResponse(await clearMatches());
        break;
      }
      case "openResults": {
        sendResponse(await openResults());
        break;
      }
      case "openStream": {
        sendResponse(await openStream(msg.streamUrl));
        break;
      }
      default:
        sendResponse({ error: "unknown_message" });
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
