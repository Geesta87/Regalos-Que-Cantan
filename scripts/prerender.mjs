/**
 * Prerender script for SEO pages.
 *
 * After `vite build`, this script:
 *  1. Starts a local static server from dist/
 *  2. Launches Puppeteer (headless Chromium)
 *  3. Visits each SEO route, waits for React to render
 *  4. Saves the fully-rendered HTML to dist/ so crawlers get real content
 *
 * Usage:  node scripts/prerender.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { createServer } from 'http';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');
const PORT = 4173;

// ── Routes to prerender (parsed from sitemap) ──────────────────────
function getRoutesFromSitemap() {
  const sitemapPath = resolve(__dirname, '..', 'public', 'sitemap.xml');
  const xml = readFileSync(sitemapPath, 'utf-8');
  const urls = [];
  const re = /<loc>https:\/\/regalosquecantan\.com(\/[^<]*)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    urls.push(m[1]);
  }
  // Also include the root
  if (!urls.includes('/')) urls.unshift('/');
  return urls;
}

// ── Simple static file server ───────────────────────────────────────
function startServer() {
  return new Promise((res) => {
    const types = {
      html: 'text/html', js: 'application/javascript', css: 'text/css',
      json: 'application/json', png: 'image/png', jpg: 'image/jpeg',
      svg: 'image/svg+xml', ico: 'image/x-icon', woff2: 'font/woff2',
      webp: 'image/webp', mp3: 'audio/mpeg', mp4: 'video/mp4'
    };
    const server = createServer((req, resp) => {
      const urlPath = req.url.split('?')[0];
      let filePath = resolve(DIST, '.' + urlPath);

      // If path resolves to a directory, look for index.html inside it
      if (existsSync(filePath)) {
        try { if (statSync(filePath).isDirectory()) filePath = resolve(filePath, 'index.html'); } catch {}
      }

      // SPA fallback — any missing file serves index.html
      if (!existsSync(filePath)) {
        filePath = resolve(DIST, 'index.html');
      }

      const ext = filePath.split('.').pop();
      const contentType = types[ext] || 'application/octet-stream';
      try {
        const body = readFileSync(filePath);
        resp.writeHead(200, { 'Content-Type': contentType });
        resp.end(body);
      } catch {
        resp.writeHead(404, { 'Content-Type': 'text/plain' });
        resp.end('Not found');
      }
    });
    server.listen(PORT, () => res(server));
  });
}

// ── Prerender a single route ────────────────────────────────────────
async function prerenderRoute(browser, route) {
  const page = await browser.newPage();
  // Block images / media / fonts for speed
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (['image', 'media', 'font'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  // Capture console errors for debugging
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  const url = `http://localhost:${PORT}${route}`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

  // Wait for React to render and helmet to flush
  await page.waitForFunction(
    () => document.getElementById('root')?.children.length > 0,
    { timeout: 10000 }
  ).catch(() => {
    console.error(`    WARNING: root div still empty for ${route}`);
    if (errors.length) console.error(`    Errors:`, errors.join(' | '));
  });

  // Get the full rendered HTML and clean up duplicate third-party scripts
  // (Puppeteer captures dynamically-injected script elements that the
  //  inline tracking code will re-create at runtime)
  let html = await page.content();
  await page.close();

  // Remove dynamically-injected FB / Clarity script tags (keep the inline loaders)
  html = html.replace(/<script[^>]*src="https:\/\/connect\.facebook\.net\/signals\/config\/[^"]*"[^>]*><\/script>/g, '');
  html = html.replace(/<script[^>]*src="https:\/\/connect\.facebook\.net\/en_US\/fbevents\.js"[^>]*><\/script>/g, '');
  html = html.replace(/<script[^>]*src="https:\/\/scripts\.clarity\.ms\/[^"]*"[^>]*><\/script>/g, '');
  html = html.replace(/<script[^>]*src="https:\/\/www\.clarity\.ms\/tag\/[^"]*"[^>]*><\/script>/g, '');

  // Determine output path
  let outPath;
  if (route === '/') {
    outPath = resolve(DIST, 'index.html');
  } else {
    // /como-funciona  ->  dist/como-funciona/index.html
    const dir = resolve(DIST, route.substring(1));
    mkdirSync(dir, { recursive: true });
    outPath = resolve(dir, 'index.html');
  }

  writeFileSync(outPath, html, 'utf-8');
  return outPath;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const routes = getRoutesFromSitemap();
  console.log(`\n  Prerendering ${routes.length} SEO routes...\n`);

  // 1. Start server
  const server = await startServer();
  console.log(`  Static server on http://localhost:${PORT}`);

  // 2. Launch browser
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  // 3. Prerender each route
  let ok = 0;
  let fail = 0;
  for (const route of routes) {
    try {
      const out = await prerenderRoute(browser, route);
      ok++;
      console.log(`  [${ok}/${routes.length}] ${route}`);
    } catch (err) {
      fail++;
      console.error(`  FAIL ${route}: ${err.message}`);
    }
  }

  // 4. Cleanup
  await browser.close();
  server.close();

  console.log(`\n  Done! ${ok} pages prerendered${fail ? `, ${fail} failed` : ''}.\n`);
}

main().catch((err) => {
  console.error('Prerender failed:', err);
  process.exit(1);
});
