// supabase/functions/_shared/render-ad.ts
// ===========================================================================
// DESIGN LAYER — turns a text-free art-directed photo into a finished studio ad
// ===========================================================================
// We stopped letting the image model draw text (the #1 "AI slop" tell). Instead
// the model makes a clean photo and THIS module lays a real typographic design
// on top: brand fonts, scrim for legibility, logo badge, kicker, headline (with
// a gold accent word) and a CTA pill — composited as an SVG and rasterized to a
// PNG with resvg (real font rendering, runs in Deno).
//
// Fonts are hosted in our own storage (creative-studio/fonts/) so we never
// depend on an external font CDN at render time.
import { Resvg, initWasm } from 'https://esm.sh/@resvg/resvg-wasm@2.6.2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const BUCKET = Deno.env.get('CREATIVE_BUCKET') || 'creative-studio';
const FONT_BASE = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/fonts`;
const LOGO_URL = Deno.env.get('BRAND_LOGO_URL') || 'https://regalosquecantan.com/images/logo.png';

const W = 1024;
const GOLD = '#E9B872', WHITE = '#ffffff', INK = '#2A1A08';

// Read intrinsic pixel size from a PNG (IHDR) or JPEG (SOF) header so the design
// layer adapts to whatever aspect the image model produced (2:3, 4:5, 9:16…).
function imageSize(b: Uint8Array): { w: number; h: number } | null {
  try {
    if (b[0] === 0x89 && b[1] === 0x50) { // PNG
      const dv = new DataView(b.buffer, b.byteOffset);
      return { w: dv.getUint32(16), h: dv.getUint32(20) };
    }
    if (b[0] === 0xff && b[1] === 0xd8) { // JPEG
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
        }
        i += 2 + ((b[i + 2] << 8) | b[i + 3]);
      }
    }
  } catch { /* fall through */ }
  return null;
}

let _wasm: Promise<unknown> | null = null;
function ensureWasm() {
  if (!_wasm) _wasm = initWasm(fetch('https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm'));
  return _wasm;
}

const _cache = new Map<string, Uint8Array>();
async function getBytes(key: string, url: string): Promise<Uint8Array | null> {
  if (_cache.has(key)) return _cache.get(key)!;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    _cache.set(key, b);
    return b;
  } catch { return null; }
}

function b64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}
// Strip emoji / pictographs (our brand fonts have no glyphs → they render as
// tofu boxes), then XML-escape. Keeps Spanish punctuation (· … ¡ ¿ áéíóúñ).
function esc(s: string): string {
  return String(s)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{2190}-\u{21FF}]/gu, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/ {2,}/g, ' ');
}

export interface AdSpec {
  imageUrl?: string;         // text-free art-directed photo (fetched), OR…
  imageBytes?: Uint8Array;   // …pass the photo bytes directly (skips a round-trip)
  kicker?: string;           // small letterspaced line above headline
  headlineLines: string[];   // 1-3 short lines (≤ ~16 chars each)
  accent?: string;           // word inside the headline to render gold + italic
  cta?: string;              // gold pill text (elegant) / red CTA bar (poster)
  template?: string;         // 'poster' = bold red/white/black promo; else elegant
  price?: string;            // poster price badge, e.g. "$29"
}

function headlineLine(line: string, baseline: number, accent?: string): string {
  const x = 78, size = 104, fam = `font-family="Playfair Display" font-weight="500" font-size="${size}"`;
  if (accent) {
    const idx = line.toLowerCase().indexOf(accent.toLowerCase());
    if (idx >= 0) {
      const before = line.slice(0, idx), word = line.slice(idx, idx + accent.length), after = line.slice(idx + accent.length);
      return `<text x="${x}" y="${baseline}" ${fam} fill="${WHITE}">`
        + (before ? `<tspan>${esc(before)}</tspan>` : '')
        + `<tspan font-style="italic" font-weight="600" fill="${GOLD}">${esc(word)}</tspan>`
        + (after ? `<tspan>${esc(after)}</tspan>` : '')
        + `</text>`;
    }
  }
  return `<text x="${x}" y="${baseline}" ${fam} fill="${WHITE}">${esc(line)}</text>`;
}

function buildSvg(photoDataUri: string, logoDataUri: string | null, spec: AdSpec, H: number): string {
  const lines = (spec.headlineLines || []).slice(0, 3);
  const N = Math.max(lines.length, 1);
  const step = 110, ctaH = 86, ctaText = spec.cta || '';
  // Anchor the whole text block from the bottom so it works at any height.
  const bottomPad = Math.round(H * 0.052);
  const ctaTop = ctaText ? H - bottomPad - ctaH : H - bottomPad;
  const headBottom = (ctaText ? ctaTop - 46 : H - bottomPad);
  const baselines = lines.map((_, i) => headBottom - (N - 1 - i) * step);
  const topBaseline = baselines[0] ?? headBottom;
  const kickerBaseline = topBaseline - 96;
  const ctaW = Math.min(880, Math.round(ctaText.length * 31 * 0.56) + 72);

  const logoSvg = logoDataUri
    ? `<circle cx="116" cy="116" r="62" fill="${WHITE}"/><image x="74" y="74" width="84" height="84" preserveAspectRatio="xMidYMid meet" href="${logoDataUri}"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<linearGradient id="sb" x1="0" y1="1" x2="0" y2="0">
<stop offset="0" stop-color="#140E08" stop-opacity="0.94"/>
<stop offset="0.22" stop-color="#140E08" stop-opacity="0.72"/>
<stop offset="0.54" stop-color="#140E08" stop-opacity="0"/>
</linearGradient>
<linearGradient id="st" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#140E08" stop-opacity="0.5"/>
<stop offset="1" stop-color="#140E08" stop-opacity="0"/>
</linearGradient>
</defs>
<image x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" href="${photoDataUri}"/>
<rect width="${W}" height="${H}" fill="url(#sb)"/>
<rect width="${W}" height="${Math.round(H * 0.23)}" fill="url(#st)"/>
${logoSvg}
${spec.kicker ? `<text x="78" y="${kickerBaseline}" font-family="Montserrat" font-weight="700" font-size="28" letter-spacing="6" fill="${GOLD}">${esc(spec.kicker.toUpperCase())}</text>` : ''}
${lines.map((l, i) => headlineLine(l, baselines[i], spec.accent)).join('\n')}
${ctaText ? `<rect x="78" y="${ctaTop}" rx="43" ry="43" width="${ctaW}" height="${ctaH}" fill="${GOLD}"/><text x="${78 + 36}" y="${ctaTop + 56}" font-family="Montserrat" font-weight="700" font-size="31" fill="${INK}">${esc(ctaText)}</text>` : ''}
</svg>`;
}

// ---------------------------------------------------------------------------
// POSTER template — bold red/white/black promo style (matches the high-converting
// "Día de los Padres" ad): black bg, B&W photo, heavy uppercase headline, a red
// highlight bar, a red price badge, hearts, and a red CTA bar.
// ---------------------------------------------------------------------------
const RED = '#E11D2A', BLACK = '#0A0A0A';
function heart(cx: number, cy: number, s: number, fill = RED): string {
  return `<path transform="translate(${cx} ${cy}) scale(${s})" d="M0 4 C0 -2 -8 -2 -8 4 C-8 9 0 13 0 16 C0 13 8 9 8 4 C8 -2 0 -2 0 4 Z" fill="${fill}"/>`;
}
function buildPosterSvg(photoUri: string, logoUri: string | null, spec: AdSpec, H: number): string {
  const lines = (spec.headlineLines || []).slice(0, 3);
  const price = (spec.price || '$29').replace(/\.?00$/, '').replace(/\.99$/, '');
  const cta = (spec.cta || '').toUpperCase();
  const accent = (spec.accent || '').toUpperCase();
  const topY = Math.round(H * 0.12), step = 88;
  const headSvg = lines.map((l, i) =>
    `<text x="60" y="${topY + i * step}" font-family="Montserrat" font-weight="800" font-size="80" letter-spacing="-1.5" fill="${WHITE}">${esc(l.toUpperCase())}</text>`
  ).join('\n');
  const barY = topY + lines.length * step + 22;
  const barW = Math.min(860, accent.length * 27 + 44);
  const badgeCx = 170, badgeCy = Math.round(H * 0.80), badgeR = 104;
  const ctaH = 76, ctaY = H - Math.round(H * 0.055) - ctaH;
  const ctaW = Math.min(640, cta.length * 22 + 70);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<filter id="bw"><feColorMatrix type="saturate" values="0"/></filter>
<linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#000" stop-opacity="0.84"/><stop offset="0.34" stop-color="#000" stop-opacity="0.28"/>
<stop offset="0.6" stop-color="#000" stop-opacity="0.42"/><stop offset="1" stop-color="#000" stop-opacity="0.93"/>
</linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="${BLACK}"/>
<image x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" href="${photoUri}" filter="url(#bw)"/>
<rect width="${W}" height="${H}" fill="url(#pg)"/>
${headSvg}
${accent ? `<rect x="56" y="${barY - 46}" width="${barW}" height="60" fill="${RED}"/><text x="76" y="${barY}" font-family="Montserrat" font-weight="800" font-size="40" fill="${WHITE}">${esc(accent)}</text>` : ''}
<circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR}" fill="${RED}"/>
<text x="${badgeCx}" y="${badgeCy - 24}" text-anchor="middle" font-family="Montserrat" font-weight="700" font-size="30" fill="${WHITE}">SOLO</text>
<text x="${badgeCx}" y="${badgeCy + 46}" text-anchor="middle" font-family="Montserrat" font-weight="800" font-size="82" fill="${WHITE}">${esc(price)}</text>
${heart(W - 96, 132, 6)}${heart(W - 142, 214, 4)}${heart(322, badgeCy - 96, 5)}
${cta ? `<rect x="300" y="${ctaY}" width="${ctaW}" height="${ctaH}" fill="${RED}"/><text x="${330}" y="${ctaY + 50}" font-family="Montserrat" font-weight="800" font-size="30" fill="${WHITE}">${esc(cta)}</text>` : ''}
${logoUri ? `<circle cx="${W - 92}" cy="${H - 86}" r="50" fill="${WHITE}"/><image x="${W - 124}" y="${H - 118}" width="64" height="64" preserveAspectRatio="xMidYMid meet" href="${logoUri}"/>` : ''}
</svg>`;
}

// Returns a finished branded PNG, or null on any failure (caller falls back).
export async function renderAd(spec: AdSpec): Promise<Uint8Array | null> {
  try {
    await ensureWasm();
    const [photoFetched, logo, mont, pf, pfi] = await Promise.all([
      spec.imageBytes ? Promise.resolve(spec.imageBytes) : getBytes(`photo:${spec.imageUrl}`, spec.imageUrl || ''),
      getBytes('logo', LOGO_URL),
      getBytes('f:mont', `${FONT_BASE}/Montserrat.ttf`),
      getBytes('f:pf', `${FONT_BASE}/PlayfairDisplay.ttf`),
      getBytes('f:pfi', `${FONT_BASE}/PlayfairDisplay-Italic.ttf`),
    ]);
    const photo = photoFetched;
    if (!photo) return null;
    if (spec.imageUrl) _cache.delete(`photo:${spec.imageUrl}`); // don't cache photos (one-shot)

    // Canvas height follows the photo's aspect (portrait, clamped) so the layout
    // fits 2:3, 4:5, 9:16 etc. without distortion or excess cropping.
    const sz = imageSize(photo);
    const ratio = sz && sz.w > 0 ? sz.h / sz.w : 1.5;
    const H = Math.round(W * Math.min(Math.max(ratio, 1.1), 1.85));

    const isPng = photo[0] === 0x89 && photo[1] === 0x50;
    const photoUri = `data:image/${isPng ? 'png' : 'jpeg'};base64,${b64(photo)}`;
    const logoUri = logo ? `data:image/png;base64,${b64(logo)}` : null;
    const svg = spec.template === 'poster'
      ? buildPosterSvg(photoUri, logoUri, spec, H)
      : buildSvg(photoUri, logoUri, spec, H);

    const fontBuffers = [mont, pf, pfi].filter(Boolean) as Uint8Array[];
    const resvg = new Resvg(svg, {
      font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Montserrat' },
      fitTo: { mode: 'width', value: W },
    });
    return resvg.render().asPng();
  } catch (e) {
    console.warn('[render-ad] failed:', (e as Error)?.message);
    return null;
  }
}
