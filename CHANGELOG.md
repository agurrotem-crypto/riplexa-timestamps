# Changelog

## 0.2.0

- New setting `riplexaVsTimestamp.userMessageColor`: color your own messages (any plain CSS color; anything else is refused).
- Changing an option re-patches from the untouched original, never on top of an earlier patch.

## 0.1.0

- First release: real timestamps inline in the Claude Code chat panel for user messages, assistant rows and thinking, and `start→result` on tool calls.
- Reopened history shows recorded times, not the time it was opened.
- Automatic re-patch after Claude Code updates; restore on disable and on uninstall.
