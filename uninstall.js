'use strict';
// Runs when this extension is uninstalled (package.json "vscode:uninstall"; VS Code runs it with plain Node, after
// the editor restarts). Restores every chat panel this extension patched, in every known extensions folder.
const os = require('os');
const path = require('path');
const adapters = [require('./src/patcher'), require('./src/codex')];

const home = os.homedir();
const roots = [
  path.dirname(__dirname),                      // the folder this extension itself was installed in
  process.env.VSCODE_EXTENSIONS,
  path.join(home, '.vscode', 'extensions'),
  path.join(home, '.vscode-insiders', 'extensions'),
  path.join(home, '.cursor', 'extensions'),
  path.join(home, '.windsurf', 'extensions'),
  path.join(home, '.vscode-oss', 'extensions'),
  path.join(home, '.vscode-server', 'extensions'),
].filter(Boolean);

for (const root of Array.from(new Set(roots))) {
  for (const adapter of adapters) {
    for (const dir of adapter.findInstalls(root)) {
      try { adapter.restore(dir); } catch (_) { /* leave it; the host extension's next update replaces the files anyway */ }
    }
  }
}
