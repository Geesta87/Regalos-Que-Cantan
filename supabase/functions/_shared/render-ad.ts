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
// Accent palettes for the elegant template, so a batch of ads doesn't come out as
// five identical gold-serif cards. Each = { accent word/kicker/CTA color, ink on pill }.
const PALETTES: Record<string, { accent: string; ink: string }> = {
  gold: { accent: '#E9B872', ink: '#2A1A08' },
  rose: { accent: '#E8A6AE', ink: '#3A1018' },
  cream: { accent: '#F2E4C9', ink: '#2A2118' },
  coral: { accent: '#F2A07B', ink: '#3A1808' },
  sky: { accent: '#A8CBE6', ink: '#10212E' },
};

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
  template?: string;         // 'poster' = bold red/white/black; 'song' = personalized-song look; 'emailhero' = wide email banner; else elegant
  price?: string;            // poster/song price badge, e.g. "$29" / "Solo $29"
  palette?: string;          // elegant accent palette key (gold|rose|cream|coral|sky)
  // --- 'song' template only ---
  sub?: string;              // emotional subheadline (italic serif, under headline)
  player?: { title: string; dur?: string }; // "now playing" chip: song title + duration
  feats?: string[];          // 3 tiny feature checks at the bottom (defaults to the standard 3)
  web?: string;              // website shown on the CTA line (defaults to regalosquecantan.com)
  // --- 'emailhero' template only ---
  width?: number;            // canvas width (default 1200 = 600 CSS px @2x)
  ratio?: number;            // height / width (default 0.625 → 1200x750)
  accentHex?: string;        // exact accent color, taken from the EMAIL's style palette
  inkHex?: string;           // text color sitting on the accent pill
  align?: 'left' | 'center'; // headline alignment (default center)
  showLogo?: boolean;        // logo badge (off by default — the email header already brands it)
  focus?: 'top' | 'center' | 'bottom'; // which band of a tall photo survives the wide crop (default center)
}

function headlineLine(line: string, baseline: number, accent: string | undefined, accentColor: string): string {
  const x = 78, size = 104, fam = `font-family="Playfair Display" font-weight="500" font-size="${size}"`;
  if (accent) {
    const idx = line.toLowerCase().indexOf(accent.toLowerCase());
    if (idx >= 0) {
      const before = line.slice(0, idx), word = line.slice(idx, idx + accent.length), after = line.slice(idx + accent.length);
      return `<text x="${x}" y="${baseline}" ${fam} fill="${WHITE}">`
        + (before ? `<tspan>${esc(before)}</tspan>` : '')
        + `<tspan font-style="italic" font-weight="600" fill="${accentColor}">${esc(word)}</tspan>`
        + (after ? `<tspan>${esc(after)}</tspan>` : '')
        + `</text>`;
    }
  }
  return `<text x="${x}" y="${baseline}" ${fam} fill="${WHITE}">${esc(line)}</text>`;
}

function buildSvg(photoDataUri: string, logoDataUri: string | null, spec: AdSpec, H: number): string {
  const pal = PALETTES[spec.palette || 'gold'] || PALETTES.gold;
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
${spec.kicker ? `<text x="78" y="${kickerBaseline}" font-family="Montserrat" font-weight="700" font-size="28" letter-spacing="6" fill="${pal.accent}">${esc(spec.kicker.toUpperCase())}</text>` : ''}
${lines.map((l, i) => headlineLine(l, baselines[i], spec.accent, pal.accent)).join('\n')}
${ctaText ? `<rect x="78" y="${ctaTop}" rx="43" ry="43" width="${ctaW}" height="${ctaH}" fill="${pal.accent}"/><text x="${78 + 36}" y="${ctaTop + 56}" font-family="Montserrat" font-weight="700" font-size="31" fill="${pal.ink}">${esc(ctaText)}</text>` : ''}
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
  const topY = Math.round(H * 0.115), step = 104;
  const headSvg = lines.map((l, i) =>
    `<text x="60" y="${topY + i * step}" font-family="Anton" font-size="100" letter-spacing="1" fill="${WHITE}">${esc(l.toUpperCase())}</text>`
  ).join('\n');
  const barY = topY + lines.length * step + 28;
  const barW = Math.min(880, accent.length * 30 + 50);
  const badgeCx = 180, badgeCy = Math.round(H * 0.79), badgeR = 120;
  const ctaH = 86, ctaY = H - Math.round(H * 0.05) - ctaH;
  const ctaW = Math.min(700, cta.length * 26 + 70);
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
${accent ? `<rect x="56" y="${barY - 50}" width="${barW}" height="66" fill="${RED}"/><text x="78" y="${barY}" font-family="Anton" font-size="46" fill="${WHITE}">${esc(accent)}</text>` : ''}
<circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR}" fill="${RED}"/>
<text x="${badgeCx}" y="${badgeCy - 46}" text-anchor="middle" font-family="Anton" font-size="34" fill="${WHITE}">SOLO</text>
<text x="${badgeCx}" y="${badgeCy + 50}" text-anchor="middle" font-family="Anton" font-size="104" fill="${WHITE}">${esc(price)}</text>
${heart(W - 100, 140, 7)}${heart(W - 150, 235, 5)}${heart(345, badgeCy - 110, 6)}
${cta ? `<rect x="300" y="${ctaY}" width="${ctaW}" height="${ctaH}" fill="${RED}"/><text x="${330}" y="${ctaY + 58}" font-family="Anton" font-size="38" fill="${WHITE}">${esc(cta)}</text>` : ''}
${logoUri ? `<circle cx="${W - 92}" cy="${H - 86}" r="50" fill="${WHITE}"/><image x="${W - 124}" y="${H - 118}" width="64" height="64" preserveAspectRatio="xMidYMid meet" href="${logoUri}"/>` : ''}
</svg>`;
}

// ---------------------------------------------------------------------------
// SONG template — the approved "personalized song" look. Warm photo + a
// now-playing player chip (▶ + waveform + song title/duration) + DM Serif
// headline with a gold-italic accent + an emotional subhead + a gold CTA pill
// with the price + website, and 3 tiny feature checks, over a dark bottom fade.
// Mirrors the design signed off in the design explorer (Style B).
// ---------------------------------------------------------------------------
const SG_GOLD = '#DBB56B', SG_INK = '#F5EEE0', SG_SUB = '#EADFCB';
const SONG_FEATS = ['Con su nombre', 'Escúchala antes de pagar', 'Lista en 3 minutos'];
function songPlay(cx: number, cy: number, r: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${SG_GOLD}" stroke-width="2.5"/>`
    + `<path d="M ${cx - r * 0.28} ${cy - r * 0.42} L ${cx + r * 0.46} ${cy} L ${cx - r * 0.28} ${cy + r * 0.42} Z" fill="${SG_GOLD}"/>`;
}
function songWave(x: number, y: number, w: number): string {
  const bw = 5, g = 7, n = Math.floor(w / (bw + g));
  const hs = [8, 16, 26, 12, 22, 30, 18, 10, 24, 14, 28, 20, 12, 26, 16, 22, 30, 14, 18, 10, 24, 13, 28, 17, 22, 11, 26, 19];
  let b = '';
  for (let i = 0; i < n; i++) {
    const bh = hs[i % hs.length];
    b += `<rect x="${x + i * (bw + g)}" y="${y + 30 - bh}" width="${bw}" height="${bh}" rx="2.5" fill="${SG_GOLD}" fill-opacity="${i < n * 0.4 ? 1 : 0.32}"/>`;
  }
  return b;
}
function songCheck(x: number, y: number, r: number): string {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${SG_GOLD}"/>`
    + `<path d="M ${x - r * 0.45} ${y} l ${r * 0.32} ${r * 0.42} l ${r * 0.66} -${r * 0.72}" stroke="#141414" stroke-width="${r * 0.3}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function songFeatRow(x: number, y: number, feats: string[]): string {
  let out = ''; let cx = x; const size = 23;
  for (const f of feats) {
    out += songCheck(cx + 9, y - 7, 10); cx += 24;
    out += `<text x="${cx}" y="${y}" font-family="Montserrat" font-weight="600" font-size="${size}" fill="${SG_INK}" fill-opacity="0.92">${esc(f)}</text>`;
    cx += f.length * size * 0.53 + 28;
  }
  return out;
}
function songHead(line: string, baseline: number, accent: string | undefined, mL: number, size: number): string {
  const fam = `font-family="DM Serif Display" font-size="${size}"`;
  if (accent) {
    const idx = line.toLowerCase().indexOf(accent.toLowerCase());
    if (idx >= 0) {
      const before = line.slice(0, idx), word = line.slice(idx, idx + accent.length), after = line.slice(idx + accent.length);
      return `<text x="${mL}" y="${baseline}" ${fam} fill="${SG_INK}">${before ? esc(before) : ''}`
        + `<tspan font-style="italic" fill="${SG_GOLD}">${esc(word)}</tspan>${after ? esc(after) : ''}</text>`;
    }
  }
  return `<text x="${mL}" y="${baseline}" ${fam} fill="${SG_INK}">${esc(line)}</text>`;
}
function buildSongSvg(photoUri: string, spec: AdSpec, H: number): string {
  const mL = 70, hSize = 80, subSize = 34, headGap = Math.round(hSize * 0.98);
  const lines = (spec.headlineLines || []).slice(0, 2);
  const two = lines.length > 1;
  const botPad = Math.round(H * 0.05);
  const featY = H - botPad;
  const ctaH = 62, ctaY = featY - 52 - ctaH;
  const subY = ctaY - 36;
  const h2Y = subY - 54;
  const h1Y = two ? h2Y - headGap : h2Y;
  const playY = (two ? h1Y : h2Y) - hSize - 38;
  const topY = playY - 44;
  const feats = (spec.feats && spec.feats.length ? spec.feats : SONG_FEATS).slice(0, 3);
  const web = spec.web || 'regalosquecantan.com';
  const price = spec.price || 'Solo $29';
  const cta = spec.cta || 'Créala ahora';
  const pt = spec.player?.title || '';
  const pd = spec.player?.dur || '';
  const player = songPlay(mL + 21, playY - 22, 21)
    + `<text x="${mL + 56}" y="${playY - 30}" font-family="Montserrat" font-weight="700" font-size="23" fill="${SG_INK}" fill-opacity="0.92">${esc(pt)}</text>`
    + (pd ? `<text x="${W - mL}" y="${playY - 30}" text-anchor="end" font-family="Montserrat" font-weight="600" font-size="21" fill="${SG_INK}" fill-opacity="0.6">${esc(pd)}</text>` : '')
    + songWave(mL + 56, playY - 22, W - mL * 2 - 150);
  const ctaW = 258;
  const ctaEl = `<rect x="${mL}" y="${ctaY}" width="${ctaW}" height="${ctaH}" rx="${ctaH / 2}" fill="${SG_GOLD}"/>`
    + `<text x="${mL + 34}" y="${ctaY + ctaH / 2 + 8}" font-family="Montserrat" font-weight="700" font-size="24" fill="#141414">${esc(cta)}</text>`
    + `<path d="M ${mL + ctaW - 34} ${ctaY + ctaH / 2 - 8} l 12 8 l -12 8 M ${mL + ctaW - 40} ${ctaY + ctaH / 2} h 17" stroke="#141414" stroke-width="4.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<text x="${mL + ctaW + 26}" y="${ctaY + ctaH / 2 + 11}" font-family="DM Serif Display" font-size="38" fill="${SG_INK}">${esc(price)}</text>`
    + `<text x="${W - mL}" y="${ctaY + ctaH / 2 + 8}" text-anchor="end" font-family="Montserrat" font-weight="600" font-size="22" fill="${SG_SUB}" fill-opacity="0.85">${esc(web)}</text>`;
  const heads = two
    ? songHead(lines[0], h1Y, spec.accent, mL, hSize) + songHead(lines[1], h2Y, spec.accent, mL, hSize)
    : songHead(lines[0] || '', h2Y, spec.accent, mL, hSize);
  // Auto-shrink the subhead so a long line never clips off the right edge.
  const subFit = spec.sub ? Math.max(24, Math.min(subSize, Math.floor((W - mL * 2) / (spec.sub.length * 0.5)))) : subSize;
  const sub = spec.sub ? `<text x="${mL}" y="${subY}" font-family="DM Serif Display" font-style="italic" font-size="${subFit}" fill="${SG_SUB}">${esc(spec.sub)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#0a0806" stop-opacity="0"/><stop offset="0.5" stop-color="#0a0806" stop-opacity="0.8"/><stop offset="1" stop-color="#0a0806" stop-opacity="0.97"/></linearGradient></defs>
<image x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" href="${photoUri}"/>
<rect x="0" y="${topY - 50}" width="${W}" height="${H - (topY - 50)}" fill="url(#sg)"/>
${player}
${heads}
${sub}
${ctaEl}
${songFeatRow(mL, featY, feats)}
</svg>`;
}

// ---------------------------------------------------------------------------
// NATIVE template — the verified lo-fi/caption look (Motion: 42% of top-spending
// ads are lo-fi; head-to-head "ugly beats polished" w/ +30% action intent). The
// photo reads as ORGANIC content; the only design is stacked caption chips —
// short bold lines on solid blocks, like a creator's story caption. NO logo
// (profile logo already shows beside the ad), NO gradients, NO ornament.
// ---------------------------------------------------------------------------
function chipRow(x: number, y: number, text: string, size: number, fg: string, bg: string, pad = 18): string {
  const w = Math.round(text.length * size * 0.62) + pad * 2;
  const h = Math.round(size * 1.42);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>`
    + `<text x="${x + pad}" y="${y + Math.round(h * 0.72)}" font-family="Montserrat" font-weight="700" font-size="${size}" fill="${fg}">${esc(text)}</text>`;
}
function buildNativeSvg(photoUri: string, spec: AdSpec, H: number): string {
  const lines = (spec.headlineLines || []).slice(0, 3);
  const x = 56, size = 62, gap = 12;
  let y = Math.round(H * 0.10);
  let chips = '';
  for (const l of lines) { chips += chipRow(x, y, l, size, '#FFFFFF', '#111111'); y += Math.round(size * 1.42) + gap; }
  if (spec.sub) { chips += chipRow(x, y + 4, spec.sub, 34, '#111111', '#FFFFFF'); }
  // Single small offer chip bottom-left: price + CTA, nothing else.
  const offer = [spec.price, spec.cta].filter(Boolean).join(' · ');
  const bottom = offer ? chipRow(x, H - Math.round(H * 0.06) - 64, offer, 36, '#FFFFFF', '#C1121F') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<image x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" href="${photoUri}"/>
${chips}
${bottom}
</svg>`;
}

// ---------------------------------------------------------------------------
// BIGTYPE template — the verified text-forward editorial static (Motion $1.3B:
// text-forward assets over-index as winners; Denney/BFCM text-heavy statics).
// Split layout: a solid block with ONE huge short headline (Anton, ≤3 benefit
// lines below per the verified typography spec) over the photo. No logo.
// ---------------------------------------------------------------------------
function buildBigTypeSvg(photoUri: string, spec: AdSpec, H: number): string {
  const lines = (spec.headlineLines || []).slice(0, 2);
  const x = 60;
  const blockH = Math.round(H * 0.40);
  const size = lines.some((l) => l.length > 12) ? 96 : 118;
  const step = Math.round(size * 1.06);
  const topY = 120;
  const heads = lines.map((l, i) => {
    const line = l.toUpperCase();
    const acc = (spec.accent || '').toUpperCase();
    if (acc && line.includes(acc)) {
      const idx = line.indexOf(acc);
      return `<text x="${x}" y="${topY + i * step}" font-family="Anton" font-size="${size}" fill="#FFFFFF">${esc(line.slice(0, idx))}<tspan fill="${GOLD}">${esc(acc)}</tspan>${esc(line.slice(idx + acc.length))}</text>`;
    }
    return `<text x="${x}" y="${topY + i * step}" font-family="Anton" font-size="${size}" fill="#FFFFFF">${esc(line)}</text>`;
  }).join('\n');
  const feats = (spec.feats || []).slice(0, 3);
  let featSvg = ''; let fy = topY + lines.length * step + 8;
  for (const f of feats) {
    featSvg += `<circle cx="${x + 12}" cy="${fy - 10}" r="11" fill="${GOLD}"/><path d="M ${x + 6} ${fy - 10} l 4 5 l 8 -9" stroke="#141414" stroke-width="3.2" fill="none" stroke-linecap="round"/>`
      + `<text x="${x + 34}" y="${fy}" font-family="Montserrat" font-weight="600" font-size="29" fill="#EDE6DA">${esc(f)}</text>`;
    fy += 44;
  }
  const price = (spec.price || '').trim();
  const badge = price
    ? `<circle cx="${W - 150}" cy="${blockH}" r="104" fill="${GOLD}"/>`
      + `<text x="${W - 150}" y="${blockH - 18}" text-anchor="middle" font-family="Anton" font-size="30" fill="#141414">${esc(price.toLowerCase().startsWith('solo') ? 'SOLO' : '')}</text>`
      + `<text x="${W - 150}" y="${blockH + 58}" text-anchor="middle" font-family="Anton" font-size="82" fill="#141414">${esc(price.replace(/solo/i, '').trim())}</text>`
    : '';
  const cta = (spec.cta || '').toUpperCase();
  const ctaSvg = cta
    ? `<rect x="${x}" y="${H - 148}" width="${Math.min(720, cta.length * 30 + 70)}" height="84" fill="#C1121F"/><text x="${x + 32}" y="${H - 92}" font-family="Anton" font-size="40" fill="#FFFFFF">${esc(cta)}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#0E0B08"/>
<image x="0" y="${blockH}" width="${W}" height="${H - blockH}" preserveAspectRatio="xMidYMid slice" href="${photoUri}"/>
<rect x="0" y="${blockH}" width="${W}" height="${Math.round(H * 0.06)}" fill="url(#btf)"/>
<defs><linearGradient id="btf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E0B08" stop-opacity="0.9"/><stop offset="1" stop-color="#0E0B08" stop-opacity="0"/></linearGradient></defs>
${heads}
${featSvg}
${badge}
${ctaSvg}
</svg>`;
}

// ---------------------------------------------------------------------------
// EMAILHERO template — a LANDSCAPE designed banner for the top of a marketing
// email. This is the "premium DTC / Klaviyo" hero look: full-bleed photo, a
// legibility scrim, a letterspaced kicker, a big serif headline with one italic
// accent word, an optional subline and an optional baked CTA pill.
//
// Two things make it different from the ad templates above:
//   1. It is WIDE — 1200x750 by default, i.e. 600x375 CSS px at 2x retina.
//   2. Its accent color comes from the EMAIL's chosen style palette (accentHex),
//      so the banner and the HTML beneath it read as one continuous design
//      instead of a gold ad pasted onto a blush email.
//
// The baked CTA is decoration ONLY. The email must always carry a real <a>
// button underneath it — roughly a third of inboxes block images by default,
// and a banner-only CTA is an unclickable dead end for those readers.
// ---------------------------------------------------------------------------
function fitSize(lines: string[], usableW: number, max: number, min: number): number {
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 1);
  return Math.max(min, Math.min(max, Math.floor(usableW / (longest * 0.53))));
}

function heroHeadline(line: string, y: number, size: number, accent: string | undefined, accentColor: string, x: number, center: boolean): string {
  const anchor = center ? ' text-anchor="middle"' : '';
  const fam = `font-family="Playfair Display" font-weight="600" font-size="${size}"`;
  if (accent) {
    const idx = line.toLowerCase().indexOf(accent.toLowerCase());
    if (idx >= 0) {
      const before = line.slice(0, idx), word = line.slice(idx, idx + accent.length), after = line.slice(idx + accent.length);
      return `<text x="${x}" y="${y}"${anchor} ${fam} fill="${WHITE}">`
        + (before ? `<tspan>${esc(before)}</tspan>` : '')
        + `<tspan font-style="italic" fill="${accentColor}">${esc(word)}</tspan>`
        + (after ? `<tspan>${esc(after)}</tspan>` : '')
        + `</text>`;
    }
  }
  return `<text x="${x}" y="${y}"${anchor} ${fam} fill="${WHITE}">${esc(line)}</text>`;
}

function buildEmailHeroSvg(photoUri: string, logoUri: string | null, spec: AdSpec, CW: number, H: number): string {
  const accent = spec.accentHex || GOLD;
  const ink = spec.inkHex || INK;
  const center = (spec.align || 'center') === 'center';
  const mX = Math.round(CW * 0.075);
  const usableW = CW - mX * 2;
  const x = center ? Math.round(CW / 2) : mX;
  const anchor = center ? ' text-anchor="middle"' : '';

  const lines = (spec.headlineLines || []).filter(Boolean).slice(0, 3);
  const hSize = fitSize(lines, usableW, Math.round(CW * 0.085), 40);
  const step = Math.round(hSize * 1.16);
  const kickSize = Math.max(17, Math.round(CW * 0.0185));
  const subSize = Math.max(21, Math.round(CW * 0.027));
  const ctaFont = Math.max(20, Math.round(CW * 0.026));
  const ctaH = Math.round(ctaFont * 2.5);

  const kicker = (spec.kicker || '').trim();
  const sub = (spec.sub || '').trim();
  const cta = (spec.cta || '').trim();
  const gapK = Math.round(hSize * 0.5);
  const gapS = Math.round(hSize * 0.34);
  const gapC = Math.round(hSize * 0.46);

  // Measure the whole stack first so it sits optically centered at any height.
  let blockH = lines.length * step;
  if (kicker) blockH += kickSize + gapK;
  if (sub) blockH += subSize + gapS;
  if (cta) blockH += ctaH + gapC;

  let y = Math.round((H - blockH) / 2);
  const blockTop = y;
  let out = '';

  if (kicker) {
    y += kickSize;
    out += `<text x="${x}" y="${y}"${anchor} font-family="Montserrat" font-weight="700" font-size="${kickSize}" letter-spacing="${Math.round(kickSize * 0.28)}" fill="${accent}">${esc(kicker.toUpperCase())}</text>`;
    y += gapK;
  }
  for (const line of lines) {
    y += hSize;
    out += heroHeadline(line, y, hSize, spec.accent, accent, x, center);
    y += step - hSize;
  }
  if (sub) {
    y += gapS + subSize;
    // Shrink a long subline rather than letting it run off the canvas.
    const subFit = Math.max(18, Math.min(subSize, Math.floor(usableW / (sub.length * 0.5))));
    out += `<text x="${x}" y="${y}"${anchor} font-family="Playfair Display" font-style="italic" font-size="${subFit}" fill="#FFFFFF" fill-opacity="0.82">${esc(sub)}</text>`;
  }
  if (cta) {
    y += gapC;
    const ctaW = Math.round(cta.length * ctaFont * 0.64) + ctaFont * 3;
    const ctaX = center ? Math.round((CW - ctaW) / 2) : mX;
    out += `<rect x="${ctaX}" y="${y}" width="${ctaW}" height="${ctaH}" rx="${Math.round(ctaH / 2)}" fill="${accent}"/>`
      + `<text x="${ctaX + Math.round(ctaW / 2)}" y="${y + Math.round(ctaH * 0.66)}" text-anchor="middle" font-family="Montserrat" font-weight="700" font-size="${ctaFont}" letter-spacing="1" fill="${ink}">${esc(cta)}</text>`;
  }

  // Legibility plate: a soft dark band behind the TEXT BLOCK ONLY. Without it a
  // bright photo (a yellow studio backdrop) either eats the type or forces a
  // heavy global scrim that turns the whole photo muddy. This keeps the photo
  // vivid at the edges and readable under the words.
  const platePad = Math.round(H * 0.13);
  const plateY = Math.max(0, blockTop - platePad);
  const plateH = Math.min(H - plateY, blockH + platePad * 2);

  // Our source photos are portrait; a wide banner crops them hard. Anchor the
  // crop so the faces survive instead of defaulting to the middle band.
  const crop = spec.focus === 'top' ? 'xMidYMin' : spec.focus === 'bottom' ? 'xMidYMax' : 'xMidYMid';

  const logo = spec.showLogo && logoUri
    ? `<circle cx="${mX + 34}" cy="${Math.round(H * 0.11)}" r="34" fill="${WHITE}"/><image x="${mX + 11}" y="${Math.round(H * 0.11) - 23}" width="46" height="46" preserveAspectRatio="xMidYMid meet" href="${logoUri}"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${H}" viewBox="0 0 ${CW} ${H}">
<defs>
<linearGradient id="eh" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#0B0805" stop-opacity="0.5"/>
<stop offset="0.45" stop-color="#0B0805" stop-opacity="0.16"/>
<stop offset="1" stop-color="#0B0805" stop-opacity="0.6"/>
</linearGradient>
<linearGradient id="ehp" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#0B0805" stop-opacity="0"/>
<stop offset="0.5" stop-color="#0B0805" stop-opacity="0.62"/>
<stop offset="1" stop-color="#0B0805" stop-opacity="0"/>
</linearGradient>
</defs>
<rect width="${CW}" height="${H}" fill="#0B0805"/>
<image x="0" y="0" width="${CW}" height="${H}" preserveAspectRatio="${crop} slice" href="${photoUri}"/>
<rect width="${CW}" height="${H}" fill="url(#eh)"/>
<rect x="0" y="${plateY}" width="${CW}" height="${plateH}" fill="url(#ehp)"/>
<rect width="${CW}" height="${H}" fill="#0B0805" fill-opacity="0.08"/>
${logo}
${out}
</svg>`;
}

/**
 * Crop a photo to an exact box without distorting it — the email equivalent of
 * CSS object-fit:cover, which Outlook ignores. Our source photos are portrait
 * and email tiles are landscape, so the crop has to be baked into the file or
 * the picture arrives squashed. `focus` picks which band survives.
 * Returns a PNG, or null on any failure (caller falls back to the original).
 */
export async function cropPhoto(
  src: { imageBytes?: Uint8Array; imageUrl?: string },
  width: number,
  height: number,
  focus: 'top' | 'center' | 'bottom' = 'center',
): Promise<Uint8Array | null> {
  try {
    await ensureWasm();
    const photo = src.imageBytes || (await getBytes(`crop:${src.imageUrl}`, src.imageUrl || ''));
    if (!photo) return null;
    if (src.imageUrl) _cache.delete(`crop:${src.imageUrl}`);
    const isPng = photo[0] === 0x89 && photo[1] === 0x50;
    const uri = `data:image/${isPng ? 'png' : 'jpeg'};base64,${b64(photo)}`;
    const crop = focus === 'top' ? 'xMidYMin' : focus === 'bottom' ? 'xMidYMax' : 'xMidYMid';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
      + `<image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="${crop} slice" href="${uri}"/></svg>`;
    return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  } catch (e) {
    console.warn('[render-ad] cropPhoto failed:', (e as Error)?.message);
    return null;
  }
}

// Returns a finished branded PNG, or null on any failure (caller falls back).
export async function renderAd(spec: AdSpec): Promise<Uint8Array | null> {
  try {
    await ensureWasm();
    const [photoFetched, logo, mont, montB, pf, pfi, anton, dms, dmsi] = await Promise.all([
      spec.imageBytes ? Promise.resolve(spec.imageBytes) : getBytes(`photo:${spec.imageUrl}`, spec.imageUrl || ''),
      getBytes('logo', LOGO_URL),
      getBytes('f:mont', `${FONT_BASE}/Montserrat.ttf`),
      // Static Montserrat Bold (weight 700). REQUIRED: Montserrat.ttf is a
      // VARIABLE font and resvg only renders its default (Thin) instance, so
      // every font-weight="700" label — kickers, CTA pills, feature rows, on
      // ads as well as email banners — came out hairline until this was added.
      getBytes('f:montb', `${FONT_BASE}/MontserratBold.ttf`),
      getBytes('f:pf', `${FONT_BASE}/PlayfairDisplay.ttf`),
      getBytes('f:pfi', `${FONT_BASE}/PlayfairDisplay-Italic.ttf`),
      getBytes('f:anton', `${FONT_BASE}/Anton.ttf`),  // heavy display font for the poster template
      getBytes('f:dms', `${FONT_BASE}/DMSerifDisplay.ttf`),          // song template headline
      getBytes('f:dmsi', `${FONT_BASE}/DMSerifDisplay-Italic.ttf`),  // song template accent/subhead
    ]);
    const photo = photoFetched;
    if (!photo) return null;
    if (spec.imageUrl) _cache.delete(`photo:${spec.imageUrl}`); // don't cache photos (one-shot)

    // Email heroes are WIDE and fixed-ratio (the banner sits in a 600px email
    // column); ad templates stay portrait and follow the photo's own aspect.
    const isEmailHero = spec.template === 'emailhero';
    const CW = isEmailHero ? Math.round(Math.min(Math.max(spec.width || 1200, 600), 1600)) : W;

    // Canvas height follows the photo's aspect (portrait, clamped) so the layout
    // fits 2:3, 4:5, 9:16 etc. without distortion or excess cropping.
    const sz = imageSize(photo);
    const ratio = sz && sz.w > 0 ? sz.h / sz.w : 1.5;
    const H = isEmailHero
      ? Math.round(CW * Math.min(Math.max(spec.ratio || 0.625, 0.4), 1.2))
      : Math.round(W * Math.min(Math.max(ratio, 1.1), 1.85));

    const isPng = photo[0] === 0x89 && photo[1] === 0x50;
    const photoUri = `data:image/${isPng ? 'png' : 'jpeg'};base64,${b64(photo)}`;
    const logoUri = logo ? `data:image/png;base64,${b64(logo)}` : null;
    const svg = spec.template === 'poster'
      ? buildPosterSvg(photoUri, logoUri, spec, H)
      : spec.template === 'song'
      ? buildSongSvg(photoUri, spec, H)
      : spec.template === 'native'
      ? buildNativeSvg(photoUri, spec, H)
      : spec.template === 'bigtype'
      ? buildBigTypeSvg(photoUri, spec, H)
      : isEmailHero
      ? buildEmailHeroSvg(photoUri, logoUri, spec, CW, H)
      : buildSvg(photoUri, logoUri, spec, H);

    const fontBuffers = [mont, montB, pf, pfi, anton, dms, dmsi].filter(Boolean) as Uint8Array[];
    const resvg = new Resvg(svg, {
      font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Montserrat' },
      fitTo: { mode: 'width', value: CW },
    });
    return resvg.render().asPng();
  } catch (e) {
    console.warn('[render-ad] failed:', (e as Error)?.message);
    return null;
  }
}
