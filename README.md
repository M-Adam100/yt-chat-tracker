# YT Live Chat Monitor

A Chrome (Manifest V3) extension that watches a YouTube **live stream chat** for a
specific user and/or keyword, shows matching messages (time / person / message) in a
live-updating results tab, and lets you export them to a `.txt` or `.csv` file.

## Features

- **Three inputs:** live stream URL, username to monitor, and keyword.
- Matches on **username**, **keyword**, or **both** (AND when both are given).
- Scans messages already loaded in chat, then keeps watching and appends new matches
  in real time.
- **Results tab** with time / person / message columns, live count, quick filter, and
  auto-scroll.
- **Export** matches to `.txt` (`[time] person: message`) or `.csv`.
- Works while logged in as any account — you monitor a *different* user by name.

## Install (Load unpacked)

1. Open `chrome://extensions` in Chrome (or a Chromium browser).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this project folder (`yt-chat-tracker`).
4. Pin the extension from the puzzle-piece menu for quick access.

> The icons are pre-generated. To regenerate them, run
> `python3 icons/generate_icons.py`.

## Usage

1. Click the extension icon to open the popup.
2. Fill in:
   - **Live stream URL** — e.g. `https://www.youtube.com/watch?v=VIDEO_ID`
   - **Username to monitor** — the display name of the person you want to track.
   - **Keyword** — a word/phrase to look for (optional if a username is set).
3. Optional toggles:
   - **Match username partially** — match if the author name *contains* your text
     (otherwise it must match exactly, case-insensitive).
   - **Case-sensitive keyword** — exact case for the keyword.
4. Click **Start monitoring**. The stream opens (or is focused) and a **Results** tab
   opens automatically.
5. Matches appear live in the Results tab. Use **Export .txt / .csv** to save, or
   **Clear** to reset.
6. Click **Stop** in the popup to stop capturing.

### Important tip

In the live chat panel, switch the chat mode from **Top chat** to **Live chat**.
"Top chat" hides many messages, so some matches would never be seen.

## How it works

- `manifest.json` — MV3 config; injects the content script into
  `www.youtube.com/live_chat*` frames.
- `content.js` — runs inside the live chat iframe, uses a `MutationObserver` to detect
  new messages, extracts time / author / message, applies the filters, and sends
  matches to the background worker.
- `background.js` — the single source of truth. Serializes writes, de-duplicates, and
  stores state + matches in `chrome.storage.local`.
- `popup/` — the control panel (inputs, start/stop, open results).
- `results/` — the live results table with filtering and export.

## Notes & limitations

- YouTube only keeps a limited window of recent chat messages in the DOM, so "current
  chat memory" means what's currently loaded — the extension can't retrieve messages
  from before it started (or that YouTube has already pruned).
- The stream tab must stay open for monitoring to continue. Background tabs work, but
  keep the tab open.
- YouTube's chat DOM can change over time; if messages stop being captured, the
  selectors in `content.js` may need updating.
