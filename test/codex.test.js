'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const codex = require('../src/codex');
const live = require('../src/live');

const HTML = '<!doctype html><html><head><!-- PROD_BASE_TAG_HERE --><!-- PROD_CSP_TAG_HERE --><title>ChatGPT</title></head><body><div id="root"></div><script type="module" src="./assets/index-1.js"></script></body></html>';

function tmpCodex(html = HTML) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openai.chatgpt-26.1.1-'));
  fs.mkdirSync(path.join(dir, 'webview', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'webview', 'index.html'), html);
  return dir;
}

test('the block goes in exactly once before </head>, after the base tag, and re-injecting is a no-op', () => {
  const r = codex.injectHtml(HTML);
  assert.equal(r.error, undefined);
  assert.ok(r.out.indexOf('PROD_BASE_TAG_HERE') < r.out.indexOf(codex.BLOCK), 'after the base tag so ./assets resolves');
  assert.ok(r.out.indexOf(codex.BLOCK) < r.out.indexOf('</head>'));
  assert.equal(codex.injectHtml(r.out).out, r.out);
  assert.match(codex.injectHtml('<html><body></body></html>').error, /not supported/);
  assert.match(codex.injectHtml('<head></head><head></head>').error, /2 times/);
});

test('apply writes the script, the block and the live files; restore returns index.html byte for byte', () => {
  const dir = tmpCodex();
  assert.equal(codex.status(dir), 'clean');
  assert.deepEqual(codex.apply(dir, { userColor: '#90EE90' }), { changed: true, liveChanged: true, message: 'patched' });
  assert.equal(codex.status(dir), 'patched');
  assert.match(fs.readFileSync(codex.htmlFile(dir), 'utf8'), new RegExp(codex.LOADER_FILE.replace(/\./g, '\\.')));
  assert.equal(fs.readFileSync(codex.loaderFile(dir), 'utf8'), codex.LOADER);
  assert.equal(fs.readFileSync(codex.scriptFile(dir), 'utf8'), codex.SCRIPT);
  assert.match(fs.readFileSync(codex.scriptVerFile(dir), 'utf8'), /width="1"/);
  const css = fs.readFileSync(path.join(codex.liveDir(dir), live.LIVE_CSS), 'utf8');
  assert.match(css, /\[data-riplexa-user\],\[data-riplexa-user\] \*\{color:#90EE90 !important;\}/);
  assert.deepEqual(codex.apply(dir, { userColor: '#90EE90' }), { changed: false, liveChanged: false, message: 'already patched' });
  assert.deepEqual(codex.restore(dir), { changed: true, message: 'restored' });
  assert.equal(fs.readFileSync(codex.htmlFile(dir), 'utf8'), HTML);
  for (const f of [codex.loaderFile(dir), codex.scriptFile(dir), codex.scriptVerFile(dir), path.join(codex.liveDir(dir), live.LIVE_CSS), path.join(codex.liveDir(dir), live.LIVE_REV)]) assert.equal(fs.existsSync(f), false, f);
});

test('a new main script reaches an open panel with no reload: index.html untouched, version image bumped', () => {
  const dir = tmpCodex();
  codex.apply(dir, {});
  const html = fs.readFileSync(codex.htmlFile(dir), 'utf8');
  fs.writeFileSync(codex.scriptFile(dir), '/* an older main script */');
  const r = codex.apply(dir, {});
  assert.deepEqual(r, { changed: false, liveChanged: true, message: 'already patched' }, 'no reload prompt for a script update');
  assert.equal(fs.readFileSync(codex.htmlFile(dir), 'utf8'), html);
  assert.equal(fs.readFileSync(codex.scriptFile(dir), 'utf8'), codex.SCRIPT);
  assert.match(fs.readFileSync(codex.scriptVerFile(dir), 'utf8'), /width="2"/);
});

test('an open panel with the v1 block (script loaded directly) is upgraded to the loader once', () => {
  const v1 = HTML.replace('</head>', '<!-- RIPLEXA-VS-TIMESTAMP v1 --><script src="./assets/riplexa-vs-timestamp-codex.js" defer></script><!-- /RIPLEXA-VS-TIMESTAMP -->\n</head>');
  const dir = tmpCodex(v1);
  fs.writeFileSync(codex.htmlFile(dir) + codex.BACKUP_SUFFIX, HTML);
  assert.equal(codex.status(dir), 'outdated');
  assert.equal(codex.apply(dir, {}).changed, true);
  const out = fs.readFileSync(codex.htmlFile(dir), 'utf8');
  assert.equal(out.split('RIPLEXA-VS-TIMESTAMP v').length - 1, 1);
  assert.ok(out.includes(codex.BLOCK));
  codex.restore(dir);
  assert.equal(fs.readFileSync(codex.htmlFile(dir), 'utf8'), HTML);
});

test('the loader loads the main script once, and again only when its version changes', () => {
  const appended = [], images = [], intervals = [];
  const ctx = {
    window: {}, Date, String,
    document: {
      currentScript: { src: 'https://x/webview/assets/riplexa-vs-timestamp-codex-loader.js' },
      createElement: (t) => ({ tagName: t.toUpperCase() }),
      head: { appendChild(n) { n.parentNode = this; appended.push(n); }, removeChild(n) { n.parentNode = null; } },
    },
    Image: function () { images.push(this); }, setInterval: (f) => intervals.push(f),
  };
  vm.createContext(ctx);
  vm.runInContext(codex.LOADER, ctx);
  images[0].naturalWidth = 3; images[0].onload();
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, 'https://x/webview/assets/riplexa-vs-timestamp-codex.js?v=3');
  appended[0].onload();
  intervals[0](); images[1].naturalWidth = 3; images[1].onload();
  assert.equal(appended.length, 1, 'same version: nothing reloaded');
  intervals[0](); images[2].naturalWidth = 4; images[2].onload();
  assert.equal(appended.length, 2);
  assert.match(appended[1].src, /\?v=4$/);
  appended[1].onload();
  assert.equal(appended[0].parentNode, null, 'the previous script tag is removed');
  vm.runInContext(codex.LOADER, ctx);
  assert.equal(images.length, 3, 'a second loader copy does nothing');
});

test('the real Codex index.html on this machine is supported (when installed)', (t) => {
  const root = path.join(os.homedir(), '.vscode', 'extensions');
  const dirs = codex.findInstalls(root);
  if (!dirs.length) { t.skip('Codex not installed here'); return; }
  for (const d of dirs) {
    const f = codex.htmlFile(d);
    if (!fs.existsSync(f)) continue;
    const original = fs.existsSync(f + codex.BACKUP_SUFFIX) ? fs.readFileSync(f + codex.BACKUP_SUFFIX, 'utf8') : fs.readFileSync(f, 'utf8');
    const r = codex.injectHtml(original);
    assert.equal(r.error, undefined, `${path.basename(d)}: ${r.error}`);
  }
});

// ── the in-panel script on a simulated React fiber tree ─────────────────────────────────────────────────────────
const txt = (v) => ({ nodeType: 3, nodeValue: v });
function el(tag, cls, kids = []) {
  const e = {
    nodeType: 1, tagName: tag, className: cls || '', _a: {}, childNodes: kids, parentElement: null,
    get children() { return this.childNodes.filter((n) => n.nodeType === 1); },
    get textContent() { return this.childNodes.map((n) => (n.nodeType === 3 ? n.nodeValue : n.textContent)).join(''); },
    set textContent(v) { this.childNodes = [txt(String(v))]; },
    get previousElementSibling() { const p = this.parentElement; if (!p) return null; const s = p.children; const i = s.indexOf(this); return i > 0 ? s[i - 1] : null; },
    setAttribute(k, v) { this._a[k] = v; }, getAttribute(k) { return this._a[k]; },
    hasAttribute(k) { return k in this._a; }, removeAttribute(k) { delete this._a[k]; },
    appendChild(c) { c.parentElement = this; c.parentNode = this; this.childNodes.push(c); },
    removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); c.parentElement = null; c.parentNode = null; },
  };
  for (const k of kids) if (k.nodeType === 1) k.parentElement = e;
  return e;
}
// fiber(props, host?) -> a component fiber whose first host descendant is `host`
function chain(list) {
  const root = { memoizedProps: null, child: null, sibling: null, return: null };
  let prev = null;
  for (const [props, host] of list) {
    const hostFiber = { memoizedProps: {}, stateNode: host, child: null, sibling: null, return: null };
    const comp = { memoizedProps: props, stateNode: null, child: hostFiber, sibling: null, return: root };
    hostFiber.return = comp;
    if (prev) prev.sibling = comp; else root.child = comp;
    prev = comp;
  }
  return root;
}
const today = (h, m, s) => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), h, m, s).getTime(); };
const ts = (e) => e._a['data-riplexa-ts'] || null;

function runCodex(fiberRoot, cssVars = {}) {
  const container = el('div', '');
  container['__reactContainer$abc'] = fiberRoot;
  const body = el('body', '', [container]);
  const headKids = [];
  const ctx = {
    window: {}, Date, Map, Set, Math, Array, String, Object, isFinite, console,
    document: {
      currentScript: { src: 'https://file+.vscode-resource.vscode-cdn.net/c%3A/ext/openai.chatgpt/webview/assets/riplexa-vs-timestamp-codex.js' },
      getElementById: (id) => (id === 'root' ? container : null),
      body, documentElement: {},
      head: { appendChild(n) { n.parentNode = this; headKids.push(n); }, removeChild(n) { n.parentNode = null; } },
      createElement: (tag) => Object.assign(el(tag.toUpperCase(), ''), { tagName: tag.toUpperCase() }),
    },
    getComputedStyle: () => ({ getPropertyValue: (k) => cssVars[k] || '' }),
    Image: function () {},
    MutationObserver: function (cb) { ctx.onMutation = cb; ctx.observers = (ctx.observers || 0) + 1; this.observe = () => {}; this.disconnect = () => { ctx.disconnected = (ctx.disconnected || 0) + 1; }; },
    requestAnimationFrame: (f) => f(), setTimeout: (f) => f(), setInterval: () => 1, clearInterval: () => { ctx.cleared = (ctx.cleared || 0) + 1; },
  };
  vm.createContext(ctx);
  vm.runInContext(codex.SCRIPT, ctx);
  return { ctx, body, headKids };
}

test('Codex: user message, assistant message, a command start→end and "Worked for" all get their real time', () => {
  const userText = el('p', '', [txt('מה מצבך?')]);
  const userHost = el('div', 'group', [el('div', 'bubble', [userText])]);
  const assistantText = el('p', '', [txt('The data, tags and reports are saved.')]);
  const actionRow = el('div', 'turn-action-controls', [el('button', '', [txt('Copy')])]);
  const turn = el('div', 'turn', [el('div', 'md', [assistantText]), actionRow]);
  const cmdLabel = el('span', '', [txt('Ran a command')]);
  const cmdHost = el('div', 'exec', [el('svg', ''), cmdLabel]);
  const workedLabel = el('span', '', [txt('Worked for 26s')]);
  const workedHost = el('div', '', [workedLabel]);
  const pendingLabel = el('span', '', [txt('Running')]);
  const pendingHost = el('div', '', [pendingLabel]);
  const noTimeHost = el('div', '', [el('span', '', [txt('no time here')])]);
  const root = chain([
    [{ message: { id: 1 }, sentAtMs: today(22, 17, 4), messageContent: 'x', onEditMessage() {} }, userHost],
    [{ sentAtMs: today(22, 17, 30), turnId: 't1', copyText: 'x' }, actionRow],
    [{ item: { type: 'exec', startedAtMs: today(22, 17, 10), completedAtMs: today(22, 17, 12) } }, cmdHost],
    [{ startedAtMs: today(22, 17, 4), completedAtMs: today(22, 17, 30), status: 'completed' }, workedHost],
    [{ item: { type: 'exec', startedAtMs: today(22, 17, 20) } }, pendingHost],
    [{ item: { type: 'reasoning' } }, noTimeHost],
  ]);
  void turn;
  runCodex(root);
  assert.equal(ts(userText), '22:17:04');
  assert.equal(userHost._a['data-riplexa-user'], '1', 'marked for the user color');
  assert.equal(ts(assistantText), '22:17:30', 'the assistant time goes on its text, not the hidden hover row');
  assert.equal(ts(cmdLabel), '22:17:10→22:17:12');
  assert.equal(ts(workedLabel), '22:17:04→22:17:30');
  assert.equal(ts(pendingLabel), '22:17:20', 'still running: start only');
  assert.equal(ts(noTimeHost.children[0]), null, 'no real time, no mark');
});

test('Codex: Off clears marks live; the diagnostics box appears only when asked and reports what was found', () => {
  const t1 = el('p', '', [txt('hello')]);
  const host = el('div', '', [t1]);
  const root = chain([[{ message: {}, sentAtMs: today(9, 0, 1), messageContent: 'hello' }, host]]);
  const vars = {};
  const { ctx, body } = runCodex(root, vars);
  assert.equal(ts(t1), '09:00:01');
  assert.equal(body.children.length, 1, 'no diagnostics box by default');
  vars['--riplexa-ts-debug'] = '1';
  ctx.onMutation();
  const box = body.children[1];
  assert.ok(box, 'diagnostics box shown');
  assert.match(box.textContent, /react root: found/);
  assert.match(box.textContent, /user: 1/);
  vars['--riplexa-ts-on'] = '0';
  ctx.onMutation();
  assert.equal(ts(t1), null);
  vars['--riplexa-ts-debug'] = '0';
  ctx.onMutation();
  assert.equal(body.children.length, 1, 'diagnostics box removed live');
});

test('Codex: intermediate assistant messages get their time when Codex kept one, and are counted when it did not', () => {
  const said = el('p', '', [txt('Finished loading in 25 seconds.')]);
  const unsaid = el('p', '', [txt('An older reply with no recorded time.')]);
  const root = chain([
    [{ item: { type: 'assistant-message', sentAtMs: today(22, 20, 5), phase: 'commentary' } }, el('div', 'md', [said])],
    [{ item: { type: 'assistant-message', sentAtMs: null, phase: 'commentary' } }, el('div', 'md', [unsaid])],
  ]);
  const vars = { '--riplexa-ts-debug': '1' };
  const { body } = runCodex(root, vars);
  assert.equal(ts(said), '22:20:05');
  assert.equal(ts(unsaid), null, 'no recorded time, no mark');
  const box = body.children[body.children.length - 1];
  assert.match(box.textContent, /timed items: assistant-message:1/);
  assert.match(box.textContent, /no time in data: assistant-message:1/);
});

test('Codex: a collapsed "Ran commands" group shows the first start and the last end of its commands', () => {
  const header = el('span', '', [txt('Ran commands')]);
  const openHeader = el('span', '', [txt('Running commands')]);
  const units = [
    { kind: 'commands', item: { type: 'exec', startedAtMs: today(22, 24, 0), completedAtMs: today(22, 24, 1) } },
    { kind: 'commands', items: [{ type: 'exec', startedAtMs: today(22, 23, 50), completedAtMs: today(22, 23, 58) }] },
  ];
  const openUnits = [{ item: { type: 'exec', startedAtMs: today(22, 25, 0), completedAtMs: today(22, 25, 2) } }, { item: { type: 'exec', startedAtMs: today(22, 25, 3) } }];
  const root = chain([
    [{ units, completedHeader: { summaryParts: [] } }, el('div', 'group', [header])],
    [{ units: openUnits, completedHeader: undefined }, el('div', 'group', [openHeader])],
  ]);
  runCodex(root);
  assert.equal(ts(header), '22:23:50→22:24:01');
  assert.equal(ts(openHeader), '22:25:00', 'a command still running: the group shows its start only');
});

test('Codex: a newer main script takes over cleanly — the old one stops its observer and timer', () => {
  const t1 = el('p', '', [txt('hello')]);
  const root = chain([[{ message: {}, sentAtMs: today(8, 1, 2), messageContent: 'hello' }, el('div', '', [t1])]]);
  const { ctx } = runCodex(root);
  assert.equal(ts(t1), '08:01:02');
  vm.runInContext(codex.SCRIPT, ctx);
  assert.equal(ctx.observers, 2);
  assert.equal(ctx.disconnected, 1, 'previous observer disconnected');
  assert.equal(ctx.cleared, 1, 'previous timer cleared');
  assert.equal(ts(t1), '08:01:02', 'the new instance marks again');
});

test('Codex: no React root is reported, not guessed', () => {
  const { ctx, body } = runCodex(null, { '--riplexa-ts-debug': '1' });
  void ctx;
  assert.match(body.children[body.children.length - 1].textContent, /react root: NOT FOUND/);
});
