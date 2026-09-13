'use strict';
/*
 * Live settings shared by every panel adapter: a stylesheet and a one-pixel revision SVG written next to the panel.
 * The in-panel script polls the SVG (its WIDTH is the revision number) and reloads the stylesheet only when it
 * changes, so On/Off, colors and the diagnostics overlay change without reloading the panel.
 */
const fs = require('fs');
const path = require('path');

const ATTR = 'data-riplexa-ts';
const LIVE_CSS = 'riplexa-vs-timestamp.css';
const LIVE_REV = 'riplexa-vs-timestamp.rev.svg';
const POLL_MS = 1500;

const STAMP_CSS = `[${ATTR}]::before{content:attr(${ATTR});display:inline-block;margin-inline-end:.7em;`
  + 'unicode-bidi:isolate;vertical-align:baseline;font-family:var(--vscode-editor-font-family,monospace);'
  + 'font-size:.8em;font-weight:normal;font-style:normal;opacity:.6;white-space:nowrap;}';

/** A CSS color the user typed, or '' when it is not a plain color (nothing else may reach the stylesheet). */
function safeColor(value) {
  const v = String(value || '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(v) || /^[a-zA-Z]{3,30}$/.test(v) || /^(rgb|rgba|hsl|hsla)\([0-9.,%\s/deg]+\)$/.test(v)) return v;
  return '';
}

/** The live stylesheet. `userSelector` is how this panel marks the user's messages. */
function liveCss(opts = {}) {
  const on = opts.enabled !== false;
  const color = safeColor(opts.userColor);
  const sel = opts.userSelector || '[class*="userMessage_"]';
  let css = `/* Riplexa VS Timestamp live settings - written by the extension */\n:root{--riplexa-ts-on:${on ? 1 : 0};--riplexa-ts-debug:${opts.debug ? 1 : 0};}\n`;
  if (on) css += STAMP_CSS + '\n';
  if (color) css += `${sel},${sel} *{color:${color} !important;}\n`;
  return css;
}

function writeAtomic(file, text) {
  const tmp = file + '.riplexa-vs-timestamp.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Write the live files into `dir`. Bumps the revision only when the stylesheet changed. Returns true if changed. */
function writeLive(dir, opts = {}) {
  if (!fs.existsSync(dir)) return false;
  const css = path.join(dir, LIVE_CSS), rev = path.join(dir, LIVE_REV);
  const next = liveCss(opts);
  let current = null;
  try { current = fs.readFileSync(css, 'utf8'); } catch (_) {}
  if (current === next && fs.existsSync(rev)) return false;
  let n = 0;
  try { n = Number((fs.readFileSync(rev, 'utf8').match(/width="(\d+)"/) || [])[1]) || 0; } catch (_) {}
  n = (n % 60000) + 1;
  writeAtomic(css, next);
  writeAtomic(rev, `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="1"></svg>`);
  return true;
}

function removeLive(dir) {
  for (const f of [LIVE_CSS, LIVE_REV]) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} }
}

/*
 * In-page runtime, as source text, for scripts that define `ATTR` and `base` (the URL of the folder holding the live
 * files) before it and `stamp()` after it. Provides: fmt, textLineOf, set/sweep (marks), markUser, isOn, isDebug,
 * schedule, start.
 */
function pageRuntime() {
  return `
  var head = document.head || document.documentElement;
  var fallback = null, sheet = null, loadedOnce = false, lastRev = -1;
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
  var cssVar = function(name){
    try { return String(getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim(); } catch (e) { return ''; }
  };
  var isOn = function(){ return cssVar('--riplexa-ts-on') !== '0'; };
  var isDebug = function(){ return cssVar('--riplexa-ts-debug') === '1'; };
  var p2 = function(n){ return (n < 10 ? '0' : '') + n; };
  var fmt = function(ms){
    if (typeof ms !== 'number' || !isFinite(ms)) return '';
    var d = new Date(ms), now = new Date(), t = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    return d.toDateString() === now.toDateString() ? t : p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + ' ' + t;
  };
  var SKIP = /visuallyHidden|screenReader|attachment|sr-only/i;
  var textLineOf = function(root){
    var stack = [root], seen = 0;
    while (stack.length && seen++ < 400) {
      var e = stack.shift();
      if (e !== root && (SKIP.test(String(e.className || '')) || /^(SCRIPT|STYLE|SVG|TEXTAREA|BUTTON)$/i.test(e.tagName || ''))) continue;
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
    if (nextMarked.has(target)) return;
    nextMarked.add(target);
    if (target.getAttribute(ATTR) !== v) target.setAttribute(ATTR, v);
  };
  var sweep = function(){
    marked.forEach(function(el){ if (!nextMarked.has(el) && el.hasAttribute && el.hasAttribute(ATTR)) el.removeAttribute(ATTR); });
    marked = nextMarked; nextMarked = new Set();
  };
  var markUser = function(el){ if (el && el.setAttribute && !el.hasAttribute('data-riplexa-user')) el.setAttribute('data-riplexa-user', '1'); };
  var queued = false, last = 0;
  var run = function(){ queued = false; last = Date.now(); try { stamp(); } catch (e) {} };
  var schedule = function(){
    if (queued) return; queued = true;
    setTimeout(function(){ requestAnimationFrame(run); }, Math.max(0, 250 - (Date.now() - last)));
  };
  var start = function(){
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    reloadCss();
    probe();
    setInterval(probe, ${POLL_MS});
    run();
  };
`;
}

module.exports = { ATTR, LIVE_CSS, LIVE_REV, POLL_MS, STAMP_CSS, safeColor, liveCss, writeLive, removeLive, pageRuntime };
