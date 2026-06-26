// supabase/functions/_shared/brand.ts
// Stamps the Regalos Que Cantan logo onto generated visuals (bottom-right).
// AI models can't reproduce the real logo via prompts, so we composite the
// actual PNG after generation — exact brand mark, same spot, every image.
//
// PNG/JPEG in → PNG out. Fail-open: any error returns the original bytes so a
// branding hiccup never blocks creative generation. Images only (not video).
//
// Env: BRAND_LOGO_URL (default the live logo), BRAND_LOGO_ENABLED ('false' to
// turn it off globally), BRAND_LOGO_WIDTH_PCT (default 0.18 of image width).
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';

const LOGO_URL = Deno.env.get('BRAND_LOGO_URL') || 'https://regalosquecantan.com/images/logo.png';
const ENABLED = Deno.env.get('BRAND_LOGO_ENABLED') !== 'false';
const WIDTH_PCT = Number(Deno.env.get('BRAND_LOGO_WIDTH_PCT') || '0.18');

// Cache the logo BYTES (not the decoded Image — imagescript mutates images).
let _logoBytes: Uint8Array | null = null;
async function logoBytes(): Promise<Uint8Array | null> {
  if (_logoBytes) return _logoBytes;
  try {
    const r = await fetch(LOGO_URL);
    if (!r.ok) return null;
    _logoBytes = new Uint8Array(await r.arrayBuffer());
    return _logoBytes;
  } catch { return null; }
}

export async function applyLogo(bytes: Uint8Array): Promise<Uint8Array> {
  if (!ENABLED) return bytes;
  try {
    const lb = await logoBytes();
    if (!lb) return bytes;
    const base = await Image.decode(bytes);
    const logo = await Image.decode(lb);
    const targetW = Math.max(72, Math.round(base.width * WIDTH_PCT));
    logo.resize(targetW, Image.RESIZE_AUTO);

    // White circular badge behind the logo so it stays crisp & visible on ANY
    // background (dark or busy). Slightly larger than the logo = a clean ring.
    const D = Math.round(targetW * 1.14);
    const badge = new Image(D, D);
    badge.fill(0xFFFFFFFF);            // opaque white square…
    badge.roundCorners(Math.round(D / 2)); // …rounded to a full circle

    const pad = Math.round(base.width * 0.04);
    const bx = base.width - D - pad;
    const by = base.height - D - pad;
    base.composite(badge, bx, by);
    base.composite(logo, bx + Math.round((D - logo.width) / 2), by + Math.round((D - logo.height) / 2));
    return await base.encode();
  } catch (e) {
    console.warn('[brand] logo overlay failed:', (e as Error)?.message);
    return bytes; // fail-open
  }
}
