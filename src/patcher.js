'use strict';
/*
 * Riplexa Timestamps — the Claude Code panel patcher.
 *
 * Claude Code's VS Code panel is a webview bundled as webview/index.js inside the Claude Code extension. It shows no
 * times at all, although every message it receives from the CLI carries the transcript's ISO `timestamp`. This module
 * makes a small, marker-guarded, reversible change to that file:
 *
 *   Edit A  The webview builds each chat message from the CLI message but drops `timestamp`, so the message falls
 *           back to Date.now() when it is built — reopened history would read "now". Edit A passes the real time.
 *   Edit B  When a tool result arrives, record that message's real time on the tool row, so a tool call can show
 *           when it started and when its result came back.
 *   Script  Appended at the end: reads those times from React props and marks the first text line of the user's
 *           message, of every assistant row, and of every tool call ("start→result"). It adds no DOM children to
 *           React-owned nodes. A row whose real time it cannot read shows nothing: never a guessed time.
 *
 * LIVE SETTINGS, NO RELOAD. How the marks look — on or off, and the user's message color — is not baked into the
 * script. It lives in a stylesheet next to the panel (webview/riplexa-vs-timestamp.css) that the extension rewrites
 * when a setting changes. The panel's security policy allows stylesheets and images from its own folder, so the
 * script polls a one-pixel SVG whose WIDTH is a revision number, and reloads the stylesheet only when that number
 * changes. Only installing or upgrading the patch itself needs the panel to reload.
 *
 * Minified identifiers change between Claude Code builds, so each edit matches a code SHAPE and must match exactly
 * once; otherwise nothing is written. The untouched original is kept beside the file and restored on Remove or
 * uninstall.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const VERSION = 2;
const MARK = `/* RIPLEXA-VS-TIMESTAMP v${VERSION} */`;
const ANY_MARK = '/* RIPLEXA-VS-TIMESTAMP v';
const BACKUP_SUFFIX = '.riplexa-vs-timestamp.bak';
const live = require('./live');
const { LIVE_CSS, LIVE_REV, ATTR, POLL_MS, STAMP_CSS, safeColor } = live;
const liveCss = (opts = {}) => live.liveCss({ ...opts, userSelector: '[class*="userMessage_"]' });

const SCRIPT = `
${MARK}
;(function(){try{
  if (window.__riplexaVsTimestamp) return; window.__riplexaVsTimestamp = true;
  var USER = '[class*="userMessage_"]', ASSIST = '[data-testid="assistant-message"]', ATTR = ${JSON.stringify(ATTR)};
  var head = document.head || document.documentElement;

  // ── live settings: stylesheet + revision probe from the panel's own folder ──
  var fallback = null, sheet = null, loadedOnce = false, lastRev = -1;
  var base = (function(){
    var l = document.querySelector('link[rel="stylesheet"][href*="index.css"]');
    return l ? String(l.href).replace(/index\\.css([?#].*)?$/, '') : null;
  })();
  var useFallback = function(){
    if (fallback || loadedOnce) return;
    fallback = document.createElement('style');
    fallback.textContent = ${JSON.stringify(STAMP_CSS)};
    head.appendChild(fallback);
  };
  var reloadCss = function(){
    if (!base) { useFallback(); return; }
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = base + ${JSON.stringify(LIVE_CSS)} + '?t=' + Date.now();
    l.onload = function(){
      if (sheet && sheet !== l && sheet.parentNode) sheet.parentNode.removeChild(sheet);
      sheet = l; loadedOnce = true;
      if (fallback && fallback.parentNode) { fallback.parentNode.removeChild(fallback); fallback = null; }
      schedule();
    };
    l.onerror = function(){ if (l.parentNode) l.parentNode.removeChild(l); useFallback(); schedule(); };
    head.appendChild(l);
  };
  var probe = function(){
    if (!base) return;
    var img = new Image();
    img.onload = function(){ var w = img.naturalWidth; if (w !== lastRev) { var first = lastRev === -1; lastRev = w; if (!first) reloadCss(); } };
    img.src = base + ${JSON.stringify(LIVE_REV)} + '?t=' + Date.now();
  };
  var isOn = function(){
    try {
      var v = String(getComputedStyle(document.documentElement).getPropertyValue('--riplexa-ts-on') || '').trim();
      return v !== '0';
    } catch (e) { return true; }
  };

  // ── marks ──
  var p2 = function(n){ return (n < 10 ? '0' : '') + n; };
  var fmt = function(ms){
    if (typeof ms !== 'number' || !isFinite(ms)) return '';
    var d = new Date(ms), now = new Date(), t = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    return d.toDateString() === now.toDateString() ? t : p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + ' ' + t;
  };
  var fiber = function(el){ for (var k in el) if (k.indexOf('__reactFiber$') === 0) return el[k]; return null; };
  var ctxOf = function(el){
    var out = { block: null, message: null };
    for (var f = fiber(el), i = 0; f && i < 40 && !out.message; f = f.return, i++) {
      var pr = f.memoizedProps;
      if (!pr || typeof pr !== 'object') continue;
      if (!out.block && pr.content && typeof pr.content === 'object' && pr.content.content) out.block = pr.content;
      if (pr.message && typeof pr.message.timestamp === 'number') out.message = pr.message;
    }
    return out;
  };
  var SKIP = /visuallyHidden|screenReader|attachment/i;
  var textLineOf = function(root){
    var stack = [root], seen = 0;
    while (stack.length && seen++ < 400) {
      var e = stack.shift();
      if (e !== root && (SKIP.test(String(e.className || '')) || /^(SCRIPT|STYLE|SVG|TEXTAREA)$/i.test(e.tagName || ''))) continue;
      var kids = e.childNodes || [];
      for (var i = 0; i < kids.length; i++) if (kids[i].nodeType === 3 && String(kids[i].nodeValue || '').trim() !== '') return e;
      stack = Array.prototype.slice.call(e.children || []).concat(stack);
    }
    return null;
  };
  var marked = new Set(), nextMarked = new Set();
  var set = function(el, v){
    if (!v) return;
    var target = textLineOf(el) || el;
    nextMarked.add(target);
    if (target.getAttribute(ATTR) !== v) target.setAttribute(ATTR, v);
  };
  var sweep = function(){
    marked.forEach(function(el){ if (!nextMarked.has(el) && el.hasAttribute && el.hasAttribute(ATTR)) el.removeAttribute(ATTR); });
    marked = nextMarked; nextMarked = new Set();
  };
  var stamp = function(){
    if (!isOn()) { sweep(); return; }
    var bubbles = document.querySelectorAll(USER), groups = new Map();
    for (var i = 0; i < bubbles.length; i++) {
      var b = bubbles[i], c = ctxOf(b);
      if (!c.message) continue;
      var g = groups.get(c.message); if (!g) { g = []; groups.set(c.message, g); }
      g.push(b);
    }
    groups.forEach(function(list, m){
      var pick = list.find(function(x){ return (x.textContent || '').trim() !== ''; }) || list[0];
      set(pick, fmt(m.timestamp));
    });
    var msgs = document.querySelectorAll(ASSIST);
    for (var j = 0; j < msgs.length; j++) {
      var rows = msgs[j].children;
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r], cx = ctxOf(row), v = '';
        if (cx.block && cx.message && cx.message.uuid) {
          v = fmt(cx.message.timestamp);
          var t = cx.block.content && cx.block.content.type;
          if (v && (t === 'tool_use' || t === 'server_tool_use') && typeof cx.block.riplexaTsResult === 'number') v += '\\u2192' + fmt(cx.block.riplexaTsResult).replace(/^\\d\\d\\/\\d\\d /, '');
        }
        set(row, v);
      }
    }
    sweep();
  };
  var queued = false, last = 0;
  var run = function(){ queued = false; last = Date.now(); try { stamp(); } catch (e) {} };
  var schedule = function(){
    if (queued) return; queued = true;
    setTimeout(function(){ requestAnimationFrame(run); }, Math.max(0, 250 - (Date.now() - last)));
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  reloadCss();
  probe();
  setInterval(probe, ${POLL_MS});
  run();
}catch(e){}})();
`;

const EDITS = [
  {
    name: 'message builder',
    re: /return new ([\w$]+)\(([\w$]+)\.type,([\w$]+),\{uuid:\2\.uuid,foldedIntoTurn:/g,
    to: (m, cls, msg, content) => `return new ${cls}(${msg}.type,${content},{uuid:${msg}.uuid,timestamp:(typeof ${msg}.timestamp==="string"&&Date.parse(${msg}.timestamp))||void 0,foldedIntoTurn:`,
  },
  {
    name: 'tool result',
    re: /for\(let ([\w$]+) of ([\w$]+)\.message\.content\)if\(\1\.type==="tool_result"\)\{let ([\w$]+)=([\w$]+)\(([\w$]+),\1\.tool_use_id\);if\(\3\)\3\.setToolResult\(\1\)\}/g,
    to: (m, item, msg, row, find, sess) => `for(let ${item} of ${msg}.message.content)if(${item}.type==="tool_result"){let ${row}=${find}(${sess},${item}.tool_use_id);if(${row}){${row}.setToolResult(${item});${row}.riplexaTsResult=(typeof ${msg}.timestamp==="string"&&Date.parse(${msg}.timestamp))||void 0}}`,
  },
];

/** Pure transform. Returns { out } or { error }. Never partially applies. */
function patchSource(src) {
  if (src.includes(ANY_MARK)) return { error: 'already patched' };
  let out = src;
  for (const e of EDITS) {
    const hits = out.match(e.re) || [];
    if (hits.length !== 1) return { error: `"${e.name}" matched ${hits.length} times (expected 1) - this Claude Code build is not supported yet` };
    out = out.replace(e.re, e.to);
  }
  out = out + '\n' + SCRIPT;
  try { new vm.Script(out, { filename: 'index.js' }); }
  catch (err) { return { error: `patched code does not parse: ${err.message}` }; }
  return { out };
}

function webviewFile(claudeExtensionPath) { return path.join(claudeExtensionPath, 'webview', 'index.js'); }
function liveFiles(claudeExtensionPath) {
  const dir = path.join(claudeExtensionPath, 'webview');
  return { css: path.join(dir, LIVE_CSS), rev: path.join(dir, LIVE_REV) };
}

/** State of one Claude Code install: 'patched' (this version), 'outdated' (another version of this patch), 'clean', 'missing'. */
function status(claudeExtensionPath) {
  const file = webviewFile(claudeExtensionPath);
  if (!fs.existsSync(file)) return 'missing';
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(MARK)) return 'patched';
  if (src.includes(ANY_MARK)) return 'outdated';
  return 'clean';
}

function writeAtomic(file, text) {
  const tmp = file + '.riplexa-vs-timestamp.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Write the live settings. Bumps the revision only when the stylesheet actually changed. Returns true if changed. */
function writeLive(claudeExtensionPath, opts = {}) {
  return live.writeLive(path.join(claudeExtensionPath, 'webview'), { ...opts, userSelector: '[class*="userMessage_"]' });
}

/** Apply (or upgrade) the patch and write the live settings. Returns { changed, liveChanged, message }. */
function apply(claudeExtensionPath, opts = {}) {
  const file = webviewFile(claudeExtensionPath);
  const backup = file + BACKUP_SUFFIX;
  const state = status(claudeExtensionPath);
  if (state === 'missing') return { changed: false, liveChanged: false, message: `Claude Code webview not found at ${file}` };
  let changed = false, message = 'already patched';
  if (state !== 'patched') {
    let original;
    if (state === 'outdated') {
      if (!fs.existsSync(backup)) return { changed: false, liveChanged: false, message: 'an older patch is present but its backup is missing; reinstall Claude Code' };
      original = fs.readFileSync(backup, 'utf8');
    } else {
      original = fs.readFileSync(file, 'utf8');
    }
    const r = patchSource(original);
    if (r.error) return { changed: false, liveChanged: false, message: r.error };
    if (state === 'clean') fs.writeFileSync(backup, original);
    writeAtomic(file, r.out);
    changed = true; message = 'patched';
  }
  const liveChanged = writeLive(claudeExtensionPath, opts);
  return { changed, liveChanged, message };
}

/** Put the original back and remove the backup and the live files. Returns { changed, message }. */
function restore(claudeExtensionPath) {
  const file = webviewFile(claudeExtensionPath);
  const backup = file + BACKUP_SUFFIX;
  const { css, rev } = liveFiles(claudeExtensionPath);
  for (const f of [css, rev]) { try { fs.unlinkSync(f); } catch (_) {} }
  if (!fs.existsSync(backup)) return { changed: false, message: 'nothing to restore' };
  const original = fs.readFileSync(backup, 'utf8');
  if (original.includes(ANY_MARK)) return { changed: false, message: 'backup is itself patched; not restored' };
  writeAtomic(file, original);
  fs.unlinkSync(backup);
  return { changed: true, message: 'restored' };
}

/** Every Claude Code install under an extensions directory (all versions, VS Code-compatible editors alike). */
function findInstalls(extensionsDir) {
  let names = [];
  try { names = fs.readdirSync(extensionsDir); } catch (_) { return []; }
  return names.filter((n) => n.toLowerCase().startsWith('anthropic.claude-code-')).map((n) => path.join(extensionsDir, n));
}

module.exports = {
  id: 'anthropic.claude-code', name: 'Claude Code',
  VERSION, MARK, ANY_MARK, BACKUP_SUFFIX, LIVE_CSS, LIVE_REV, ATTR, STAMP_CSS, SCRIPT, EDITS,
  safeColor, liveCss, patchSource, status, writeLive, apply, restore, findInstalls, webviewFile, liveFiles,
};
