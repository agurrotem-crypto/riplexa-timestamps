'use strict';
/*
 * Riplexa VS Timestamp — the Codex (OpenAI ChatGPT extension) panel adapter.
 *
 * Codex builds its panel from webview/index.html on disk every time the panel opens, and its security policy allows
 * scripts, stylesheets and images from the panel's own folder. So nothing in Codex's code is edited: one marked
 * block is inserted before </head> that loads our script, and the script reads the times Codex already keeps —
 *   • `sentAtMs` on the user message and on the assistant message actions (Codex shows them only on hover),
 *   • `startedAtMs` / `completedAtMs` (or `durationMs`) on work items: commands, file edits, tool calls, "Worked for".
 * It finds them by walking React's fiber tree from the root and marks the first text line of the element each one
 * renders. A row without a real time gets nothing.
 *
 * Live settings (on/off, colors, a diagnostics overlay) come from the same stylesheet + revision-image mechanism as
 * the Claude Code adapter, in webview/assets/. The untouched index.html is kept beside it and restored on Remove.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const live = require('./live');

const VERSION = 1;
const OPEN = `<!-- RIPLEXA-VS-TIMESTAMP v${VERSION} -->`;
const ANY_OPEN = '<!-- RIPLEXA-VS-TIMESTAMP v';
const CLOSE = '<!-- /RIPLEXA-VS-TIMESTAMP -->';
const SCRIPT_FILE = 'riplexa-vs-timestamp-codex.js';
const BACKUP_SUFFIX = '.riplexa-vs-timestamp.bak';

const BLOCK = `${OPEN}<script src="./assets/${SCRIPT_FILE}" defer></script>${CLOSE}`;

const SCRIPT = `/* Riplexa VS Timestamp — Codex panel script v${VERSION} */
;(function(){try{
  if (window.__riplexaVsTimestampCodex) return; window.__riplexaVsTimestampCodex = true;
  var ATTR = ${JSON.stringify(live.ATTR)}, USER_ATTR = 'data-riplexa-user';
  var me = document.currentScript && document.currentScript.src;
  var base = me ? String(me).replace(/[^/]*([?#].*)?$/, '') : null;
${live.pageRuntime()}
  var dbgEl = null;
  var debug = function(lines){
    if (!isDebug()) { if (dbgEl && dbgEl.parentNode) dbgEl.parentNode.removeChild(dbgEl); dbgEl = null; return; }
    if (!dbgEl) {
      dbgEl = document.createElement('div');
      dbgEl.setAttribute('style', 'position:fixed;left:6px;bottom:6px;z-index:2147483647;max-width:70vw;padding:6px 8px;'
        + 'background:rgba(0,0,0,.85);color:#9f9;font:11px/1.35 monospace;white-space:pre-wrap;pointer-events:none;border-radius:4px;');
      document.body.appendChild(dbgEl);
    }
    dbgEl.textContent = lines.join('\\n');
  };
  var rootFiber = function(){
    var cands = [document.getElementById('root')].concat(Array.prototype.slice.call(document.body ? document.body.children : []));
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i]; if (!c) continue;
      for (var k in c) if (k.indexOf('__reactContainer$') === 0 && c[k]) return c[k];
    }
    return null;
  };
  var hostOf = function(f){
    for (var n = f, i = 0; n && i < 60; i++) {
      if (n.stateNode && n.stateNode.nodeType === 1) return n.stateNode;
      n = n.child;
    }
    return null;
  };
  var snippet = function(el){
    if (!el) return '-';
    var cls = String(el.className || '').split(/\\s+/).slice(0, 2).join('.');
    return (el.tagName || '?') + (cls ? '.' + cls : '') + ' "' + String(el.textContent || '').trim().slice(0, 28) + '"';
  };
  var textBefore = function(el){
    for (var up = el, lvl = 0; up && lvl < 4; up = up.parentElement, lvl++) {
      for (var s = up.previousElementSibling; s; s = s.previousElementSibling) {
        if (String(s.textContent || '').trim() !== '') return s;
      }
    }
    return null;
  };
  var itemTimes = function(it){
    var start = typeof it.startedAtMs === 'number' ? it.startedAtMs : null;
    var end = typeof it.completedAtMs === 'number' ? it.completedAtMs
      : (start != null && typeof it.durationMs === 'number' ? start + it.durationMs : null);
    return { start: start, end: end };
  };
  var range = function(t){
    if (t.start == null) return '';
    var v = fmt(t.start);
    return t.end != null && t.end >= t.start ? v + '\\u2192' + fmt(t.end).replace(/^\\d\\d\\/\\d\\d /, '') : v;
  };
  var stamp = function(){
    var dbg = ['Riplexa VS Timestamp (Codex) - diagnostics'];
    if (!isOn()) { sweep(); debug(dbg.concat('timestamps: off')); return; }
    var root = rootFiber();
    if (!root) { sweep(); debug(dbg.concat('react root: NOT FOUND')); return; }
    var counts = { fibers: 0, user: 0, assistant: 0, worked: 0 }, items = {}, samples = {}, users = new Set();
    var node = root.child, guard = 0;
    while (node && guard++ < 80000) {
      counts.fibers++;
      var p = node.memoizedProps;
      if (p && typeof p === 'object') {
        if (typeof p.sentAtMs === 'number' && 'message' in p && ('messageContent' in p || 'onEditMessage' in p || 'senderAccountUserId' in p)) {
          var uh = hostOf(node);
          if (uh && !users.has(uh)) { users.add(uh); counts.user++; set(uh, fmt(p.sentAtMs)); markUser(uh); samples.user = samples.user || snippet(textLineOf(uh) || uh); }
        } else if (typeof p.sentAtMs === 'number' && 'turnId' in p && ('copyText' in p || 'getCopyText' in p || 'onCopyText' in p)) {
          var ah = hostOf(node), at = ah && textBefore(ah);
          if (at) { counts.assistant++; set(at, fmt(p.sentAtMs)); samples.assistant = samples.assistant || snippet(textLineOf(at) || at); }
        } else if (p.item && typeof p.item === 'object' && typeof p.item.type === 'string' && typeof p.item.startedAtMs === 'number') {
          var ih = hostOf(node);
          if (ih) { items[p.item.type] = (items[p.item.type] || 0) + 1; set(ih, range(itemTimes(p.item))); samples['item:' + p.item.type] = samples['item:' + p.item.type] || snippet(textLineOf(ih) || ih); }
        } else if (typeof p.startedAtMs === 'number' && 'status' in p && !('item' in p)) {
          var wh = hostOf(node);
          if (wh) { counts.worked++; set(wh, range(itemTimes(p))); samples.worked = samples.worked || snippet(textLineOf(wh) || wh); }
        }
      }
      if (node.child) { node = node.child; continue; }
      while (node && !node.sibling) { node = node.return; if (node === root) { node = null; } }
      if (node) node = node.sibling;
    }
    sweep();
    var itemText = Object.keys(items).map(function(k){ return k + ':' + items[k]; }).join(' ') || 'none';
    debug(dbg.concat(
      'react root: found, fibers scanned: ' + counts.fibers,
      'user messages: ' + counts.user + '  assistant messages: ' + counts.assistant + '  worked-for: ' + counts.worked,
      'items: ' + itemText,
      Object.keys(samples).map(function(k){ return '  ' + k + ' -> ' + samples[k]; }).join('\\n')
    ));
  };
  start();
}catch(e){ try { console.error('[riplexa-vs-timestamp]', e); } catch (_) {} }})();
`;

function webviewDir(extPath) { return path.join(extPath, 'webview'); }
function htmlFile(extPath) { return path.join(webviewDir(extPath), 'index.html'); }
function scriptFile(extPath) { return path.join(webviewDir(extPath), 'assets', SCRIPT_FILE); }
function liveDir(extPath) { return path.join(webviewDir(extPath), 'assets'); }

/** Pure: insert (or replace) our block before </head>. Returns { out } or { error }. */
function injectHtml(html) {
  if (html.includes(ANY_OPEN)) {
    const a = html.indexOf(ANY_OPEN), b = html.indexOf(CLOSE, a);
    if (b < 0) return { error: 'a damaged earlier block is present' };
    return { out: html.slice(0, a) + BLOCK + html.slice(b + CLOSE.length) };
  }
  const n = html.split('</head>').length - 1;
  if (n !== 1) return { error: `</head> found ${n} times (expected 1) - this Codex build is not supported yet` };
  return { out: html.replace('</head>', `${BLOCK}\n</head>`) };
}

function status(extPath) {
  const f = htmlFile(extPath);
  if (!fs.existsSync(f)) return 'missing';
  const html = fs.readFileSync(f, 'utf8');
  let script = null;
  try { script = fs.readFileSync(scriptFile(extPath), 'utf8'); } catch (_) {}
  if (html.includes(BLOCK) && script === SCRIPT) return 'patched';
  if (html.includes(ANY_OPEN)) return 'outdated';
  return 'clean';
}

function writeAtomic(file, text) {
  const tmp = file + '.riplexa-vs-timestamp.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function apply(extPath, opts = {}) {
  const f = htmlFile(extPath);
  const state = status(extPath);
  if (state === 'missing') return { changed: false, liveChanged: false, message: `Codex webview not found at ${f}` };
  let changed = false, message = 'already patched';
  if (state !== 'patched') {
    try { new vm.Script(SCRIPT, { filename: SCRIPT_FILE }); }
    catch (e) { return { changed: false, liveChanged: false, message: `script does not parse: ${e.message}` }; }
    const html = fs.readFileSync(f, 'utf8');
    const r = injectHtml(html);
    if (r.error) return { changed: false, liveChanged: false, message: r.error };
    if (!fs.existsSync(f + BACKUP_SUFFIX) && !html.includes(ANY_OPEN)) fs.writeFileSync(f + BACKUP_SUFFIX, html);
    writeAtomic(scriptFile(extPath), SCRIPT);
    writeAtomic(f, r.out);
    changed = true; message = 'patched';
  }
  const liveChanged = live.writeLive(liveDir(extPath), { ...opts, userSelector: '[data-riplexa-user]' });
  return { changed, liveChanged, message };
}

function restore(extPath) {
  const f = htmlFile(extPath);
  live.removeLive(liveDir(extPath));
  try { fs.unlinkSync(scriptFile(extPath)); } catch (_) {}
  const backup = f + BACKUP_SUFFIX;
  if (fs.existsSync(backup)) {
    const original = fs.readFileSync(backup, 'utf8');
    if (original.includes(ANY_OPEN)) return { changed: false, message: 'backup is itself patched; not restored' };
    writeAtomic(f, original);
    fs.unlinkSync(backup);
    return { changed: true, message: 'restored' };
  }
  if (fs.existsSync(f)) {
    const html = fs.readFileSync(f, 'utf8');
    const a = html.indexOf(ANY_OPEN), b = html.indexOf(CLOSE, a);
    if (a >= 0 && b >= 0) { writeAtomic(f, html.slice(0, a) + html.slice(b + CLOSE.length).replace(/^\n/, '')); return { changed: true, message: 'restored (block removed)' }; }
  }
  return { changed: false, message: 'nothing to restore' };
}

function findInstalls(extensionsDir) {
  let names = [];
  try { names = fs.readdirSync(extensionsDir); } catch (_) { return []; }
  return names.filter((n) => n.toLowerCase().startsWith('openai.chatgpt-')).map((n) => path.join(extensionsDir, n));
}

module.exports = { id: 'openai.chatgpt', name: 'Codex', VERSION, BLOCK, SCRIPT, SCRIPT_FILE, BACKUP_SUFFIX, injectHtml, status, apply, restore, findInstalls, htmlFile, scriptFile, liveDir };
