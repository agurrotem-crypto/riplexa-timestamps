'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const patcher = require('../src/patcher');

// The two code shapes the patch targets, as they appear in Claude Code 2.1.270's webview (identifiers are minified
// and differ between builds; the shapes are what the patch matches).
const FIXTURE = [
  'var x=1;',
  'function VT($,{foldedIntoTurn:J=!1}={}){if($.type==="user"||$.type==="assistant"){let z=[];return new _Z($.type,z,{uuid:$.uuid,foldedIntoTurn:J,betaMessageId:void 0})}}',
  'class _Z{constructor($,J,{uuid:Z,timestamp:X=Date.now()}){this.type=$;this.content=J;this.uuid=Z;this.timestamp=X}}',
  'function pm($,J){if(J.type==="user"){if(Array.isArray(J.message.content)){for(let X of J.message.content)if(X.type==="tool_result"){let Q=l51($,X.tool_use_id);if(Q)Q.setToolResult(X)}}}}',
  'function l51(){return null}',
].join('\n');

function tmpInstall(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anthropic.claude-code-9.9.9-'));
  fs.mkdirSync(path.join(dir, 'webview'));
  fs.writeFileSync(path.join(dir, 'webview', 'index.js'), src);
  return dir;
}

test('patchSource applies both edits exactly once and the result parses', () => {
  const r = patcher.patchSource(FIXTURE);
  assert.equal(r.error, undefined);
  assert.match(r.out, /uuid:\$\.uuid,timestamp:\(typeof \$\.timestamp==="string"&&Date\.parse\(\$\.timestamp\)\)\|\|void 0,foldedIntoTurn:J/);
  assert.match(r.out, /Q\.setToolResult\(X\);Q\.riplexaTsResult=\(typeof J\.timestamp==="string"&&Date\.parse\(J\.timestamp\)\)\|\|void 0/);
  assert.equal(r.out.split(patcher.MARK).length - 1, 1);
  new vm.Script(r.out);
});

test('the message builder now keeps the transcript time instead of "now"', () => {
  const r = patcher.patchSource(FIXTURE);
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(r.out.slice(0, r.out.indexOf(patcher.MARK)) + ';this.VT=VT;', ctx);
  const m = ctx.VT({ type: 'user', uuid: 'u1', timestamp: '2026-09-13T17:58:57.707Z', message: { content: [] } });
  assert.equal(m.timestamp, Date.parse('2026-09-13T17:58:57.707Z'));
});

test('an unsupported build is refused and nothing is half-applied', () => {
  assert.match(patcher.patchSource('var a=1;').error, /not supported/);
  const dir = tmpInstall('var a=1;');
  const r = patcher.apply(dir);
  assert.equal(r.changed, false);
  assert.equal(fs.readFileSync(patcher.webviewFile(dir), 'utf8'), 'var a=1;');
  assert.equal(fs.existsSync(patcher.webviewFile(dir) + patcher.BACKUP_SUFFIX), false);
});

test('apply is idempotent, keeps the original, and restore returns it byte for byte', () => {
  const dir = tmpInstall(FIXTURE);
  const file = patcher.webviewFile(dir);
  assert.equal(patcher.status(dir), 'clean');
  assert.deepEqual(patcher.apply(dir), { changed: true, liveChanged: true, message: 'patched' });
  assert.equal(patcher.status(dir), 'patched');
  assert.equal(fs.readFileSync(file + patcher.BACKUP_SUFFIX, 'utf8'), FIXTURE);
  assert.deepEqual(patcher.apply(dir), { changed: false, liveChanged: false, message: 'already patched' });
  assert.deepEqual(patcher.restore(dir), { changed: true, message: 'restored' });
  assert.equal(fs.readFileSync(file, 'utf8'), FIXTURE);
  assert.equal(fs.existsSync(file + patcher.BACKUP_SUFFIX), false);
  assert.equal(patcher.status(dir), 'clean');
});

test('an older version of the patch is rebuilt from the original, never stacked', () => {
  const dir = tmpInstall(FIXTURE + '\n/* RIPLEXA-VS-TIMESTAMP v0 */');
  fs.writeFileSync(patcher.webviewFile(dir) + patcher.BACKUP_SUFFIX, FIXTURE);
  assert.equal(patcher.status(dir), 'outdated');
  assert.equal(patcher.apply(dir).changed, true);
  const out = fs.readFileSync(patcher.webviewFile(dir), 'utf8');
  assert.equal(out.split(patcher.ANY_MARK).length - 1, 1);
  assert.equal(fs.readFileSync(patcher.webviewFile(dir) + patcher.BACKUP_SUFFIX, 'utf8'), FIXTURE);
});

test('findInstalls lists every Claude Code version folder and nothing else', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exts-'));
  for (const n of ['anthropic.claude-code-2.1.1', 'anthropic.claude-code-2.1.2-win32-x64', 'yechielby.claude-code-rtl-0.5.0']) fs.mkdirSync(path.join(root, n));
  assert.deepEqual(patcher.findInstalls(root).map((d) => path.basename(d)).sort(), ['anthropic.claude-code-2.1.1', 'anthropic.claude-code-2.1.2-win32-x64']);
});

// ── the in-panel script, on a simulated DOM with React fibers ────────────────────────────────────────────────────
const txt = (v) => ({ nodeType: 3, nodeValue: v });
function el(tag, cls, kids, props) {
  const e = {
    nodeType: 1, tagName: tag, className: cls || '', _a: {}, childNodes: kids || [],
    get children() { return this.childNodes.filter((n) => n.nodeType === 1); },
    get textContent() { return this.childNodes.map((n) => (n.nodeType === 3 ? n.nodeValue : n.textContent)).join(''); },
    setAttribute(k, v) { this._a[k] = v; }, getAttribute(k) { return this._a[k]; },
    hasAttribute(k) { return k in this._a; }, removeAttribute(k) { delete this._a[k]; },
  };
  if (props) { let f = null; for (const p of props.slice().reverse()) f = { memoizedProps: p, return: f }; e.__reactFiber$test = { memoizedProps: {}, return: f }; }
  return e;
}
const BASE = 'https://file+.vscode-resource.vscode-cdn.net/c%3A/ext/anthropic.claude-code-9/webview/';
function runScript(userBubbles, assistantMessages, { withLink = true } = {}) {
  const ctx = {
    window: {}, Date, Map, Set, Math, Array, String, isFinite, Object,
    cssVars: {}, appended: [], images: [], intervals: [],
    document: {
      createElement: (tag) => ({ tagName: tag.toUpperCase(), parentNode: null }),
      documentElement: {},
      querySelector: (sel) => (withLink && sel.includes('index.css') ? { href: BASE + 'index.css?v=1' } : null),
      querySelectorAll: (sel) => (sel.includes('userMessage_') ? userBubbles : assistantMessages),
    },
    getComputedStyle: () => ({ getPropertyValue: (k) => ctx.cssVars[k] || '' }),
    Image: function () { ctx.images.push(this); },
    MutationObserver: function (cb) { ctx.onMutation = cb; this.observe = () => {}; },
    requestAnimationFrame: (f) => f(), setTimeout: (f) => f(), setInterval: (f) => { ctx.intervals.push(f); },
  };
  const head = { removeChild(n) { n.parentNode = null; ctx.appended = ctx.appended.filter((x) => x !== n); } };
  head.appendChild = (n) => { n.parentNode = head; ctx.appended.push(n); };
  ctx.document.head = head;
  vm.createContext(ctx);
  vm.runInContext(patcher.SCRIPT, ctx);
  return ctx;
}
const links = (ctx) => ctx.appended.filter((n) => n.tagName === 'LINK');
const today = (h, m, s) => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), h, m, s).getTime(); };
const ts = (e) => e._a['data-riplexa-ts'] || null;

test('the user message gets one time, inline on its text line, never on an attachment chip', () => {
  const msg = { timestamp: today(20, 58, 57) };
  const chip = el('span', '', [txt('index.js')]);
  const text = el('div', 'content_x', [txt('בדיקה 4')]);
  const empty = el('div', 'userMessage_x', [], [{ message: msg }]);
  const bubble = el('div', 'userMessage_x', [el('div', 'userMessageAttachments_x', [chip]), el('div', '', [text])], [{ message: msg }]);
  const ctx = runScript([empty, bubble], []);
  assert.equal(ts(text), '20:58:57');
  assert.equal(ts(chip), null);
  assert.equal(ts(empty), null);
  assert.equal(ts(bubble), null);
  assert.equal(links(ctx).length, 1);
  assert.match(links(ctx)[0].href, /^https:\/\/file\+\.vscode-resource\.vscode-cdn\.net\/c%3A\/ext\/anthropic\.claude-code-9\/webview\/riplexa-vs-timestamp\.css\?t=\d+$/);
});

test('live settings: Off clears every mark without a reload, On brings them back', () => {
  const msg = { timestamp: today(21, 28, 44) };
  const text = el('div', '', [txt('בלי RELOAD')]);
  const ctx = runScript([el('div', 'userMessage_x', [text], [{ message: msg }])], []);
  links(ctx)[0].onload();
  assert.equal(ts(text), '21:28:44');
  ctx.cssVars['--riplexa-ts-on'] = '0';
  ctx.onMutation();
  assert.equal(ts(text), null);
  ctx.cssVars['--riplexa-ts-on'] = '1';
  ctx.onMutation();
  assert.equal(ts(text), '21:28:44');
});

test('live settings: the stylesheet is reloaded only when the revision image changes, and the old one is removed', () => {
  const ctx = runScript([], []);
  const first = links(ctx)[0];
  first.onload();
  assert.equal(ctx.images.length, 1);
  assert.match(ctx.images[0].src, /riplexa-vs-timestamp\.rev\.svg\?t=\d+$/);
  ctx.images[0].naturalWidth = 7; ctx.images[0].onload();          // first sighting: nothing to reload
  assert.equal(links(ctx).length, 1);
  ctx.intervals[0](); ctx.images[1].naturalWidth = 7; ctx.images[1].onload();   // same revision
  assert.equal(links(ctx).length, 1);
  ctx.intervals[0](); ctx.images[2].naturalWidth = 8; ctx.images[2].onload();   // settings changed
  assert.equal(links(ctx).length, 2);
  links(ctx)[1].onload();
  assert.deepEqual(links(ctx).map((l) => l === first), [false], 'the previous stylesheet is gone once the new one loaded');
});

test('without a readable live stylesheet the marks still show, with the built-in style', () => {
  const noLink = runScript([], [], { withLink: false });
  const style = noLink.appended.find((n) => n.tagName === 'STYLE');
  assert.ok(style && style.textContent === patcher.STAMP_CSS);
  const failed = runScript([], []);
  links(failed)[0].onerror();
  assert.ok(failed.appended.some((n) => n.tagName === 'STYLE' && n.textContent === patcher.STAMP_CSS));
});

test('assistant rows: text and thinking get their time, a tool call gets start→result, unknown times get nothing', () => {
  const msg = { uuid: 'a1', timestamp: today(20, 59, 22) };
  const p = el('p', '', [txt('reply text')]);
  const toolName = el('span', 'toolNameText_x', [txt('PowerShell')]);
  const pendingName = el('span', 'toolNameText_x', [txt('Bash')]);
  const streamingP = el('p', '', [txt('still streaming')]);
  const oldP = el('p', '', [txt('old')]);
  const rows = {
    children: [
      el('div', '', [el('div', 'md', [p])], [{ content: { content: { type: 'text' } } }, { message: msg }]),
      el('div', 'toolUse_x', [el('div', '', [el('svg', '', []), toolName])], [{ content: { content: { type: 'tool_use' }, riplexaTsResult: today(20, 59, 26) } }, { message: msg }]),
      el('div', 'toolUse_x', [el('div', '', [pendingName])], [{ content: { content: { type: 'tool_use' } } }, { message: msg }]),
      el('div', '', [txt('feedback')], [{ session: {} }, { message: msg }]),
    ],
  };
  const streaming = { children: [el('div', '', [streamingP], [{ content: { content: { type: 'text' } } }, { message: { uuid: undefined, timestamp: today(20, 59, 30) } }])] };
  const older = { children: [el('div', '', [oldP], [{ content: { content: { type: 'text' } } }, { message: { uuid: 'o', timestamp: new Date(2026, 8, 10, 12, 1, 2).getTime() } }])] };
  runScript([], [rows, streaming, older]);
  assert.equal(ts(p), '20:59:22');
  assert.equal(ts(toolName), '20:59:22→20:59:26');
  assert.equal(ts(pendingName), '20:59:22');
  assert.equal(ts(rows.children[3]), null);
  assert.equal(ts(streamingP), null);
  assert.equal(ts(oldP), '10/09 12:01:02');
});

test('when React replaces the text element the time moves with it and the old node is cleaned', () => {
  const msg = { timestamp: today(9, 5, 7) };
  const first = el('div', '', [txt('hello')]);
  const holder = el('div', '', [first]);
  const bubble = el('div', 'userMessage_x', [holder], [{ message: msg }]);
  const ctx = runScript([bubble], []);
  assert.equal(ts(first), '09:05:07');
  const second = el('div', '', [txt('hello, edited')]);
  holder.childNodes[0] = second;
  ctx.onMutation();
  assert.equal(ts(second), '09:05:07');
  assert.equal(ts(first), null);
});

test('live stylesheet: on/off flag, the stamp style only when on, and only a plain CSS color', () => {
  for (const ok of ['#90EE90', '#9e9', 'lightgreen', 'rgb(144,238,144)', 'hsl(120 73% 75%)']) assert.equal(patcher.safeColor(ok), ok);
  for (const bad of ['red;}body{display:none', 'lightgreen */ alert(1) /*', 'url(x)', 'var(--x)', '#12', '']) assert.equal(patcher.safeColor(bad), '');
  const on = patcher.liveCss({});
  assert.match(on, /--riplexa-ts-on:1;/);
  assert.ok(on.includes(patcher.STAMP_CSS));
  assert.doesNotMatch(on, /userMessage_/);
  const off = patcher.liveCss({ enabled: false, userColor: '#90EE90' });
  assert.match(off, /--riplexa-ts-on:0;/);
  assert.ok(!off.includes(patcher.STAMP_CSS));
  assert.match(off, /\[class\*="userMessage_"\],\[class\*="userMessage_"\] \*\{color:#90EE90 !important;\}/, 'color is independent of the timestamps');
  assert.equal(patcher.liveCss({ userColor: 'red;}body{display:none' }), on, 'a rejected color is the same as no color');
});

test('settings changes never touch index.js: they rewrite the live files and bump the revision only on a real change', () => {
  const dir = tmpInstall(FIXTURE);
  const file = patcher.webviewFile(dir);
  const { css, rev } = patcher.liveFiles(dir);
  const revOf = () => Number(fs.readFileSync(rev, 'utf8').match(/width="(\d+)"/)[1]);
  assert.deepEqual(patcher.apply(dir, {}), { changed: true, liveChanged: true, message: 'patched' });
  const patched = fs.readFileSync(file, 'utf8');
  assert.equal(revOf(), 1);
  assert.deepEqual(patcher.apply(dir, {}), { changed: false, liveChanged: false, message: 'already patched' });
  assert.equal(revOf(), 1);
  assert.deepEqual(patcher.apply(dir, { userColor: '#90EE90' }), { changed: false, liveChanged: true, message: 'already patched' });
  assert.equal(revOf(), 2);
  assert.match(fs.readFileSync(css, 'utf8'), /#90EE90/);
  assert.deepEqual(patcher.apply(dir, { enabled: false, userColor: '#90EE90' }), { changed: false, liveChanged: true, message: 'already patched' });
  assert.equal(revOf(), 3);
  assert.equal(fs.readFileSync(file, 'utf8'), patched, 'index.js untouched by settings');
  patcher.restore(dir);
  assert.equal(fs.existsSync(css) || fs.existsSync(rev), false, 'restore removes the live files');
  assert.equal(fs.readFileSync(file, 'utf8'), FIXTURE);
});

// Optional: the real Claude Code build(s) on this machine, when present.
const realRoot = path.join(os.homedir(), '.vscode', 'extensions');
for (const dir of patcher.findInstalls(realRoot)) {
  const file = patcher.webviewFile(dir);
  if (!fs.existsSync(file)) continue;
  test(`real build ${path.basename(dir)} is supported`, (t) => {
    const backup = file + patcher.BACKUP_SUFFIX;
    const original = fs.readFileSync(fs.existsSync(backup) ? backup : file, 'utf8');
    if (original.includes(patcher.ANY_MARK) || /timestamp:\(typeof [\w$]+\.timestamp==="string"/.test(original)) {
      t.skip('this install is already modified; nothing unmodified to check');
      return;
    }
    const r = patcher.patchSource(original);
    assert.equal(r.error, undefined, r.error);
  });
}
