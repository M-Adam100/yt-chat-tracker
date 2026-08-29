// Background service worker: single source of truth for monitor state and matches.
// Content scripts (running in the live_chat iframe) send matches here; this worker
// serializes writes to chrome.storage.local so the popup and results page can react.

const DEFAULT_MONITOR = {
  active: false,
  streamUrl: "",
  username: "",
  keyword: "",
  usernameContains: false,
  caseSensitive: false,
  startedAt: null,
};

// In-memory cache. Rebuilt from storage whenever the worker wakes up.
let cache = null;
let writeChain = Promise.resolve();

function keyOf(m) {
  return `${(m.author || "").toLowerCase()}|${m.chatTime || ""}|${m.message || ""}`;
}

async function ensureCache() {
  if (cache) return cache;
  const data = await chrome.storage.local.get(["monitor", "matches"]);
  const matches = Array.isArray(data.matches) ? data.matches : [];
  cache = {
    monitor: { ...DEFAULT_MONITOR, ...(data.monitor || {}) },
    matches,
    keys: new Set(matches.map(keyOf)),
  };
  return cache;
}

// Run a task with exclusive access to the cache/storage to avoid races between
// matches arriving from multiple frames at once.
function enqueue(task) {
  const run = writeChain.then(task, task);
  // Keep the chain alive even if a task throws.
  writeChain = run.catch(() => {});
  return run;
}

async function updateBadge(count) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: "#c00" });
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  } catch (_) {
    /* action API may be unavailable in some contexts */
  }
}

async function addMatch(payload) {
  return enqueue(async () => {
    const c = await ensureCache();
    if (!c.monitor.active) return { added: false, reason: "inactive" };
    const key = keyOf(payload);
    if (c.keys.has(key)) return { added: false, reason: "duplicate" };
    c.keys.add(key);
    c.matches.push(payload);
    await chrome.storage.local.set({ matches: c.matches });
    await updateBadge(c.matches.length);
    return { added: true, total: c.matches.length };
  });
}

async function setMonitor(next) {
  return enqueue(async () => {
    const c = await ensureCache();
    c.monitor = { ...c.monitor, ...next };
    await chrome.storage.local.set({ monitor: c.monitor });
    return c.monitor;
  });
}

async function clearMatches() {
  return enqueue(async () => {
    const c = await ensureCache();
    c.matches = [];
    c.keys = new Set();
    await chrome.storage.local.set({ matches: [] });
    await updateBadge(0);
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
  // Popout chat pages are fine as-is.
  const vid = parseVideoId(raw);
  if (vid) return `https://www.youtube.com/watch?v=${vid}`;
  // Fall back to whatever the user pasted if it's already a youtube URL.
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
  const data = await chrome.storage.local.get(["monitor", "matches"]);
  const patch = {};
  if (!data.monitor) patch.monitor = DEFAULT_MONITOR;
  if (!Array.isArray(data.matches)) patch.matches = [];
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "match": {
        const res = await addMatch(msg.payload);
        sendResponse(res);
        break;
      }
      case "getState": {
        const c = await ensureCache();
        sendResponse({ monitor: c.monitor, matches: c.matches });
        break;
      }
      case "startMonitor": {
        const monitor = await setMonitor({
          active: true,
          streamUrl: msg.config.streamUrl || "",
          username: msg.config.username || "",
          keyword: msg.config.keyword || "",
          usernameContains: !!msg.config.usernameContains,
          caseSensitive: !!msg.config.caseSensitive,
          startedAt: Date.now(),
        });
        let stream = { ok: true };
        if (msg.openTab !== false) stream = await openStream(monitor.streamUrl);
        if (msg.openResults) await openResults();
        sendResponse({ monitor, stream });
        break;
      }
      case "stopMonitor": {
        const monitor = await setMonitor({ active: false });
        sendResponse({ monitor });
        break;
      }
      case "clearMatches": {
        const res = await clearMatches();
        sendResponse(res);
        break;
      }
      case "openResults": {
        const res = await openResults();
        sendResponse(res);
        break;
      }
      case "openStream": {
        const res = await openStream(msg.streamUrl);
        sendResponse(res);
        break;
      }
      default:
        sendResponse({ error: "unknown_message" });
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
