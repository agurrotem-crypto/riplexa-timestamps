'use strict';
// Runs when this extension is uninstalled (package.json "vscode:uninstall"; VS Code runs it with plain Node, after
// the editor restarts). Restores every Claude Code webview this extension patched, in every known extensions folder.
const os = require('os');
const path = require('path');
const patcher = require('./src/patcher');

const home = os.homedir();
const roots = [
  process.env.VSCODE_EXTENSIONS,
  path.join(home, '.vscode', 'extensions'),
  path.join(home, '.vscode-insiders', 'extensions'),
  path.join(home, '.cursor', 'extensions'),
  path.join(home, '.windsurf', 'extensions'),
  path.join(home, '.vscode-oss', 'extensions'),
  path.join(home, '.vscode-server', 'extensions'),
].filter(Boolean);
// The folder this extension itself was installed in is the most reliable one.
roots.unshift(path.dirname(__dirname));

for (const root of Array.from(new Set(roots))) {
  for (const dir of patcher.findInstalls(root)) {
    try { patcher.restore(dir); } catch (_) { /* leave it; Claude Code's next update replaces the file anyway */ }
  }
}
