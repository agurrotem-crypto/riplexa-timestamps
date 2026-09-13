'use strict';
const vscode = require('vscode');
const path = require('path');
const live = require('./src/live');

// One adapter per chat panel. Each knows how to find its host extension's installs, apply, restore and report.
const ADAPTERS = [require('./src/patcher'), require('./src/codex')];

const SETTING = 'riplexaTimestamps.enabled';
const COLOR_SETTING = 'riplexaTimestamps.userMessageColor';
const STATUS_BAR_SETTING = 'riplexaTimestamps.showStatusBar';
const DEBUG_SETTING = 'riplexaTimestamps.diagnostics';
const REMOVED_KEY = 'riplexaTimestamps.removed';

/** Every install of this adapter's host extension: the active one plus sibling versions in the same folder. */
function installs(adapter) {
  const ext = vscode.extensions.getExtension(adapter.id);
  if (!ext) return [];
  return Array.from(new Set([ext.extensionPath, ...adapter.findInstalls(path.dirname(ext.extensionPath))]));
}

const cfg = () => vscode.workspace.getConfiguration();
function enabled() { return cfg().get(SETTING, true); }
function options() { return { enabled: enabled(), userColor: cfg().get(COLOR_SETTING, ''), debug: cfg().get(DEBUG_SETTING, false) }; }

async function offerReload(text) {
  const pick = await vscode.window.showInformationMessage(text, 'Reload Window');
  if (pick === 'Reload Window') vscode.commands.executeCommand('workbench.action.reloadWindow');
}

function activate(context) {
  const log = vscode.window.createOutputChannel('Riplexa Timestamps');
  context.subscriptions.push(log);
  const removed = () => context.globalState.get(REMOVED_KEY, false) === true;

  /* On/off, colors and diagnostics are live (each panel picks them up within ~2 s). Only installing, upgrading or
     removing the patch itself asks for a reload, once. */
  async function sync({ interactive = false } = {}) {
    const patchedPanels = [], restoredPanels = [], problems = [];
    let found = 0;
    for (const adapter of ADAPTERS) {
      for (const dir of installs(adapter)) {
        found++;
        const label = `${adapter.name} (${path.basename(dir)})`;
        try {
          if (removed()) {
            const r = adapter.restore(dir);
            log.appendLine(`${label}: ${r.message}`);
            if (r.changed && !restoredPanels.includes(adapter.name)) restoredPanels.push(adapter.name);
          } else {
            const r = adapter.apply(dir, options());
            log.appendLine(`${label}: ${r.message}${r.liveChanged ? ' (live settings updated)' : ''}`);
            if (r.changed && !patchedPanels.includes(adapter.name)) patchedPanels.push(adapter.name);
            else if (!r.changed && r.message !== 'already patched') problems.push(`${label}: ${r.message}`);
          }
        } catch (e) {
          problems.push(`${label}: ${e.message}`);
          log.appendLine(`${label}: error ${e.stack || e.message}`);
        }
      }
    }
    if (!found && interactive) vscode.window.showWarningMessage('Riplexa Timestamps: no supported chat panel (Claude Code, Codex) is installed.');
    if (problems.length) vscode.window.showWarningMessage('Riplexa Timestamps: ' + problems.join(' | '));
    if (patchedPanels.length) offerReload(`Riplexa Timestamps is installed in ${patchedPanels.join(' and ')}. Reload the window (or reopen the panel) once to start; after that, On/Off and colors change live.`);
    if (restoredPanels.length) offerReload(`Riplexa Timestamps was removed from ${restoredPanels.join(' and ')}. Reload the window to finish.`);
  }

  // Status bar toggle: shows On/Off and flips it on click.
  const bar = vscode.window.createStatusBarItem('riplexaTimestamps.toggle', vscode.StatusBarAlignment.Left, 50);
  bar.name = 'Riplexa Timestamps';
  bar.command = 'riplexaTimestamps.toggle';
  const renderBar = () => {
    const on = enabled() && !removed();
    bar.text = on ? '$(clock) Timestamp: On' : '$(circle-slash) Timestamp: Off';
    bar.tooltip = on ? 'Riplexa Timestamps is ON — click to turn it off' : 'Riplexa Timestamps is OFF — click to turn it on';
    if (cfg().get(STATUS_BAR_SETTING, true)) bar.show(); else bar.hide();
  };
  context.subscriptions.push(bar);

  const setEnabled = async (value) => {
    if (value && removed()) await context.globalState.update(REMOVED_KEY, false);
    if (enabled() === value) { renderBar(); await sync({ interactive: true }); return; }
    await cfg().update(SETTING, value, vscode.ConfigurationTarget.Global);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('riplexaTimestamps.enable', () => setEnabled(true)),
    vscode.commands.registerCommand('riplexaTimestamps.disable', () => setEnabled(false)),
    vscode.commands.registerCommand('riplexaTimestamps.toggle', () => setEnabled(!(enabled() && !removed()))),
    vscode.commands.registerCommand('riplexaTimestamps.remove', async () => {
      await context.globalState.update(REMOVED_KEY, true);
      renderBar();
      await sync({ interactive: true });
    }),
    vscode.commands.registerCommand('riplexaTimestamps.status', () => {
      const lines = [];
      for (const adapter of ADAPTERS) for (const d of installs(adapter)) lines.push(`${adapter.name} ${path.basename(d)}: ${adapter.status(d)}`);
      vscode.window.showInformationMessage('Riplexa Timestamps — ' + (lines.join(' | ') || 'no supported panel installed') + (removed() ? ' (removed)' : ''));
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SETTING) || e.affectsConfiguration(STATUS_BAR_SETTING)) renderBar();
      if (![SETTING, COLOR_SETTING, DEBUG_SETTING].some((k) => e.affectsConfiguration(k))) return;
      const c = cfg().get(COLOR_SETTING, '');
      if (c && !live.safeColor(c)) vscode.window.showWarningMessage(`Riplexa Timestamps: "${c}" is not a CSS color (use e.g. #90EE90, lightgreen or rgb(144,238,144)); your message color is left unchanged.`);
      sync();
    }),
    // Host extension updates arrive as a new folder: patch it as soon as it appears.
    vscode.extensions.onDidChange(() => sync()),
  );

  renderBar();
  return sync();
}

function deactivate() {}

module.exports = { activate, deactivate };
