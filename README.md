# YT Live Chat Monitor

A polished Chrome (Manifest V3) extension that watches a YouTube **live stream chat**
for specific user(s) and/or keyword(s), streams matching messages into a live
dashboard (time / person / message), and exports them to `.txt`, `.csv`, or `.json`.

## Features

- **Three inputs:** live stream URL, username(s), and keyword(s).
- **Multiple users & multiple keywords** — comma-separated. Matches any listed user
  **and** any listed keyword (each filter is optional).
- **Exact or partial** username matching, and optional **case-sensitive** keywords.
- Scans messages already loaded in chat, then keeps watching and appends new matches
  in **real time**.
- **Live results dashboard:**
  - Stat cards: total matches, unique people, matches/minute, session duration.
  - Author avatars, per-author colors, and badges for Super Chats / memberships.
  - **Keyword highlighting** inside each message.
  - Quick filter, auto-scroll with a "new matches" jump button, per-row copy.
  - Live connection status (searching / connected / not found).
- **Export** to `.txt`, `.csv`, `.json`, or copy everything to the clipboard.
- **Sessions:** starting a new monitor begins a fresh session (optionally clearing
  previous results). Results persist across restarts until cleared.
- Modern animated UI (dark theme), respects `prefers-reduced-motion`.

## Install (Load unpacked)

1. Open `chrome://extensions` in Chrome (or a Chromium browser).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this project folder (`yt-chat-tracker`).
4. Pin the extension from the puzzle-piece menu for quick access.

> Icons are pre-generated. To regenerate them, run `python3 icons/generate_icons.py`.

## Usage

1. Click the extension icon to open the popup.
2. Fill in:
   - **Live stream URL** — e.g. `https://www.youtube.com/watch?v=VIDEO_ID`
   - **Usernames** — one or more display names, comma-separated (optional).
   - **Keywords** — one or more words/phrases, comma-separated (optional).
   - At least one username or keyword is required.
3. Optional toggles:
   - **Partial username match** — match if the author name *contains* your text
     (otherwise it must match exactly, case-insensitive).
   - **Case-sensitive keywords** — exact case for keywords.
   - **Clear previous results on start** — begin the session fresh (on by default).
4. Click **Start monitoring**. The stream opens (or is focused) and the **Results**
   dashboard opens automatically.
5. Matches stream into the dashboard live. Use **Export** to save, **Clear** to reset,
   or **Stop** (in the popup's live panel) to pause capturing.

### Important tip

In the live chat panel, switch the chat mode from **Top chat** to **Live chat**.
"Top chat" hides many messages, so some matches would never be seen.

## Architecture

- `manifest.json` — MV3 config; injects the content script into
  `www.youtube.com/live_chat*` frames.
- `content.js` — runs inside the live chat iframe, uses a `MutationObserver` to detect
  new messages, extracts time / author / avatar / message, applies the filters, and
  reports matches + connection status to the background worker.
- `background.js` — the single source of truth. Serializes writes, de-duplicates,
  manages sessions, and stores state + matches in `chrome.storage.local`.
- `popup/` — the control panel (inputs, live session panel, start/stop).
- `results/` — the live dashboard (stats, message log, filtering, export).

## Notes & limitations

- The scraping runs inside the **stream tab** (in the chat iframe), not a detached
  process — the stream tab must stay open, but it can be in an unfocused/background
  window.
- YouTube only keeps a limited window of recent chat messages in the DOM, so the
  extension can't retrieve messages from before it started or ones YouTube has already
  pruned.
- YouTube's chat DOM can change over time; if messages stop being captured, the
  selectors in `content.js` may need updating.
