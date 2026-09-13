# Riplexa VS Timestamp

**See when everything happened in the Claude Code chat panel.** Every message you send, every reply, every thinking block and every tool call gets its real time, inline on the text line.

```
20:58:57  בדיקה 4                                   ← your message
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

## How it works

Claude Code's chat panel is a web page bundled inside the Claude Code extension (`webview/index.js`). It already receives a real timestamp with every message but does not display it. This extension makes a small, marked change to that file, the same approach as Claude Code RTL Support:

1. Keeps each message's recorded timestamp instead of discarding it.
2. Records when each tool result arrived.
3. Adds a small script that shows those times through CSS.

Safety:

- The untouched original is saved next to the file (`index.js.riplexa-vs-timestamp.bak`) before anything changes.
- Every edit must match exactly once, or nothing is written. An unsupported Claude Code build is left untouched and you get a warning.
- The patched file is checked to parse before it replaces the original, and it is written atomically.
- **Disable** (command or setting) or **uninstall** restores the original file.
- Nothing is sent anywhere. No network, no telemetry.

## Usage

Install, then reload the window (or close and reopen the Claude Code panel) when prompted.

| Command | What it does |
| --- | --- |
| `Riplexa VS Timestamp: Enable` | Apply the patch (it is on by default) |
| `Riplexa VS Timestamp: Disable` | Restore Claude Code's original panel |
| `Riplexa VS Timestamp: Show Status` | Show whether each Claude Code install is patched |

Settings:

| Setting | Default | What it does |
| --- | --- | --- |
| `riplexaVsTimestamp.enabled` | `true` | Timestamps on or off (off restores the original panel) |
| `riplexaVsTimestamp.userMessageColor` | empty | Text color of your own messages, as a CSS color, e.g. `#90EE90` or `lightgreen`, so your side of the conversation stands out |

**After Claude Code updates**, the new version is patched automatically, and you are asked to reload once.

## Limitations

- The patch targets the structure of Claude Code's panel code. If a future Claude Code build changes it, this extension refuses to patch and tells you, rather than guessing. Please open an issue.
- Changes appear after the panel reloads.
- This is an unofficial, community extension. It is not made by, endorsed by or affiliated with Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.

## License

MIT
