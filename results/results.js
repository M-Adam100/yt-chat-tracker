const $ = (id) => document.getElementById(id);
const els = {
  log: $("log"),
  logWrap: $("logWrap"),
  empty: $("empty"),
  searching: $("searching"),
  statMatches: $("statMatches"),
  statPeople: $("statPeople"),
  statRate: $("statRate"),
  statElapsed: $("statElapsed"),
  filter: $("filter"),
  clearFilter: $("clearFilter"),
  autoScroll: $("autoScroll"),
  exportBtn: $("exportBtn"),
  exportMenu: $("exportMenu"),
  clearBtn: $("clearBtn"),
  liveDot: $("liveDot"),
  statusText: $("statusText"),
  topFilters: $("topFilters"),
  streamLink: $("streamLink"),
  jumpBtn: $("jumpBtn"),
  toast: $("toast"),
};

let matches = [];
let monitor = null;
let status = null;
let renderedCount = 0;
let filterText = "";
let statsTimer = null;
let toastTimer = null;

/* ---------- utilities ---------- */

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function authorColor(name) {
  let h = 0;
  const s = name || "?";
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 65% 55%)`;
}

function initials(name) {
  const parts = (name || "?").replace(/^@/, "").trim().split(/\s+/);
  const a = parts[0]?.[0] || "?";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

function fmtTime(m) {
  if (m.chatTime) return m.chatTime;
  return new Date(m.recvTime).toLocaleTimeString();
}

const fullTimestamp = (m) => new Date(m.recvTime).toLocaleString();

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mn = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(mn)}:${pad(sec)}` : `${pad(mn)}:${pad(sec)}`;
}

function passesFilter(m) {
  if (!filterText) return true;
  const f = filterText.toLowerCase();
  return (
    (m.author || "").toLowerCase().includes(f) ||
    (m.message || "").toLowerCase().includes(f)
  );
}

function highlight(message, keywords) {
  const safe = escapeHtml(message);
  if (!keywords || !keywords.length) return safe;
  const flags = monitor && monitor.caseSensitive ? "g" : "gi";
  const pattern = keywords
    .filter(Boolean)
    .map((k) => escapeReg(escapeHtml(k)))
    .sort((a, b) => b.length - a.length)
    .join("|");
  if (!pattern) return safe;
  try {
    return safe.replace(new RegExp(pattern, flags), (m) => `<mark>${m}</mark>`);
  } catch (_) {
    return safe;
  }
}

/* ---------- rendering ---------- */

function makeRow(m, isNew) {
  const row = document.createElement("div");
  row.className = "row" + (isNew ? " is-new" : "");

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  if (m.authorPhoto) {
    const img = document.createElement("img");
    img.src = m.authorPhoto;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => {
      avatar.textContent = initials(m.author);
      avatar.style.background = authorColor(m.author);
    };
    avatar.appendChild(img);
  } else {
    avatar.textContent = initials(m.author);
    avatar.style.background = authorColor(m.author);
  }

  const main = document.createElement("div");
  main.className = "row__main";

  const head = document.createElement("div");
  head.className = "row__head";
  const author = document.createElement("span");
  author.className = "row__author";
  author.textContent = m.author || "(unknown)";
  author.style.color = authorColor(m.author);
  head.appendChild(author);
  if (m.type && m.type !== "text") {
    const badge = document.createElement("span");
    badge.className = "badge badge--" + m.type;
    badge.textContent = m.type === "superchat" ? "Super Chat" : m.type;
    head.appendChild(badge);
  }

  const msg = document.createElement("div");
  msg.className = "row__msg";
  msg.innerHTML = highlight(m.message || "", m.matchedKeywords);

  main.append(head, msg);

  const meta = document.createElement("div");
  meta.className = "row__meta";
  const time = document.createElement("span");
  time.className = "row__time";
  time.textContent = fmtTime(m);
  time.title = fullTimestamp(m);
  const copy = document.createElement("button");
  copy.className = "row__copy";
  copy.title = "Copy message";
  copy.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(`[${fmtTime(m)}] ${m.author}: ${m.message}`);
    toast("Copied to clipboard");
  });
  meta.append(time, copy);

  row.append(avatar, main, meta);
  return row;
}

function isNearBottom() {
  const el = els.logWrap;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollToBottom() {
  els.logWrap.scrollTop = els.logWrap.scrollHeight;
  els.jumpBtn.hidden = true;
}

function renderAll() {
  els.log.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const m of matches) if (passesFilter(m)) frag.appendChild(makeRow(m, false));
  els.log.appendChild(frag);
  renderedCount = matches.length;
  updateStates();
  if (els.autoScroll.checked) scrollToBottom();
}

function renderAppend() {
  const stick = els.autoScroll.checked && isNearBottom();
  const frag = document.createDocumentFragment();
  let appended = 0;
  for (let i = renderedCount; i < matches.length; i++) {
    if (passesFilter(matches[i])) {
      frag.appendChild(makeRow(matches[i], true));
      appended++;
    }
  }
  els.log.appendChild(frag);
  renderedCount = matches.length;
  updateStates();
  if (appended) {
    if (stick) scrollToBottom();
    else els.jumpBtn.hidden = false;
  }
}

function updateStates() {
  const hasRows = els.log.children.length > 0;
  const active = !!(monitor && monitor.active);
  const connecting =
    active && status && (status.state === "searching") && matches.length === 0;

  els.empty.hidden = hasRows || connecting;
  els.searching.hidden = !connecting || hasRows;
}

/* ---------- stats ---------- */

function computeStats() {
  const total = matches.length;
  const people = new Set(matches.map((m) => (m.author || "").toLowerCase())).size;

  let elapsedMs = 0;
  const start = monitor && monitor.startedAt ? monitor.startedAt : null;
  if (start) {
    const end =
      monitor.active ? Date.now() : status && status.ts ? status.ts : Date.now();
    elapsedMs = Math.max(0, end - start);
  } else if (matches.length) {
    elapsedMs = matches[matches.length - 1].recvTime - matches[0].recvTime;
  }

  const minutes = elapsedMs / 60000;
  const rate = minutes > 0.05 ? total / minutes : total;

  els.statMatches.textContent = total;
  els.statPeople.textContent = people;
  els.statRate.textContent = rate >= 10 ? Math.round(rate) : rate.toFixed(1);
  els.statElapsed.textContent = fmtElapsed(elapsedMs);
}

function startStatsLoop() {
  clearInterval(statsTimer);
  computeStats();
  statsTimer = setInterval(computeStats, 1000);
}

/* ---------- meta / status ---------- */

const STATUS_TEXT = {
  idle: "Idle",
  searching: "Connecting to chat…",
  connected: "Monitoring live",
  notfound: "Live chat not found",
  stopped: "Stopped",
};

function renderMeta() {
  const active = !!(monitor && monitor.active);
  const state = active
    ? (status && status.state) || "searching"
    : (status && status.state) === "stopped"
    ? "stopped"
    : "idle";
  els.liveDot.classList.toggle("is-live", state === "connected");
  els.liveDot.classList.toggle("is-warn", state === "searching" || state === "notfound");
  els.statusText.textContent = STATUS_TEXT[state] || "Idle";

  els.topFilters.innerHTML = "";
  const users = (monitor && monitor.usernames) || [];
  const kws = (monitor && monitor.keywords) || [];
  for (const u of users.slice(0, 6)) addFilterChip(`@${String(u).replace(/^@/, "")}`, "user");
  for (const k of kws.slice(0, 6)) addFilterChip(k, "kw");

  if (monitor && monitor.streamUrl) {
    els.streamLink.hidden = false;
    els.streamLink.href = monitor.streamUrl;
  } else {
    els.streamLink.hidden = true;
  }
  document.title = active ? `● Monitoring — ${matches.length} matches` : "Chat Monitor — Results";
}

function addFilterChip(text, kind) {
  const chip = document.createElement("span");
  chip.className = "fchip fchip--" + kind;
  chip.innerHTML = `<b>${escapeHtml(text)}</b>`;
  els.topFilters.appendChild(chip);
}

/* ---------- export ---------- */

function filtered() {
  return matches.filter(passesFilter);
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function asTxt(data) {
  return data.map((m) => `[${fmtTime(m)}] ${m.author}: ${m.message}`).join("\n");
}

function csvEscape(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function asCsv(data) {
  const rows = [["Time", "ReceivedAt", "Person", "Message", "MatchedKeywords", "Type"]];
  for (const m of data) {
    rows.push([
      fmtTime(m), fullTimestamp(m), m.author || "", m.message || "",
      (m.matchedKeywords || []).join(" | "), m.type || "text",
    ]);
  }
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

function asJson(data) {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), monitor, count: data.length, matches: data },
    null,
    2
  );
}

async function doExport(kind) {
  const data = filtered();
  if (!data.length) return toast("Nothing to export");
  if (kind === "txt") download(`chat-matches-${stamp()}.txt`, asTxt(data), "text/plain");
  else if (kind === "csv") download(`chat-matches-${stamp()}.csv`, asCsv(data), "text/csv");
  else if (kind === "json") download(`chat-matches-${stamp()}.json`, asJson(data), "application/json");
  else if (kind === "copy") {
    await navigator.clipboard.writeText(asTxt(data));
    return toast(`Copied ${data.length} matches`);
  }
  toast(`Exported ${data.length} matches`);
}

/* ---------- events ---------- */

let filterDebounce = null;
els.filter.addEventListener("input", () => {
  els.clearFilter.hidden = !els.filter.value;
  clearTimeout(filterDebounce);
  filterDebounce = setTimeout(() => {
    filterText = els.filter.value.trim();
    renderAll();
  }, 140);
});
els.clearFilter.addEventListener("click", () => {
  els.filter.value = "";
  els.clearFilter.hidden = true;
  filterText = "";
  renderAll();
  els.filter.focus();
});

els.exportBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  els.exportMenu.hidden = !els.exportMenu.hidden;
});
document.addEventListener("click", () => (els.exportMenu.hidden = true));
els.exportMenu.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-export]");
  if (!btn) return;
  els.exportMenu.hidden = true;
  doExport(btn.dataset.export);
});

els.clearBtn.addEventListener("click", async () => {
  if (!matches.length) return;
  if (!confirm("Clear all captured matches? This cannot be undone.")) return;
  await chrome.runtime.sendMessage({ type: "clearMatches" });
  matches = [];
  renderAll();
  computeStats();
  toast("Results cleared");
});

els.jumpBtn.addEventListener("click", scrollToBottom);
els.logWrap.addEventListener("scroll", () => {
  if (isNearBottom()) els.jumpBtn.hidden = true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.matches) {
    matches = changes.matches.newValue || [];
    if (matches.length >= renderedCount) renderAppend();
    else renderAll();
    computeStats();
    renderMeta();
  }
  if (changes.monitor) {
    monitor = changes.monitor.newValue;
    renderMeta();
    updateStates();
    startStatsLoop();
  }
  if (changes.status) {
    status = changes.status.newValue;
    renderMeta();
    updateStates();
  }
});

async function init() {
  const state = await chrome.runtime.sendMessage({ type: "getState" });
  matches = (state && state.matches) || [];
  monitor = state && state.monitor;
  status = state && state.status;
  renderMeta();
  renderAll();
  startStatsLoop();
}

init();
