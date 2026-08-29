// Content script. Runs inside the YouTube live_chat iframe (and popout chat page).
// Watches for new chat messages, filters by the configured user(s)/keyword(s), and
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
  let reportedConnected = false;

  init();

  // Let the background worker detect whether this frame has a live content script.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "ping") {
      sendResponse({ pong: true });
      return true;
    }
  });

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
        reportedConnected = false;
        maybeReportConnected();
        scanExisting();
      }
    });

    waitForList();
    startWatchdog();
  }

  // YouTube can replace the chat item container when toggling Top/Live chat,
  // reconnecting, or reloading. Re-attach the observer if that happens.
  function startWatchdog() {
    setInterval(() => {
      if (!monitor || !monitor.active) return;
      const current = getItemsContainer();
      if (current && current !== listContainer) {
        startObserving(current);
      } else if (listContainer && !listContainer.isConnected) {
        const next = getItemsContainer();
        if (next) startObserving(next);
      }
    }, 4000);
  }

  function report(status) {
    try {
      chrome.runtime.sendMessage({ type: "status", status });
    } catch (_) {
      /* context may be gone */
    }
  }

  function maybeReportConnected() {
    if (reportedConnected) return;
    if (listContainer && monitor && monitor.active) {
      reportedConnected = true;
      report("connected");
    }
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
    report("searching");
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const c = getItemsContainer();
      if (c) {
        clearInterval(timer);
        startObserving(c);
      } else if (tries > 120) {
        clearInterval(timer);
        report("notfound");
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
    maybeReportConnected();
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

  function getAuthorPhoto(el) {
    const img = el.querySelector("#author-photo img, yt-img-shadow img");
    if (!img) return "";
    return img.getAttribute("src") || "";
  }

  function processMessage(el) {
    if (el.dataset && el.dataset.ytmonSeen) return;
    if (el.dataset) el.dataset.ytmonSeen = "1";

    const author = (el.querySelector("#author-name")?.textContent || "").trim();
    const message = extractText(el.querySelector("#message"));
    const chatTime = (el.querySelector("#timestamp")?.textContent || "").trim();

    if (!author && !message) return;

    const result = evaluate(author, message);
    if (!result.ok) return;

    const payload = {
      id:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      author,
      authorPhoto: getAuthorPhoto(el),
      message,
      chatTime,
      recvTime: Date.now(),
      matchedKeywords: result.matchedKeywords,
      type: rendererType(el),
    };

    try {
      chrome.runtime.sendMessage({ type: "match", payload });
    } catch (_) {
      // Extension context can be invalidated on reload; ignore.
    }
  }

  function rendererType(el) {
    switch (el.tagName) {
      case "YT-LIVE-CHAT-PAID-MESSAGE-RENDERER":
        return "superchat";
      case "YT-LIVE-CHAT-PAID-STICKER-RENDERER":
        return "sticker";
      case "YT-LIVE-CHAT-MEMBERSHIP-ITEM-RENDERER":
        return "membership";
      default:
        return "text";
    }
  }

  function evaluate(author, message) {
    const m = monitor;
    if (!m) return { ok: false };

    const usernames = m.usernames || [];
    const keywords = m.keywords || [];
    if (!usernames.length && !keywords.length) return { ok: false };

    if (usernames.length) {
      const a = author.toLowerCase().replace(/^@/, "");
      const matchUser = usernames.some((raw) => {
        const u = String(raw).toLowerCase().replace(/^@/, "");
        if (!u) return false;
        return m.usernameContains ? a.includes(u) : a === u;
      });
      if (!matchUser) return { ok: false };
    }

    let matchedKeywords = [];
    if (keywords.length) {
      const haystack = m.caseSensitive ? message : message.toLowerCase();
      matchedKeywords = keywords.filter((raw) => {
        const k = m.caseSensitive ? String(raw) : String(raw).toLowerCase();
        return k && haystack.includes(k);
      });
      if (!matchedKeywords.length) return { ok: false };
    }

    return { ok: true, matchedKeywords };
  }
})();
