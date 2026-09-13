# Changelog

## 0.7.2

- First Marketplace build: publisher `Riplexa`; repository, issues and homepage links.

## 0.7.1

- English-only listing and examples; README covers both panels and both trademarks.

## 0.7.0

- Renamed **Riplexa Timestamps for Claude & Codex** (extension id `Riplexa.riplexa-timestamps`; settings and commands now `riplexaTimestamps.*`).
- Codex: times are placed only on the row that owns them. The final-answer time is no longer inferred from the action row (it once landed on an "Edited …" row), and a whole activity block is no longer stamped over its first line.

## 0.6.0

- Codex: intermediate assistant messages get their time when Codex recorded one (`sentAtMs`); the diagnostics box counts the ones Codex did not.
- Codex: collapsed groups ("Ran commands") show the first start and the last end of the commands inside; a group with a command still running shows its start only.
- Codex: a small stable loader now (re)loads the main script when its version changes, so future updates of this extension reach an open Codex panel without a reload.

## 0.5.0

- **Codex support** (`openai.chatgpt`): user messages, assistant messages, commands (`start→end`) and "Worked for" get their real time, from the times Codex already keeps. Codex's own code is not edited — one marked script line in its `index.html`, restored on Remove/uninstall.
- One status-bar toggle and one set of live settings for all supported panels.
- New setting `riplexaVsTimestamp.diagnostics`: a live diagnostics box in the Codex panel.

## 0.4.0

- On/Off and the message color now change **live**, with no reload: they live in a stylesheet next to the panel, which the panel re-reads when a one-pixel revision image changes.
- Turning timestamps off no longer rewrites Claude Code's files; the new **Remove from Claude Code** command (and uninstall) restores the originals.

## 0.3.0

- Status bar toggle `Timestamp: On/Off` (click to switch) and the command `Riplexa VS Timestamp: Toggle On/Off`.
- Setting `riplexaVsTimestamp.showStatusBar` to hide the toggle.

## 0.2.0

- New setting `riplexaVsTimestamp.userMessageColor`: color your own messages (any plain CSS color; anything else is refused).
- Changing an option re-patches from the untouched original, never on top of an earlier patch.

## 0.1.0

- First release: real timestamps inline in the Claude Code chat panel for user messages, assistant rows and thinking, and `start→result` on tool calls.
- Reopened history shows recorded times, not the time it was opened.
- Automatic re-patch after Claude Code updates; restore on disable and on uninstall.
