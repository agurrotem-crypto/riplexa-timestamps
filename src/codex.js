'use strict';
/*
 * Riplexa VS Timestamp — the Codex (OpenAI ChatGPT extension) panel adapter.
 *
 * Codex builds its panel from webview/index.html on disk every time the panel opens, and its security policy allows
 * scripts, stylesheets and images from the panel's own folder. So nothing in Codex's code is edited: one marked
 * line before </head> loads a small, STABLE loader. The loader polls a one-pixel SVG whose width is the version of
 * the main script and (re)loads the main script when it changes — so a new version of this extension reaches an
 * open Codex panel with no reload. The main script reads the times Codex already keeps:
 *   • `sentAtMs` on the user message and on assistant messages (Codex shows some of them only on hover),
 *   • `startedAtMs` / `completedAtMs` (or `durationMs`) on work items: commands, file edits, tool calls, "Worked for",
 *   • the earliest start and latest end of the items inside a collapsed group ("Ran commands").
 * It finds them by walking React's fiber tree from the root and marks the first text line of the element each one
 * renders. A row without a real time gets nothing; the diagnostics box counts those too.
 *
 * Live settings (on/off, colors, diagnostics) come from the shared stylesheet mechanism (src/live.js), in
 * webview/assets/. The untouched index.html is kept beside it and restored on Remove.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const live = require('./live');

const VERSION = 2;
const OPEN = `<!-- RIPLEXA-VS-TIMESTAMP v${VERSION} -->`;
const ANY_OPEN = '<!-- RIPLEXA-VS-TIMESTAMP v';
const CLOSE = '<!-- /RIPLEXA-VS-TIMESTAMP -->';
const LOADER_FILE = 'riplexa-vs-timestamp-codex-loader.js';
const SCRIPT_FILE = 'riplexa-vs-timestamp-codex.js';
const SCRIPT_VER_FILE = 'riplexa-vs-timestamp-codex.ver.svg';
const LEGACY_FILES = ['riplexa-vs-timestamp-codex.js'];
const BACKUP_SUFFIX = '.riplexa-vs-timestamp.bak';

const BLOCK = `${OPEN}<script src="./assets/${LOADER_FILE}" defer></script>${CLOSE}`;

const LOADER = `/* Riplexa VS Timestamp — Codex loader (stable; loads the current main script) */
;(function(){try{
  if (window.__riplexaTsCodexLoader) return; window.__riplexaTsCodexLoader = true;
  var me = document.currentScript && document.currentScript.src;
  var base = me ? String(me).replace(/[^/]*([?#].*)?$/, '') : null;
  if (!base) return;
  var current = -1, tag = null;
  var load = function(rev){
    var s = document.createElement('script');
    s.src = base + ${JSON.stringify(SCRIPT_FILE)} + '?v=' + rev;
    s.onload = function(){ if (tag && tag !== s && tag.parentNode) tag.parentNode.removeChild(tag); tag = s; };
    (document.head || document.documentElement).appendChild(s);
  };
  var probe = function(){
    var img = new Image();
    img.onload = function(){ var w = img.naturalWidth; if (w !== current) { current = w; load(w); } };
    img.onerror = function(){ if (current === -1) { current = 0; load(0); } };
    img.src = base + ${JSON.stringify(SCRIPT_VER_FILE)} + '?t=' + Date.now();
  };
  probe();
  setInterval(probe, 3000);
}catch(e){}})();
`;

const SCRIPT = `/* Riplexa VS Timestamp — Codex panel script */
;(function(){try{
  var prev = window.__riplexaTsCodex; if (prev && prev.stop) { try { prev.stop(); } catch (e) {} }
  var ATTR = ${JSON.stringify(live.ATTR)};
  var me = document.currentScript && document.currentScript.src;
  var base = me ? String(me).replace(/[^/]*([?#].*)?$/, '') : null;
${live.pageRuntime()}
  var dbgEl = null;
  var removeDebug = function(){ if (dbgEl && dbgEl.parentNode) dbgEl.parentNode.removeChild(dbgEl); dbgEl = null; };
  var debug = function(lines){
    if (!isDebug()) { removeDebug(); return; }
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
    if (!t || t.start == null) return '';
    var v = fmt(t.start);
    return t.end != null && t.end >= t.start ? v + '\\u2192' + fmt(t.end).replace(/^\\d\\d\\/\\d\\d /, '') : v;
  };
  // Earliest start / latest end of every timed item inside a group's data (bounded walk, data objects only).
  var groupTimes = function(rootObj){
    var starts = [], ends = [], open = false, seen = 0, stack = [[rootObj, 0]], visited = new Set();
    while (stack.length && seen++ < 800) {
      var pair = stack.pop(), o = pair[0], d = pair[1];
      if (!o || typeof o !== 'object' || visited.has(o) || o.$$typeof || o.nodeType) continue;
      visited.add(o);
      if (typeof o.startedAtMs === 'number') { var t = itemTimes(o); starts.push(t.start); if (t.end != null) ends.push(t.end); else open = true; }
      if (d >= 5) continue;
      if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) stack.push([o[i], d + 1]); }
      else for (var k in o) { var v = o[k]; if (v && typeof v === 'object') stack.push([v, d + 1]); }
    }
    if (!starts.length) return null;
    return { start: Math.min.apply(null, starts), end: open || !ends.length ? null : Math.max.apply(null, ends) };
  };
  var stamp = function(){
    var dbg = ['Riplexa VS Timestamp (Codex) - diagnostics'];
    if (!isOn()) { sweep(); debug(dbg.concat('timestamps: off')); return; }
    var root = rootFiber();
    if (!root) { sweep(); debug(dbg.concat('react root: NOT FOUND')); return; }
    var c = { fibers: 0, user: 0, final: 0, worked: 0, groups: 0 }, items = {}, noTime = {}, samples = {};
    // Several fibers (memo/forwardRef wrappers) render the same host: count and mark each host once per kind per pass.
    var seenThisPass = new Map();
    var once = function(kind, host){
      if (!host) return false;
      var s = seenThisPass.get(host); if (!s) { s = {}; seenThisPass.set(host, s); }
      if (s[kind]) return false; s[kind] = true; return true;
    };
    var node = root.child, guard = 0;
    while (node && guard++ < 80000) {
      c.fibers++;
      var p = node.memoizedProps;
      if (p && typeof p === 'object') {
        var it = (p.item && typeof p.item === 'object' && typeof p.item.type === 'string') ? p.item
          : (p.activityItem && typeof p.activityItem === 'object' && typeof p.activityItem.type === 'string') ? p.activityItem : null;
        if (typeof p.sentAtMs === 'number' && 'message' in p && ('messageContent' in p || 'onEditMessage' in p || 'senderAccountUserId' in p)) {
          var uh = hostOf(node);
          if (uh && once('user', uh)) { c.user++; set(uh, fmt(p.sentAtMs)); markUser(uh); samples.user = samples.user || snippet(textLineOf(uh) || uh); }
        } else if (typeof p.sentAtMs === 'number' && 'turnId' in p && ('copyText' in p || 'getCopyText' in p || 'onCopyText' in p)) {
          var ah = hostOf(node), at = ah && textBefore(ah);
          if (at && once('final', at)) { c.final++; set(at, fmt(p.sentAtMs)); samples.final = samples.final || snippet(textLineOf(at) || at); }
        } else if (it && it.type === 'assistant-message') {
          var mh = hostOf(node);
          if (mh && once('am', mh)) {
            if (typeof it.sentAtMs === 'number') { items['assistant-message'] = (items['assistant-message'] || 0) + 1; set(mh, fmt(it.sentAtMs)); samples.assistant = samples.assistant || snippet(textLineOf(mh) || mh); }
            else noTime['assistant-message'] = (noTime['assistant-message'] || 0) + 1;
          }
        } else if (it) {
          var ih = hostOf(node);
          if (ih && once('item', ih)) {
            if (typeof it.startedAtMs === 'number') { items[it.type] = (items[it.type] || 0) + 1; set(ih, range(itemTimes(it))); samples['item:' + it.type] = samples['item:' + it.type] || snippet(textLineOf(ih) || ih); }
            else noTime[it.type] = (noTime[it.type] || 0) + 1;
          }
        } else if (Array.isArray(p.units) && 'completedHeader' in p) {
          var gh = hostOf(node);
          if (gh && once('group', gh)) {
            var gt = groupTimes(p.units);
            if (gt) { c.groups++; set(gh, range(gt)); samples.group = samples.group || snippet(textLineOf(gh) || gh); }
            else noTime.group = (noTime.group || 0) + 1;
          }
        } else if (typeof p.startedAtMs === 'number' && 'status' in p) {
          var wh = hostOf(node);
          if (wh && once('worked', wh)) { c.worked++; set(wh, range(itemTimes(p))); samples.worked = samples.worked || snippet(textLineOf(wh) || wh); }
        }
      }
      if (node.child) { node = node.child; continue; }
      while (node && !node.sibling) { node = node.return; if (node === root) { node = null; } }
      if (node) node = node.sibling;
    }
    sweep();
    var list = function(o){ return Object.keys(o).map(function(k){ return k + ':' + o[k]; }).join(' ') || 'none'; };
    debug(dbg.concat(
      'react root: found, fibers scanned: ' + c.fibers,
      'user: ' + c.user + '  final answers: ' + c.final + '  groups: ' + c.groups + '  worked-for: ' + c.worked,
      'timed items: ' + list(items),
      'no time in data: ' + list(noTime),
      Object.keys(samples).map(function(k){ return '  ' + k + ' -> ' + samples[k]; }).join('\\n')
    ));
  };
  window.__riplexaTsCodex = { stop: function(){ stopRuntime(); removeDebug(); } };
  start();
}catch(e){ try { console.error('[riplexa-vs-timestamp]', e); } catch (_) {} }})();
`;

function webviewDir(extPath) { return path.join(extPath, 'webview'); }
function htmlFile(extPath) { return path.join(webviewDir(extPath), 'index.html'); }
function liveDir(extPath) { return path.join(webviewDir(extPath), 'assets'); }
function loaderFile(extPath) { return path.join(liveDir(extPath), LOADER_FILE); }
function scriptFile(extPath) { return path.join(liveDir(extPath), SCRIPT_FILE); }
function scriptVerFile(extPath) { return path.join(liveDir(extPath), SCRIPT_VER_FILE); }

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

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return null; } };

/** 'patched' = the loader block and loader are current (the main script is hot-swapped separately). */
function status(extPath) {
  const f = htmlFile(extPath);
  if (!fs.existsSync(f)) return 'missing';
  const html = read(f);
  if (html.includes(BLOCK) && read(loaderFile(extPath)) === LOADER) return 'patched';
  if (html.includes(ANY_OPEN)) return 'outdated';
  return 'clean';
}

function writeAtomic(file, text) {
  const tmp = file + '.riplexa-vs-timestamp.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Write the main script and bump its version image only when it changed. Returns true if changed. */
function writeScript(extPath) {
  if (read(scriptFile(extPath)) === SCRIPT && fs.existsSync(scriptVerFile(extPath))) return false;
  let n = 0;
  const cur = read(scriptVerFile(extPath));
  if (cur) n = Number((cur.match(/width="(\d+)"/) || [])[1]) || 0;
  n = (n % 60000) + 1;
  writeAtomic(scriptFile(extPath), SCRIPT);
  writeAtomic(scriptVerFile(extPath), `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="1"></svg>`);
  return true;
}

function apply(extPath, opts = {}) {
  const f = htmlFile(extPath);
  const state = status(extPath);
  if (state === 'missing') return { changed: false, liveChanged: false, message: `Codex webview not found at ${f}` };
  for (const [name, text] of [[LOADER_FILE, LOADER], [SCRIPT_FILE, SCRIPT]]) {
    try { new vm.Script(text, { filename: name }); }
    catch (e) { return { changed: false, liveChanged: false, message: `${name} does not parse: ${e.message}` }; }
  }
  let changed = false, message = 'already patched';
  if (state !== 'patched') {
    const html = read(f);
    const r = injectHtml(html);
    if (r.error) return { changed: false, liveChanged: false, message: r.error };
    if (!fs.existsSync(f + BACKUP_SUFFIX) && !html.includes(ANY_OPEN)) fs.writeFileSync(f + BACKUP_SUFFIX, html);
    writeAtomic(loaderFile(extPath), LOADER);
    writeAtomic(f, r.out);
    changed = true; message = 'patched';
  }
  const scriptChanged = writeScript(extPath);
  const cssChanged = live.writeLive(liveDir(extPath), { ...opts, userSelector: '[data-riplexa-user]' });
  return { changed, liveChanged: scriptChanged || cssChanged, message };
}

function restore(extPath) {
  const f = htmlFile(extPath);
  live.removeLive(liveDir(extPath));
  for (const p of [loaderFile(extPath), scriptFile(extPath), scriptVerFile(extPath)]) { try { fs.unlinkSync(p); } catch (_) {} }
  const backup = f + BACKUP_SUFFIX;
  if (fs.existsSync(backup)) {
    const original = read(backup);
    if (original.includes(ANY_OPEN)) return { changed: false, message: 'backup is itself patched; not restored' };
    writeAtomic(f, original);
    fs.unlinkSync(backup);
    return { changed: true, message: 'restored' };
  }
  const html = read(f);
  if (html) {
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

module.exports = {
  id: 'openai.chatgpt', name: 'Codex', VERSION, BLOCK, LOADER, SCRIPT, LOADER_FILE, SCRIPT_FILE, SCRIPT_VER_FILE, BACKUP_SUFFIX, LEGACY_FILES,
  injectHtml, status, apply, restore, findInstalls, htmlFile, loaderFile, scriptFile, scriptVerFile, liveDir,
};
