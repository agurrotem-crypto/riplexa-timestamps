'use strict';
/*
 * Riplexa VS Timestamp — the patcher.
 *
 * Claude Code's VS Code panel is a webview bundled as webview/index.js inside the Claude Code extension. It shows no
 * times at all, although every message it receives from the CLI carries the transcript's ISO `timestamp`. This module
 * makes a small, marker-guarded, reversible change to that file:
 *
 *   Edit A  The webview builds each chat message from the CLI message but drops `timestamp`, so the message falls
 *           back to Date.now() when it is built — reopened history would read "now". Edit A passes the real time.
 *   Edit B  When a tool result arrives, record that message's real time on the tool row, so a tool call can show
 *           when it started and when its result came back.
 *   Script  Appended at the end: reads those times from React props and shows them through a data attribute and a
 *           CSS ::before at the start of the first text line — the user's message, every assistant row, and
 *           "start→result" on tool calls. It adds no DOM children to React-owned nodes. A row whose real time it
 *           cannot read shows nothing: never a guessed time.
 *
 * Minified identifiers change between Claude Code builds, so each edit matches a code SHAPE and must match exactly
 * once; otherwise nothing is written. The untouched original is kept beside the file and restored on disable or
 * uninstall.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const VERSION = 1;
const MARK = `/* RIPLEXA-VS-TIMESTAMP v${VERSION} */`;
const ANY_MARK = '/* RIPLEXA-VS-TIMESTAMP v';
const BACKUP_SUFFIX = '.riplexa-vs-timestamp.bak';

/** A CSS color the user typed, or '' when it is not a plain color (nothing else may reach the stylesheet). */
function safeColor(value) {
  const v = String(value || '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(v) || /^[a-zA-Z]{3,30}$/.test(v) || /^(rgb|rgba|hsl|hsla)\([0-9.,%\s/deg]+\)$/.test(v)) return v;
  return '';
}

/** The in-panel script for the given options. The options are part of the text, so a changed option re-patches. */
function buildScript(opts = {}) {
  const userColor = safeColor(opts.userColor);
  const optionsCss = userColor ? `[class*="userMessage_"],[class*="userMessage_"] *{color:${userColor} !important;}` : '';
  return `
${MARK}
/* options ${JSON.stringify({ userColor })} */
;(function(){try{
  if (window.__riplexaVsTimestamp) return; window.__riplexaVsTimestamp = true;
  var USER = '[class*="userMessage_"]', ASSIST = '[data-testid="assistant-message"]', ATTR = 'data-riplexa-ts';
  var st = document.createElement('style');
  st.textContent = '[' + ATTR + ']::before{content:attr(' + ATTR + ');display:inline-block;margin-inline-end:.7em;'
    + 'unicode-bidi:isolate;vertical-align:baseline;font-family:var(--vscode-editor-font-family,monospace);'
    + 'font-size:.8em;font-weight:normal;font-style:normal;opacity:.6;white-space:nowrap;}'
    + ${JSON.stringify(optionsCss)};
  (document.head || document.documentElement).appendChild(st);
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
  new MutationObserver(function(){
    if (queued) return; queued = true;
    setTimeout(function(){ requestAnimationFrame(run); }, Math.max(0, 250 - (Date.now() - last)));
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  run();
}catch(e){}})();
`;
}
const SCRIPT = buildScript();

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
function patchSource(src, opts = {}) {
  if (src.includes(ANY_MARK)) return { error: 'already patched' };
  let out = src;
  for (const e of EDITS) {
    const hits = out.match(e.re) || [];
    if (hits.length !== 1) return { error: `"${e.name}" matched ${hits.length} times (expected 1) - this Claude Code build is not supported yet` };
    out = out.replace(e.re, e.to);
  }
  out = out + '\n' + buildScript(opts);
  try { new vm.Script(out, { filename: 'index.js' }); }
  catch (err) { return { error: `patched code does not parse: ${err.message}` }; }
  return { out };
}

function webviewFile(claudeExtensionPath) { return path.join(claudeExtensionPath, 'webview', 'index.js'); }

/** State of one Claude Code install: 'patched' (this version with these options), 'outdated' (another version or
 *  other options of this patch), 'clean', 'missing'. */
function status(claudeExtensionPath, opts = {}) {
  const file = webviewFile(claudeExtensionPath);
  if (!fs.existsSync(file)) return 'missing';
  const src = fs.readFileSync(file, 'utf8');
  if (src.endsWith(buildScript(opts))) return 'patched';
  if (src.includes(ANY_MARK)) return 'outdated';
  return 'clean';
}

/** Apply (or upgrade) the patch. Returns { changed, message }. Writes atomically; keeps the untouched original. */
function apply(claudeExtensionPath, opts = {}) {
  const file = webviewFile(claudeExtensionPath);
  const backup = file + BACKUP_SUFFIX;
  const state = status(claudeExtensionPath, opts);
  if (state === 'missing') return { changed: false, message: `Claude Code webview not found at ${file}` };
  if (state === 'patched') return { changed: false, message: 'already patched' };
  let original;
  if (state === 'outdated') {
    if (!fs.existsSync(backup)) return { changed: false, message: 'an older patch is present but its backup is missing; reinstall Claude Code' };
    original = fs.readFileSync(backup, 'utf8');
  } else {
    original = fs.readFileSync(file, 'utf8');
  }
  const r = patchSource(original, opts);
  if (r.error) return { changed: false, message: r.error };
  if (state === 'clean') fs.writeFileSync(backup, original);
  const tmp = file + '.riplexa-vs-timestamp.tmp';
  fs.writeFileSync(tmp, r.out);
  fs.renameSync(tmp, file);
  return { changed: true, message: 'patched' };
}

/** Put the original back and remove the backup. Returns { changed, message }. */
function restore(claudeExtensionPath) {
  const file = webviewFile(claudeExtensionPath);
  const backup = file + BACKUP_SUFFIX;
  if (!fs.existsSync(backup)) return { changed: false, message: 'nothing to restore' };
  const original = fs.readFileSync(backup, 'utf8');
  if (original.includes(ANY_MARK)) return { changed: false, message: 'backup is itself patched; not restored' };
  const tmp = file + '.riplexa-vs-timestamp.tmp';
  fs.writeFileSync(tmp, original);
  fs.renameSync(tmp, file);
  fs.unlinkSync(backup);
  return { changed: true, message: 'restored' };
}

/** Every Claude Code install under an extensions directory (all versions, VS Code-compatible editors alike). */
function findInstalls(extensionsDir) {
  let names = [];
  try { names = fs.readdirSync(extensionsDir); } catch (_) { return []; }
  return names.filter((n) => n.toLowerCase().startsWith('anthropic.claude-code-')).map((n) => path.join(extensionsDir, n));
}

module.exports = { VERSION, MARK, ANY_MARK, BACKUP_SUFFIX, SCRIPT, EDITS, safeColor, buildScript, patchSource, status, apply, restore, findInstalls, webviewFile };
