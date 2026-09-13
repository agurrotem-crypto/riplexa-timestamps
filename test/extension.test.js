'use strict';
// Runs the real extension.js against a fake `vscode` module: the status-bar toggle, the commands, and that turning
// it off restores Claude Code's original panel file while turning it on patches it (with the configured color).
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
  return { api, bar, commands, config, messages, fire };
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

function tmpClaude() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exts-'));
  const dir = path.join(root, 'anthropic.claude-code-9.9.9');
  fs.mkdirSync(path.join(dir, 'webview'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'webview', 'index.js'), FIXTURE);
  return dir;
}

test('status bar shows On after activation, patches with the color, and a click turns it Off and restores the original', async () => {
  const dir = tmpClaude();
  const fake = fakeVscode(dir, { 'riplexaVsTimestamp.userMessageColor': '#90EE90' });
  const ext = loadExtension(fake);
  await ext.activate({ subscriptions: [] });
  assert.equal(fake.bar.visible, true);
  assert.match(fake.bar.text, /Timestamp: On/);
  assert.equal(fake.bar.command, 'riplexaVsTimestamp.toggle');
  assert.equal(patcher.status(dir, { userColor: '#90EE90' }), 'patched');
  assert.ok(fake.messages.some(([, m]) => /Reload the window/.test(m)), 'asks for a reload after patching');

  await fake.commands['riplexaVsTimestamp.toggle']();
  await settle();
  assert.match(fake.bar.text, /Timestamp: Off/);
  assert.equal(fake.config['riplexaVsTimestamp.enabled'], false);
  assert.equal(fs.readFileSync(patcher.webviewFile(dir), 'utf8'), FIXTURE, 'original restored byte for byte');

  await fake.commands['riplexaVsTimestamp.toggle']();
  await settle();
  assert.match(fake.bar.text, /Timestamp: On/);
  assert.equal(patcher.status(dir, { userColor: '#90EE90' }), 'patched');
});

test('the status bar item can be hidden by setting', async () => {
  const fake = fakeVscode(tmpClaude(), { 'riplexaVsTimestamp.showStatusBar': false });
  const ext = loadExtension(fake);
  await ext.activate({ subscriptions: [] });
  assert.equal(fake.bar.visible, false);
  fake.config['riplexaVsTimestamp.showStatusBar'] = true;
  fake.fire('riplexaVsTimestamp.showStatusBar');
  assert.equal(fake.bar.visible, true);
});

test('changing the color setting re-patches; an invalid color warns and leaves the color off', async () => {
  const dir = tmpClaude();
  const fake = fakeVscode(dir, {});
  const ext = loadExtension(fake);
  await ext.activate({ subscriptions: [] });
  assert.equal(patcher.status(dir, {}), 'patched');
  fake.config['riplexaVsTimestamp.userMessageColor'] = 'lightgreen';
  fake.fire('riplexaVsTimestamp.userMessageColor');
  await settle();
  assert.equal(patcher.status(dir, { userColor: 'lightgreen' }), 'patched');
  fake.config['riplexaVsTimestamp.userMessageColor'] = 'red;}body{display:none';
  fake.fire('riplexaVsTimestamp.userMessageColor');
  await settle();
  assert.ok(fake.messages.some(([k, m]) => k === 'warn' && /is not a CSS color/.test(m)));
  assert.equal(patcher.status(dir, {}), 'patched', 'invalid color = no color rule');
});
