'use strict';
const vscode = require('vscode');
const path = require('path');
const patcher = require('./src/patcher');

const CLAUDE_ID = 'anthropic.claude-code';
const SETTING = 'riplexaVsTimestamp.enabled';
const COLOR_SETTING = 'riplexaVsTimestamp.userMessageColor';
const STATUS_BAR_SETTING = 'riplexaVsTimestamp.showStatusBar';
const REMOVED_KEY = 'riplexaVsTimestamp.removed';

/** Every Claude Code install this editor can load: the active one plus sibling versions in the same folder. */
function installs() {
  const ext = vscode.extensions.getExtension(CLAUDE_ID);
  if (!ext) return [];
  const siblings = patcher.findInstalls(path.dirname(ext.extensionPath));
  return Array.from(new Set([ext.extensionPath, ...siblings]));
}

const cfg = () => vscode.workspace.getConfiguration();
function enabled() { return cfg().get(SETTING, true); }
function options() { return { enabled: enabled(), userColor: cfg().get(COLOR_SETTING, '') }; }

async function offerReload(text) {
  const pick = await vscode.window.showInformationMessage(text, 'Reload Window');
  if (pick === 'Reload Window') vscode.commands.executeCommand('workbench.action.reloadWindow');
}

function activate(context) {
  const log = vscode.window.createOutputChannel('Riplexa VS Timestamp');
  context.subscriptions.push(log);
  const removed = () => context.globalState.get(REMOVED_KEY, false) === true;

  /* On/off and color are live (the panel picks them up within ~2 s). Only installing, upgrading or removing the
     patch itself asks for a reload. */
  async function sync({ interactive = false } = {}) {
    const list = installs();
    if (!list.length) {
      if (interactive) vscode.window.showWarningMessage('Riplexa VS Timestamp: the Claude Code extension is not installed.');
      return;
    }
    let patched = false, restored = false;
    const problems = [];
    for (const dir of list) {
      try {
        if (removed()) {
          const r = patcher.restore(dir);
          log.appendLine(`${path.basename(dir)}: ${r.message}`);
          if (r.changed) restored = true;
        } else {
          const r = patcher.apply(dir, options());
          log.appendLine(`${path.basename(dir)}: ${r.message}${r.liveChanged ? ' (live settings updated)' : ''}`);
          if (r.changed) patched = true;
          else if (r.message !== 'already patched') problems.push(`${path.basename(dir)}: ${r.message}`);
        }
      } catch (e) {
        problems.push(`${path.basename(dir)}: ${e.message}`);
        log.appendLine(`${path.basename(dir)}: error ${e.stack || e.message}`);
      }
    }
    if (problems.length) vscode.window.showWarningMessage('Riplexa VS Timestamp: ' + problems.join(' | '));
    if (patched) offerReload('Riplexa VS Timestamp is installed in Claude Code. Reload the window (or reopen the Claude Code panel) once to start; after that, On/Off and colors change live.');
    if (restored) offerReload('Riplexa VS Timestamp was removed from Claude Code. Reload the window to finish.');
  }

  // Status bar toggle: shows On/Off and flips it on click.
  const bar = vscode.window.createStatusBarItem('riplexaVsTimestamp.toggle', vscode.StatusBarAlignment.Left, 50);
  bar.name = 'Riplexa VS Timestamp';
  bar.command = 'riplexaVsTimestamp.toggle';
  const renderBar = () => {
    const on = enabled() && !removed();
    bar.text = on ? '$(clock) Timestamp: On' : '$(circle-slash) Timestamp: Off';
    bar.tooltip = on ? 'Riplexa VS Timestamp is ON — click to turn it off' : 'Riplexa VS Timestamp is OFF — click to turn it on';
    if (cfg().get(STATUS_BAR_SETTING, true)) bar.show(); else bar.hide();
  };
  context.subscriptions.push(bar);

  const setEnabled = async (value) => {
    if (value && removed()) await context.globalState.update(REMOVED_KEY, false);
    if (enabled() === value) { renderBar(); await sync({ interactive: true }); return; }
    await cfg().update(SETTING, value, vscode.ConfigurationTarget.Global);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('riplexaVsTimestamp.enable', () => setEnabled(true)),
    vscode.commands.registerCommand('riplexaVsTimestamp.disable', () => setEnabled(false)),
    vscode.commands.registerCommand('riplexaVsTimestamp.toggle', () => setEnabled(!(enabled() && !removed()))),
    vscode.commands.registerCommand('riplexaVsTimestamp.remove', async () => {
      await context.globalState.update(REMOVED_KEY, true);
      renderBar();
      await sync({ interactive: true });
    }),
    vscode.commands.registerCommand('riplexaVsTimestamp.status', () => {
      const lines = installs().map((d) => `${path.basename(d)}: ${patcher.status(d)}`);
      vscode.window.showInformationMessage('Riplexa VS Timestamp — ' + (lines.join(' | ') || 'Claude Code not installed') + (removed() ? ' (removed)' : ''));
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SETTING) || e.affectsConfiguration(STATUS_BAR_SETTING)) renderBar();
      if (!e.affectsConfiguration(SETTING) && !e.affectsConfiguration(COLOR_SETTING)) return;
      const c = cfg().get(COLOR_SETTING, '');
      if (c && !patcher.safeColor(c)) vscode.window.showWarningMessage(`Riplexa VS Timestamp: "${c}" is not a CSS color (use e.g. #90EE90, lightgreen or rgb(144,238,144)); your message color is left unchanged.`);
      sync();
    }),
    // Claude Code updates arrive as a new extension folder: patch it as soon as it appears.
    vscode.extensions.onDidChange(() => sync()),
  );

  renderBar();
  return sync();
}

function deactivate() {}

module.exports = { activate, deactivate };
