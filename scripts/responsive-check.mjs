#!/usr/bin/env node
// Check the app at phone, tablet and desktop sizes: no horizontal overflow, with screenshots.
//
//   node scripts/responsive-check.mjs [base URL] [output dir]
//       default http://localhost:3000 and .logs/responsive
//
// Opens the signed-out pages only and never bypasses Privy (/workspace sends a guest to /login).
// Needs Playwright, which is not a dependency of this repo:
//   npx -y -p playwright node scripts/responsive-check.mjs        (set NODE_PATH to its node_modules)
// CHROME_PATH=/path/to/chrome uses a browser you already have instead of Playwright's download.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.resolve(process.argv[3] ?? '.logs/responsive');
const SIZES = [[360, 780], [768, 1024], [1440, 900]];
const PAGES = [['landing', '/'], ['workspace-signed-out', '/workspace'], ['marketplace', '/marketplace']];

const require = createRequire(`${process.cwd()}/`);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.error('Playwright not found. See the usage note at the top of this script.'); process.exit(2); }

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
let failed = 0;
for (const [width, height] of SIZES) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 768 ? 2 : 1, hasTouch: width < 1200, isMobile: width < 768 });
  for (const [name, route] of PAGES) {
    const page = await context.newPage();
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(3500);
    // The app sets overflow: hidden on body, so the page's scrollWidth alone can't show content cut off at
    // the edge. Elements past the viewport count too, unless they sit in a deliberate horizontal scroller.
    const m = await page.evaluate(() => {
      const d = document.documentElement;
      const inScroller = (e) => {
        for (let p = e.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true;
        return false;
      };
      const wide = [...document.querySelectorAll('body *')].filter((e) => {
        const r = e.getBoundingClientRect(), s = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && r.right > innerWidth + 1 && s.visibility !== 'hidden' && s.position !== 'fixed' && !inScroller(e);
      });
      return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, count: wide.length, wide: wide.slice(0, 2).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 50)} right=${Math.round(e.getBoundingClientRect().right)}`) };
    });
    const ok = m.scrollWidth <= m.clientWidth && m.count === 0;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${String(width).padEnd(4)} ${name.padEnd(22)} scrollWidth ${m.scrollWidth}/${m.clientWidth}, past the edge: ${m.count} → ${new URL(page.url()).pathname}${ok ? '' : `  ${m.wide.join(' | ')}`}`);
    await page.screenshot({ path: path.join(OUT, `${width}-${name}.png`) });
    await page.close();
  }
  await context.close();
}
await browser.close();
console.log(failed ? `${failed} failed` : 'no horizontal overflow');
process.exit(failed ? 1 : 0);
