// Evomedia.net evo.videostroll — https://github.com/evomedia-net/evo.videostroll
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The visible cursor. A headless browser renders none, so the recording would
 * show clicks arriving from nowhere. This injects an overlay into every page
 * (an init script, so it survives navigation): a fixed-position arrow that
 * follows the real mousemove events Playwright dispatches, a ripple on
 * mousedown, and a highlight box the actions can ask for. It is DOM, so every
 * capture strategy sees it.
 */
import type { Page } from "playwright";

/** Runs in the page, before its own scripts, on every navigation. Plain ES5-ish on purpose. */
export const CURSOR_INIT_SCRIPT = `
(function () {
  if (window.__videostroll) return;
  var ARROW = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">'
    + '<path d="M2 2 L2 24 L8 18 L12 28 L16 26 L12 17 L20 17 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  var style = document.createElement('style');
  style.id = '__videostroll-style';
  style.textContent = ''
    + '#__videostroll-cursor{position:fixed;left:0;top:0;width:22px;height:30px;pointer-events:none;z-index:2147483647;'
    + 'transform:translate(-100px,-100px);will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}'
    + '#__videostroll-ripple{position:fixed;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;'
    + 'border:3px solid #ffd400;pointer-events:none;z-index:2147483646;opacity:0;transform:scale(.3)}'
    + '#__videostroll-ripple.go{animation:__vs-ripple .45s ease-out forwards}'
    + '@keyframes __vs-ripple{0%{opacity:.9;transform:scale(.3)}100%{opacity:0;transform:scale(1.6)}}'
    + '#__videostroll-hl{position:fixed;pointer-events:none;z-index:2147483645;border:3px solid #ffd400;border-radius:6px;'
    + 'box-shadow:0 0 0 4px rgba(255,212,0,.25);display:none}';
  var cursor = document.createElement('div'); cursor.id = '__videostroll-cursor'; cursor.setAttribute('aria-hidden', 'true'); cursor.innerHTML = ARROW;
  var ripple = document.createElement('div'); ripple.id = '__videostroll-ripple'; ripple.setAttribute('aria-hidden', 'true');
  var hl = document.createElement('div'); hl.id = '__videostroll-hl'; hl.setAttribute('aria-hidden', 'true');
  var x = -100, y = -100;
  function mount() {
    var root = document.body || document.documentElement;
    if (!document.getElementById('__videostroll-style')) (document.head || root).appendChild(style);
    root.appendChild(hl); root.appendChild(ripple); root.appendChild(cursor);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  function place(nx, ny) {
    x = nx; y = ny;
    cursor.style.transform = 'translate(' + (x - 2) + 'px,' + (y - 2) + 'px)';
  }
  document.addEventListener('mousemove', function (e) { place(e.clientX, e.clientY); }, true);
  document.addEventListener('mousedown', function (e) {
    ripple.style.left = e.clientX + 'px'; ripple.style.top = e.clientY + 'px';
    ripple.classList.remove('go'); void ripple.offsetWidth; ripple.classList.add('go');
  }, true);
  window.__videostroll = {
    position: function () { return { x: x, y: y }; },
    highlight: function (r) {
      hl.style.left = (r.x - 4) + 'px'; hl.style.top = (r.y - 4) + 'px';
      hl.style.width = (r.width + 8) + 'px'; hl.style.height = (r.height + 8) + 'px'; hl.style.display = 'block';
    },
    clearHighlight: function () { hl.style.display = 'none'; },
    mounted: function () { return !!cursor.parentNode; }
  };
})();
`;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Drives the mouse so the overlay has something to follow. */
export class Cursor {
  private x: number;
  private y: number;

  constructor(private readonly page: Page, startX: number, startY: number) {
    this.x = startX;
    this.y = startY;
  }

  get position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  /** Glide, don't teleport. Duration scales with distance when not given. */
  async moveTo(x: number, y: number, durationMs?: number): Promise<void> {
    const dist = Math.hypot(x - this.x, y - this.y);
    const ms = durationMs ?? Math.max(300, Math.min(900, dist * 0.9));
    const steps = Math.max(8, Math.min(60, Math.round(ms / 16)));
    const sx = this.x;
    const sy = this.y;
    const per = ms / steps;
    for (let i = 1; i <= steps; i++) {
      const t = easeInOutCubic(i / steps);
      await this.page.mouse.move(sx + (x - sx) * t, sy + (y - sy) * t);
      await sleep(per);
    }
    this.x = x;
    this.y = y;
  }

  /** Settle on the target, then press - the overlay draws the ripple on mousedown. */
  async click(settleMs = 250): Promise<void> {
    await sleep(settleMs);
    await this.page.mouse.down();
    await sleep(60);
    await this.page.mouse.up();
  }

  async highlight(rect: Rect): Promise<void> {
    await this.page.evaluate((r) => (window as any).__videostroll?.highlight(r), rect);
  }

  async clearHighlight(): Promise<void> {
    await this.page.evaluate(() => (window as any).__videostroll?.clearHighlight()).catch(() => undefined);
  }

  /** True when the overlay is in the DOM of the current document. */
  async mounted(): Promise<boolean> {
    return this.page.evaluate(() => !!(window as any).__videostroll?.mounted()).catch(() => false);
  }
}
