'use strict';
const vscode = require('vscode');
const path = require('path');
const patcher = require('./src/patcher');

const CLAUDE_ID = 'anthropic.claude-code';
const SETTING = 'riplexaVsTimestamp.enabled';
const COLOR_SETTING = 'riplexaVsTimestamp.userMessageColor';

/** Every Claude Code install this editor can load: the active one plus sibling versions in the same folder. */
function installs() {
  const ext = vscode.extensions.getExtension(CLAUDE_ID);
  if (!ext) return [];
  const siblings = patcher.findInstalls(path.dirname(ext.extensionPath));
  return Array.from(new Set([ext.extensionPath, ...siblings]));
}

function enabled() { return vscode.workspace.getConfiguration().get(SETTING, true); }
function options() { return { userColor: vscode.workspace.getConfiguration().get(COLOR_SETTING, '') }; }

async function offerReload(text) {
  const pick = await vscode.window.showInformationMessage(text, 'Reload Window');
  if (pick === 'Reload Window') vscode.commands.executeCommand('workbench.action.reloadWindow');
}

async function sync(log, { interactive = false } = {}) {
  const list = installs();
  if (!list.length) {
    if (interactive) vscode.window.showWarningMessage('Riplexa VS Timestamp: the Claude Code extension is not installed.');
    return;
  }
  let changed = false;
  const problems = [];
  for (const dir of list) {
    try {
      const r = enabled() ? patcher.apply(dir, options()) : patcher.restore(dir);
      log.appendLine(`${path.basename(dir)}: ${r.message}`);
      if (r.changed) changed = true;
      else if (enabled() && r.message !== 'already patched') problems.push(`${path.basename(dir)}: ${r.message}`);
    } catch (e) {
      problems.push(`${path.basename(dir)}: ${e.message}`);
      log.appendLine(`${path.basename(dir)}: error ${e.stack || e.message}`);
    }
  }
  if (problems.length) vscode.window.showWarningMessage('Riplexa VS Timestamp: ' + problems.join(' | '));
  if (changed) {
    offerReload(enabled()
      ? 'Riplexa VS Timestamp is ready. Reload the window (or reopen the Claude Code panel) to see times.'
      : 'Riplexa VS Timestamp removed. Reload the window to finish.');
  } else if (interactive && !problems.length) {
    vscode.window.showInformationMessage(`Riplexa VS Timestamp: ${enabled() ? 'active' : 'off'} (nothing to change).`);
  }
}

function activate(context) {
  const log = vscode.window.createOutputChannel('Riplexa VS Timestamp');
  context.subscriptions.push(log);

  context.subscriptions.push(
    vscode.commands.registerCommand('riplexaVsTimestamp.enable', async () => {
      await vscode.workspace.getConfiguration().update(SETTING, true, vscode.ConfigurationTarget.Global);
      await sync(log, { interactive: true });
    }),
    vscode.commands.registerCommand('riplexaVsTimestamp.disable', async () => {
      await vscode.workspace.getConfiguration().update(SETTING, false, vscode.ConfigurationTarget.Global);
      await sync(log, { interactive: true });
    }),
    vscode.commands.registerCommand('riplexaVsTimestamp.status', () => {
      const list = installs();
      const lines = list.map((d) => `${path.basename(d)}: ${patcher.status(d, options())}`);
      vscode.window.showInformationMessage('Riplexa VS Timestamp — ' + (lines.join(' | ') || 'Claude Code not installed'));
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(SETTING) && !e.affectsConfiguration(COLOR_SETTING)) return;
      const c = vscode.workspace.getConfiguration().get(COLOR_SETTING, '');
      if (c && !patcher.safeColor(c)) vscode.window.showWarningMessage(`Riplexa VS Timestamp: "${c}" is not a CSS color (use e.g. #90EE90, lightgreen or rgb(144,238,144)); your message color is left unchanged.`);
      sync(log);
    }),
    // Claude Code updates arrive as a new extension folder: patch it as soon as it appears.
    vscode.extensions.onDidChange(() => sync(log)),
  );

  sync(log);
}

function deactivate() {}

module.exports = { activate, deactivate };
