const $ = (id) => document.getElementById(id);
const els = {
  form: $("monitorForm"),
  streamUrl: $("streamUrl"),
  usernames: $("usernames"),
  keywords: $("keywords"),
  userChips: $("userChips"),
  kwChips: $("kwChips"),
  usernameContains: $("usernameContains"),
  caseSensitive: $("caseSensitive"),
  clearPrevious: $("clearPrevious"),
  hint: $("hint"),
  startBtn: $("startBtn"),
  startLabel: document.querySelector("#startBtn .btn__label"),
  statusPill: $("statusPill"),
  statusLabel: $("statusLabel"),
  livePanel: $("livePanel"),
  liveMatches: $("liveMatches"),
  liveElapsed: $("liveElapsed"),
  liveConn: $("liveConn"),
  liveOpenResults: $("liveOpenResults"),
  liveStop: $("liveStop"),
  toast: $("toast"),
};

let startedAt = null;
let elapsedTimer = null;
let toastTimer = null;

const send = (message) => chrome.runtime.sendMessage(message);
const parseList = (raw) =>
  String(raw || "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

const STATUS = {
  idle: { label: "Idle", cls: "pill--idle", conn: "–" },
  searching: { label: "Searching", cls: "pill--warn", conn: "Searching…" },
  connected: { label: "Live", cls: "pill--live", conn: "Connected" },
  notfound: { label: "No chat", cls: "pill--warn", conn: "Not found" },
  stopped: { label: "Stopped", cls: "pill--idle", conn: "Stopped" },
};

function renderStatus(active, statusState) {
  const key = active ? statusState || "searching" : "idle";
  const s = STATUS[key] || STATUS.idle;
  els.statusPill.className = "pill " + s.cls;
  els.statusLabel.textContent = s.label;
  els.liveConn.textContent = s.conn;
}

function renderChips(container, items, kind) {
  container.innerHTML = "";
  for (const item of items.slice(0, 12)) {
    const chip = document.createElement("span");
    chip.className = "chip" + (kind === "kw" ? " chip--kw" : "");
    chip.textContent = kind === "kw" ? item : "@" + item.replace(/^@/, "");
    container.appendChild(chip);
  }
}

function countUp(el, to) {
  const from = parseInt(el.textContent.replace(/\D/g, ""), 10) || 0;
  if (from === to) {
    el.textContent = to;
    return;
  }
  const steps = Math.min(12, Math.abs(to - from));
  const inc = (to - from) / steps;
  let cur = from;
  let i = 0;
  const t = setInterval(() => {
    i++;
    cur += inc;
    el.textContent = Math.round(cur);
    if (i >= steps) {
      el.textContent = to;
      clearInterval(t);
    }
  }, 24);
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function tickElapsed() {
  if (!startedAt) return;
  els.liveElapsed.textContent = fmtElapsed(Date.now() - startedAt);
}

function startElapsed(from) {
  startedAt = from || Date.now();
  tickElapsed();
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(tickElapsed, 1000);
}

function stopElapsed() {
  clearInterval(elapsedTimer);
  elapsedTimer = null;
}

function setActiveUI(active) {
  els.livePanel.hidden = !active;
  els.startLabel.textContent = active ? "Restart session" : "Start monitoring";
}

function fillForm(monitor) {
  if (!monitor) return;
  els.streamUrl.value = monitor.streamUrl || "";
  els.usernames.value = monitor.usernamesRaw || "";
  els.keywords.value = monitor.keywordsRaw || "";
  els.usernameContains.checked = !!monitor.usernameContains;
  els.caseSensitive.checked = !!monitor.caseSensitive;
  renderChips(els.userChips, parseList(monitor.usernamesRaw), "user");
  renderChips(els.kwChips, parseList(monitor.keywordsRaw), "kw");
  setActiveUI(!!monitor.active);
  if (monitor.active && monitor.startedAt) startElapsed(monitor.startedAt);
  else stopElapsed();
}

function readForm() {
  return {
    streamUrl: els.streamUrl.value.trim(),
    usernames: els.usernames.value.trim(),
    keywords: els.keywords.value.trim(),
    usernameContains: els.usernameContains.checked,
    caseSensitive: els.caseSensitive.checked,
  };
}

function validate(cfg) {
  if (!cfg.streamUrl) return "Please paste the live stream URL.";
  if (!/youtube\.com|youtu\.be/i.test(cfg.streamUrl))
    return "That doesn't look like a YouTube URL.";
  if (!cfg.usernames && !cfg.keywords)
    return "Add at least one username or keyword to match.";
  return "";
}

function showHint(msg) {
  els.hint.textContent = msg;
  els.hint.classList.toggle("show", !!msg);
}

async function refreshState() {
  const state = await send({ type: "getState" });
  if (!state) return;
  fillForm(state.monitor);
  const count = state.matches ? state.matches.length : 0;
  els.liveMatches.textContent = count;
  renderStatus(!!state.monitor?.active, state.status?.state);
}

// Live chip preview as the user types.
els.usernames.addEventListener("input", () =>
  renderChips(els.userChips, parseList(els.usernames.value), "user")
);
els.keywords.addEventListener("input", () =>
  renderChips(els.kwChips, parseList(els.keywords.value), "kw")
);

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const cfg = readForm();
  const err = validate(cfg);
  showHint(err);
  if (err) return;

  els.startBtn.classList.add("is-loading");
  const res = await send({
    type: "startMonitor",
    config: cfg,
    clearPrevious: els.clearPrevious.checked,
    openTab: true,
    openResults: true,
  });
  els.startBtn.classList.remove("is-loading");

  if (res && res.stream && res.stream.ok === false) {
    showHint("Could not open the stream URL.");
    return;
  }
  fillForm(res.monitor);
  toast("Monitoring started");
  setTimeout(() => window.close(), 500);
});

els.liveStop.addEventListener("click", async () => {
  const res = await send({ type: "stopMonitor" });
  fillForm(res.monitor);
  renderStatus(false);
  toast("Monitoring stopped");
});

els.liveOpenResults.addEventListener("click", async () => {
  await send({ type: "openResults" });
  window.close();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.matches) {
    countUp(els.liveMatches, (changes.matches.newValue || []).length);
  }
  if (changes.monitor) {
    const mon = changes.monitor.newValue;
    setActiveUI(!!mon?.active);
    if (mon?.active && mon.startedAt) startElapsed(mon.startedAt);
    else stopElapsed();
  }
  if (changes.status || changes.monitor) {
    send({ type: "getState" }).then((s) => {
      if (s) renderStatus(!!s.monitor?.active, s.status?.state);
    });
  }
});

refreshState();
