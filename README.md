# Riplexa Timestamps for Claude & Codex

**See when everything happened, right inside the conversation.** In the Claude Code and Codex chat panels, every message you send, every reply, every thinking block and every tool call gets its real time, inline at the start of its own text line. There is no side panel and no separate log.

```
20:58:57  Is the build green?                       ← your message
20:59:06  Thought for 7s
20:59:07→20:59:07  Read  docs/memory/feedback.md    ← tool call: started → result came back
20:59:22→20:59:26  PowerShell  Read recorded timestamp…
20:59:56  The message arrived. The session log records it at 20:58:57.707…
```

The Claude Code extension for VS Code shows no times at all (see [anthropics/claude-code#37929](https://github.com/anthropics/claude-code/issues/37929), [#55125](https://github.com/anthropics/claude-code/issues/55125), [#68538](https://github.com/anthropics/claude-code/issues/68538)). Other timestamp extensions open a separate side panel. This one puts the time **inside the chat**, where you are already reading.

## What you get

- **Your messages**: the time you sent them, at the start of the text line.
- **Claude's replies and thinking**: the time of each row.
- **Tool calls**: `start→result`, so you can see how long a command took. A call still running shows only its start.
- **History**: reopened conversations show their real times, not the time you opened them.
- **Other days**: prefixed with the date, e.g. `10/09 12:01:02`.
- Works with right-to-left text (Hebrew, Arabic, Persian) and alongside [Claude Code RTL Support](https://marketplace.visualstudio.com/items?itemName=yechielby.claude-code-rtl).

**No guessed times, ever.** The times come from the timestamps Claude Code already records in its transcript. If a row's real time is not available (for example a reply that is still streaming), that row shows nothing until it is.

## Supported panels

| Panel | Extension | How |
| --- | --- | --- |
| Claude Code | `anthropic.claude-code` | A marked edit of the panel's `webview/index.js` (see below) |
| Codex | `openai.chatgpt` | One marked `<script>` line in the panel's `webview/index.html`; Codex's own code is not edited. Codex already keeps the times (it shows some of them only on hover); the script puts them on the text line |

Turn on `riplexaTimestamps.diagnostics` to see, inside the Codex panel, what was found and where each time was placed.

## How it works

Claude Code's chat panel is a web page bundled inside the Claude Code extension (`webview/index.js`). It already receives a real timestamp with every message but does not display it. This extension makes a small, marked change to that file, the same approach as Claude Code RTL Support:

1. Keeps each message's recorded timestamp instead of discarding it.
2. Records when each tool result arrived.
3. Adds a small script that shows those times through CSS.

**Settings change live, with no reload.** On/Off and colors live in a small stylesheet next to the panel, which the extension rewrites and the panel picks up within about two seconds. Only the first install and upgrades need one reload.

Safety:

- The untouched original is saved next to the file (`index.js.riplexa-vs-timestamp.bak`) before anything changes.
- Every edit must match exactly once, or nothing is written. An unsupported Claude Code build is left untouched and you get a warning.
- The patched file is checked to parse before it replaces the original, and it is written atomically.
- **Remove** (command) or **uninstall** restores the original files.
- Nothing is sent anywhere. No network, no telemetry.

## Usage

Install, then reload the window (or close and reopen the Claude Code panel) once when prompted.

**Status bar toggle:** `Timestamp: On` / `Timestamp: Off` at the bottom of the window. Click it to switch. The change is live.

| Command | What it does |
| --- | --- |
| `Riplexa Timestamps: Toggle On/Off` | Same as clicking the status bar item (live) |
| `Riplexa Timestamps: Turn On` / `Turn Off` | Explicit on / off (live) |
| `Riplexa Timestamps: Remove from chat panels` | Restore the original Claude Code and Codex files (reload to finish) |
| `Riplexa Timestamps: Show Status` | Show whether each supported panel is patched |

Settings (all live):

| Setting | Default | What it does |
| --- | --- | --- |
| `riplexaTimestamps.enabled` | `true` | Timestamps on or off |
| `riplexaTimestamps.showStatusBar` | `true` | Show the On/Off toggle in the status bar |
| `riplexaTimestamps.diagnostics` | `false` | Show a diagnostics box in the Codex panel |
| `riplexaTimestamps.userMessageColor` | empty | Text color of your own messages, as a CSS color, e.g. `#90EE90` or `lightgreen`, so your side of the conversation stands out |

**After Claude Code updates**, the new version is patched automatically, and you are asked to reload once.

## Limitations

- The patch targets the structure of Claude Code's panel code. If a future Claude Code build changes it, this extension refuses to patch and tells you, rather than guessing. Please open an issue.
- The first install and each upgrade of the patch appear after the panel reloads once.
- Codex: a reply gets a time only when Codex itself recorded one. Replies loaded from an older session usually have none, so they show no time.
- This is an unofficial, community extension. It is not made by, endorsed by or affiliated with Anthropic or OpenAI. "Claude" and "Claude Code" are trademarks of Anthropic; "Codex" and "ChatGPT" are trademarks of OpenAI.

## License

MIT
