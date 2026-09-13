'use strict';
// Runs the real extension.js against a fake `vscode` module: the status-bar toggle, live settings (no reload), and the
// Remove command that restores Claude Code's original files.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const patcher = require('../src/patcher');

const FIXTURE = [
  'function VT($,{foldedIntoTurn:J=!1}={}){if($.type==="user"||$.type==="assistant"){let z=[];return new _Z($.type,z,{uuid:$.uuid,foldedIntoTurn:J,betaMessageId:void 0})}}',
  'function pm($,J){if(J.type==="user"){if(Array.isArray(J.message.content)){for(let X of J.message.content)if(X.type==="tool_result"){let Q=l51($,X.tool_use_id);if(Q)Q.setToolResult(X)}}}}',
].join('\n');

function fakeVscode(claudeDir, initialConfig) {
  const config = { ...initialConfig };
  const configListeners = [];
  const messages = [];
  const commands = {};
  const bar = { text: '', tooltip: '', visible: false, show() { this.visible = true; }, hide() { this.visible = false; }, dispose() {} };
  const fire = (key) => configListeners.forEach((l) => l({ affectsConfiguration: (k) => k === key }));
  const state = {};
  const api = {
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1 },
    window: {
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      createStatusBarItem: (id, align, prio) => Object.assign(bar, { id, align, prio }),
      showInformationMessage: async (m) => { messages.push(['info', m]); },
      showWarningMessage: async (m) => { messages.push(['warn', m]); },
    },
    workspace: {
      getConfiguration: () => ({
        get: (k, d) => (k in config ? config[k] : d),
        update: async (k, v) => { config[k] = v; fire(k); },
      }),
      onDidChangeConfiguration: (l) => { configListeners.push(l); return { dispose() {} }; },
    },
    commands: {
      registerCommand: (id, fn) => { commands[id] = fn; return { dispose() {} }; },
      executeCommand: async () => {},
    },
    extensions: {
      getExtension: (id) => (id === 'anthropic.claude-code' ? { extensionPath: claudeDir } : undefined),
      onDidChange: () => ({ dispose() {} }),
    },
  };
  const context = { subscriptions: [], globalState: { get: (k, d) => (k in state ? state[k] : d), update: async (k, v) => { state[k] = v; } } };
  return { api, bar, commands, config, messages, fire, context };
}

function loadExtension(fake) {
  const origLoad = Module._load;
  Module._load = function (request, ...rest) { return request === 'vscode' ? fake.api : origLoad.call(this, request, ...rest); };
  try {
    const p = require.resolve('../extension.js');
    delete require.cache[p];
    return require(p);
  } finally { Module._load = origLoad; }
}

const settle = () => new Promise((r) => setImmediate(r));
const reloadPrompts = (fake) => fake.messages.filter(([, m]) => /Reload the window/.test(m)).length;

function tmpClaude() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exts-'));
  const dir = path.join(root, 'anthropic.claude-code-9.9.9');
  fs.mkdirSync(path.join(dir, 'webview'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'webview', 'index.js'), FIXTURE);
  return dir;
}

test('first activation patches once and asks for ONE reload; the status bar shows On', async () => {
  const dir = tmpClaude();
  const fake = fakeVscode(dir, { 'riplexaVsTimestamp.userMessageColor': '#90EE90' });
  await loadExtension(fake).activate(fake.context);
  assert.equal(patcher.status(dir), 'patched');
  assert.match(fs.readFileSync(patcher.liveFiles(dir).css, 'utf8'), /#90EE90/);
  assert.equal(fake.bar.visible, true);
  assert.match(fake.bar.text, /Timestamp: On/);
  assert.equal(fake.bar.command, 'riplexaVsTimestamp.toggle');
  assert.equal(reloadPrompts(fake), 1);
});

test('clicking the toggle turns timestamps off and on LIVE: index.js untouched, no reload prompt', async () => {
  const dir = tmpClaude();
  const fake = fakeVscode(dir, {});
  await loadExtension(fake).activate(fake.context);
  const patched = fs.readFileSync(patcher.webviewFile(dir), 'utf8');
  const prompts = reloadPrompts(fake);

  await fake.commands['riplexaVsTimestamp.toggle']();
  await settle();
  assert.match(fake.bar.text, /Timestamp: Off/);
  assert.match(fs.readFileSync(patcher.liveFiles(dir).css, 'utf8'), /--riplexa-ts-on:0;/);

  await fake.commands['riplexaVsTimestamp.toggle']();
  await settle();
  assert.match(fake.bar.text, /Timestamp: On/);
  assert.match(fs.readFileSync(patcher.liveFiles(dir).css, 'utf8'), /--riplexa-ts-on:1;/);

  fake.config['riplexaVsTimestamp.userMessageColor'] = 'lightgreen';
  fake.fire('riplexaVsTimestamp.userMessageColor');
  await settle();
  assert.match(fs.readFileSync(patcher.liveFiles(dir).css, 'utf8'), /color:lightgreen !important/);

  assert.equal(fs.readFileSync(patcher.webviewFile(dir), 'utf8'), patched, 'index.js never rewritten by settings');
  assert.equal(reloadPrompts(fake), prompts, 'no reload prompt for live settings');
});

test('an invalid color warns and leaves the color off', async () => {
  const dir = tmpClaude();
  const fake = fakeVscode(dir, {});
  await loadExtension(fake).activate(fake.context);
  fake.config['riplexaVsTimestamp.userMessageColor'] = 'red;}body{display:none';
  fake.fire('riplexaVsTimestamp.userMessageColor');
  await settle();
  assert.ok(fake.messages.some(([k, m]) => k === 'warn' && /is not a CSS color/.test(m)));
  assert.doesNotMatch(fs.readFileSync(patcher.liveFiles(dir).css, 'utf8'), /userMessage_/);
});

test('Remove restores the original files and stays removed until turned on again', async () => {
  const dir = tmpClaude();
  const fake = fakeVscode(dir, {});
  const ext = loadExtension(fake);
  await ext.activate(fake.context);
  await fake.commands['riplexaVsTimestamp.remove']();
  assert.equal(fs.readFileSync(patcher.webviewFile(dir), 'utf8'), FIXTURE);
  assert.equal(fs.existsSync(patcher.liveFiles(dir).css), false);
  assert.match(fake.bar.text, /Timestamp: Off/);
  assert.ok(fake.messages.some(([, m]) => /was removed from Claude Code/.test(m)));

  await ext.activate(fake.context);                       // a restart does not bring it back
  assert.equal(fs.readFileSync(patcher.webviewFile(dir), 'utf8'), FIXTURE);

  await fake.commands['riplexaVsTimestamp.toggle']();       // turning on again re-installs it
  await settle();
  assert.equal(patcher.status(dir), 'patched');
  assert.match(fake.bar.text, /Timestamp: On/);
});

test('the status bar item can be hidden by setting', async () => {
  const fake = fakeVscode(tmpClaude(), { 'riplexaVsTimestamp.showStatusBar': false });
  await loadExtension(fake).activate(fake.context);
  assert.equal(fake.bar.visible, false);
  fake.config['riplexaVsTimestamp.showStatusBar'] = true;
  fake.fire('riplexaVsTimestamp.showStatusBar');
  assert.equal(fake.bar.visible, true);
});
