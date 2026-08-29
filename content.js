// Content script. Runs inside the YouTube live_chat iframe (and popout chat page).
// Watches for new chat messages, filters by the configured user/keyword, and
// forwards matches to the background service worker.

(function () {
  // Only operate inside the actual live chat document.
  if (!location.pathname.startsWith("/live_chat")) return;

  const MSG_TAGS = new Set([
    "YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER",
    "YT-LIVE-CHAT-PAID-MESSAGE-RENDERER",
    "YT-LIVE-CHAT-PAID-STICKER-RENDERER",
    "YT-LIVE-CHAT-MEMBERSHIP-ITEM-RENDERER",
  ]);
  const INNER_SELECTOR =
    "yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer, yt-live-chat-paid-sticker-renderer, yt-live-chat-membership-item-renderer";

  let monitor = null;
  let observer = null;
  let listContainer = null;

  init();

  async function init() {
    try {
      const data = await chrome.storage.local.get("monitor");
      monitor = data.monitor || null;
    } catch (_) {
      monitor = null;
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.monitor) return;
      const prev = monitor;
      monitor = changes.monitor.newValue;
      // When monitoring is (re)activated, scan messages already on screen.
      if (monitor && monitor.active && !(prev && prev.active)) {
        scanExisting();
      }
    });

    waitForList();
  }

  function getItemsContainer() {
    return (
      document.querySelector("yt-live-chat-item-list-renderer #items") ||
      document.querySelector("#items.yt-live-chat-item-list-renderer") ||
      document.querySelector("#chat #items")
    );
  }

  function waitForList() {
    const found = getItemsContainer();
    if (found) {
      startObserving(found);
      return;
    }
    // Chat may not be rendered yet; retry for a while.
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const c = getItemsContainer();
      if (c) {
        clearInterval(timer);
        startObserving(c);
      } else if (tries > 120) {
        // ~60s of polling; give up quietly.
        clearInterval(timer);
      }
    }, 500);
  }

  function startObserving(container) {
    if (observer && listContainer === container) return;
    if (observer) observer.disconnect();
    listContainer = container;
    observer = new MutationObserver((mutations) => {
      for (const mu of mutations) {
        for (const node of mu.addedNodes) {
          if (node.nodeType === 1) handleNode(node);
        }
      }
    });
    observer.observe(container, { childList: true });
    if (monitor && monitor.active) scanExisting();
  }

  function scanExisting() {
    const container = listContainer || getItemsContainer();
    if (!container) return;
    for (const child of Array.from(container.children)) {
      handleNode(child);
    }
  }

  function handleNode(node) {
    if (!monitor || !monitor.active) return;
    let el = node;
    if (!MSG_TAGS.has(el.tagName)) {
      const inner = el.querySelector ? el.querySelector(INNER_SELECTOR) : null;
      if (inner) el = inner;
      else return;
    }
    processMessage(el);
  }

  function extractText(el) {
    if (!el) return "";
    let out = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === "IMG") {
          out += node.getAttribute("alt") || node.getAttribute("aria-label") || "";
        } else {
          out += extractText(node);
        }
      }
    }
    return out.replace(/\s+/g, " ").trim();
  }

  function processMessage(el) {
    if (el.dataset && el.dataset.ytmonSeen) return;
    if (el.dataset) el.dataset.ytmonSeen = "1";

    const author = (el.querySelector("#author-name")?.textContent || "").trim();
    const message = extractText(el.querySelector("#message"));
    const chatTime = (el.querySelector("#timestamp")?.textContent || "").trim();

    if (!author && !message) return;
    if (!isMatch(author, message)) return;

    const payload = {
      id:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      author,
      message,
      chatTime,
      recvTime: Date.now(),
    };

    try {
      chrome.runtime.sendMessage({ type: "match", payload });
    } catch (_) {
      // Extension context can be invalidated on reload; ignore.
    }
  }

  function isMatch(author, message) {
    const m = monitor;
    if (!m) return false;
    const uname = (m.username || "").trim();
    const kw = (m.keyword || "").trim();
    if (!uname && !kw) return false; // nothing to match against

    if (uname) {
      const a = author.toLowerCase();
      const u = uname.toLowerCase().replace(/^@/, "");
      const aTrim = a.replace(/^@/, "");
      const ok = m.usernameContains ? aTrim.includes(u) : aTrim === u;
      if (!ok) return false;
    }

    if (kw) {
      const haystack = m.caseSensitive ? message : message.toLowerCase();
      const needle = m.caseSensitive ? kw : kw.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    return true;
  }
})();
