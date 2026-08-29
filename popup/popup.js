const els = {
  form: document.getElementById("monitorForm"),
  streamUrl: document.getElementById("streamUrl"),
  username: document.getElementById("username"),
  keyword: document.getElementById("keyword"),
  usernameContains: document.getElementById("usernameContains"),
  caseSensitive: document.getElementById("caseSensitive"),
  hint: document.getElementById("hint"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  openResultsBtn: document.getElementById("openResultsBtn"),
  matchCount: document.getElementById("matchCount"),
  statusBadge: document.getElementById("statusBadge"),
};

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function setActiveUI(active) {
  els.startBtn.hidden = active;
  els.stopBtn.hidden = !active;
  els.startBtn.textContent = active ? "Update monitor" : "Start monitoring";
  els.statusBadge.textContent = active ? "Live" : "Idle";
  els.statusBadge.className = "status " + (active ? "status--live" : "status--idle");
  // Keep the (re)start button available even while active so filters can be tweaked.
  els.startBtn.hidden = false;
}

function fillForm(monitor) {
  if (!monitor) return;
  els.streamUrl.value = monitor.streamUrl || "";
  els.username.value = monitor.username || "";
  els.keyword.value = monitor.keyword || "";
  els.usernameContains.checked = !!monitor.usernameContains;
  els.caseSensitive.checked = !!monitor.caseSensitive;
  setActiveUI(!!monitor.active);
}

function readForm() {
  return {
    streamUrl: els.streamUrl.value.trim(),
    username: els.username.value.trim(),
    keyword: els.keyword.value.trim(),
    usernameContains: els.usernameContains.checked,
    caseSensitive: els.caseSensitive.checked,
  };
}

function validate(cfg) {
  if (!cfg.streamUrl) return "Please paste the live stream URL.";
  if (!/youtube\.com|youtu\.be/i.test(cfg.streamUrl))
    return "That doesn't look like a YouTube URL.";
  if (!cfg.username && !cfg.keyword)
    return "Enter a username, a keyword, or both to match.";
  return "";
}

async function refreshState() {
  const state = await send({ type: "getState" });
  if (!state) return;
  fillForm(state.monitor);
  els.matchCount.textContent = state.matches ? state.matches.length : 0;
}

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const cfg = readForm();
  const err = validate(cfg);
  els.hint.textContent = err;
  if (err) return;

  els.startBtn.disabled = true;
  const res = await send({
    type: "startMonitor",
    config: cfg,
    openTab: true,
    openResults: true,
  });
  els.startBtn.disabled = false;

  if (res && res.stream && res.stream.ok === false) {
    els.hint.textContent = "Could not open the stream URL.";
    return;
  }
  fillForm(res.monitor);
  window.close();
});

els.stopBtn.addEventListener("click", async () => {
  const res = await send({ type: "stopMonitor" });
  fillForm(res.monitor);
});

els.openResultsBtn.addEventListener("click", async () => {
  await send({ type: "openResults" });
  window.close();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.matches) {
    const val = changes.matches.newValue || [];
    els.matchCount.textContent = val.length;
  }
  if (changes.monitor) {
    setActiveUI(!!changes.monitor.newValue?.active);
  }
});

refreshState();
