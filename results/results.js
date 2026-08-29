const els = {
  rows: document.getElementById("rows"),
  empty: document.getElementById("empty"),
  count: document.getElementById("count"),
  filter: document.getElementById("filter"),
  autoScroll: document.getElementById("autoScroll"),
  exportTxt: document.getElementById("exportTxt"),
  exportCsv: document.getElementById("exportCsv"),
  clearBtn: document.getElementById("clearBtn"),
  liveDot: document.getElementById("liveDot"),
  statusText: document.getElementById("statusText"),
  meta: document.getElementById("meta"),
  tableWrap: document.getElementById("tableWrap"),
};

let matches = [];
let renderedCount = 0;
let filterText = "";

function fmtTime(m) {
  if (m.chatTime) return m.chatTime;
  const d = new Date(m.recvTime);
  return d.toLocaleTimeString();
}

function fullTimestamp(m) {
  const d = new Date(m.recvTime);
  return d.toLocaleString();
}

function passesFilter(m) {
  if (!filterText) return true;
  const f = filterText.toLowerCase();
  return (
    (m.author || "").toLowerCase().includes(f) ||
    (m.message || "").toLowerCase().includes(f)
  );
}

function makeRow(m, isNew) {
  const tr = document.createElement("tr");
  if (isNew) tr.className = "row-new";

  const time = document.createElement("td");
  time.className = "cell-time";
  time.textContent = fmtTime(m);
  time.title = fullTimestamp(m);

  const author = document.createElement("td");
  author.className = "cell-author";
  author.textContent = m.author || "(unknown)";

  const msg = document.createElement("td");
  msg.className = "cell-msg";
  msg.textContent = m.message || "";

  tr.append(time, author, msg);
  return tr;
}

function updateEmpty() {
  const visible = els.rows.children.length > 0;
  els.empty.classList.toggle("hidden", visible);
}

// Full re-render (used on load, filter change, clear).
function renderAll() {
  els.rows.innerHTML = "";
  const visible = matches.filter(passesFilter);
  const frag = document.createDocumentFragment();
  for (const m of visible) frag.appendChild(makeRow(m, false));
  els.rows.appendChild(frag);
  renderedCount = matches.length;
  els.count.textContent = matches.length;
  updateEmpty();
  if (els.autoScroll.checked) scrollToBottom();
}

// Append only newly-arrived matches (used on live updates).
function renderAppend() {
  const frag = document.createDocumentFragment();
  for (let i = renderedCount; i < matches.length; i++) {
    if (passesFilter(matches[i])) frag.appendChild(makeRow(matches[i], true));
  }
  els.rows.appendChild(frag);
  renderedCount = matches.length;
  els.count.textContent = matches.length;
  updateEmpty();
  if (els.autoScroll.checked) scrollToBottom();
}

function scrollToBottom() {
  els.tableWrap.scrollTop = els.tableWrap.scrollHeight;
}

function renderMeta(monitor) {
  const active = !!(monitor && monitor.active);
  els.liveDot.classList.toggle("is-live", active);
  els.statusText.textContent = active ? "Monitoring live" : "Stopped";

  if (!monitor) {
    els.meta.textContent = "";
    return;
  }
  const parts = [];
  if (monitor.username) parts.push(`user: <b>${escapeHtml(monitor.username)}</b>`);
  if (monitor.keyword) parts.push(`keyword: <b>${escapeHtml(monitor.keyword)}</b>`);
  els.meta.innerHTML = parts.join(" &nbsp;•&nbsp; ");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function exportTxt() {
  const data = matches.filter(passesFilter);
  const lines = data.map((m) => `[${fmtTime(m)}] ${m.author}: ${m.message}`);
  download(`chat-matches-${stamp()}.txt`, lines.join("\n"), "text/plain");
}

function csvEscape(v) {
  const s = String(v == null ? "" : v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportCsv() {
  const data = matches.filter(passesFilter);
  const rows = [["Time", "ReceivedAt", "Person", "Message"]];
  for (const m of data) {
    rows.push([fmtTime(m), fullTimestamp(m), m.author || "", m.message || ""]);
  }
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  download(`chat-matches-${stamp()}.csv`, csv, "text/csv");
}

els.exportTxt.addEventListener("click", exportTxt);
els.exportCsv.addEventListener("click", exportCsv);

els.clearBtn.addEventListener("click", async () => {
  if (!matches.length) return;
  if (!confirm("Clear all captured matches?")) return;
  await chrome.runtime.sendMessage({ type: "clearMatches" });
  matches = [];
  renderAll();
});

els.filter.addEventListener("input", () => {
  filterText = els.filter.value.trim();
  renderAll();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.matches) {
    matches = changes.matches.newValue || [];
    if (matches.length >= renderedCount) renderAppend();
    else renderAll(); // shrank (e.g. cleared)
  }
  if (changes.monitor) {
    renderMeta(changes.monitor.newValue);
  }
});

async function init() {
  const state = await chrome.runtime.sendMessage({ type: "getState" });
  matches = (state && state.matches) || [];
  renderMeta(state && state.monitor);
  renderAll();
}

init();
