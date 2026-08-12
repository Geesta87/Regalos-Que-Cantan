// _shared/email-shell.ts
// ---------------------------------------------------------------------------
// ONE shared, email-safe brand shell for every customer email (papel picado +
// vinyl craft), colored BY EMAIL PURPOSE. Ported from the approved preview
// (emailkit.js).
//
// SAFETY RULE — LINKS:
//   This shell NEVER constructs a destination URL. The caller passes the
//   already-computed URL (the same variable the old template used) as
//   `ctaHref`. That guarantees an unpaid/preview email keeps pointing at its
//   payment-gated page and can never hand out a paid /song/ or /success link.
//   Do not add link logic here.
//
// EMAIL-SAFE GRAPHICS:
//   Gmail/Outlook strip <svg> and CSS gradients, so the papel-picado banner and
//   the hero art are HOSTED PNGs (transparent, on a solid-color <td>). Text,
//   layout, and the CTA button are pure HTML so they render everywhere and the
//   link is always live. Missing image => you still see a solid colored block
//   and the alt text, never a broken email.
//
//   Assets to publish once to the `email-assets` public bucket:
//     papel-festive.png, papel-muted.png            (transparent flag banner)
//     hero-vinyl-confirm.png, hero-vinyl-preview.png,
//     hero-vinyl-recovery.png, hero-vinyl-apology.png,
//     hero-video.png, hero-photos.png, hero-progress.png,
//     hero-lock.png, hero-partner.png               (hero + stage, baked)
// ---------------------------------------------------------------------------

// Brand PNGs live in the public Supabase Storage bucket `email-assets` (uploaded
// 2026-07-10). Independent of the frontend deploy — the emails render these
// directly from the CDN. (Copies also kept in public/images/email/ for the repo.)
const ASSET_BASE = 'https://yzbvajungshqcpusfiia.supabase.co/storage/v1/object/public/email-assets';

export type Palette =
  | 'confirm' | 'preview' | 'reminder' | 'recovery' | 'apology' | 'video' | 'affiliate';

type Tokens = {
  outer: string; card: string; strip: string; border: string; stageBg: string; papel: 'festive' | 'muted';
  eyebrow: string; headline: string; accent: string; body: string;
  ctaGrad: string; ctaSolid: string; ctaShadow: string; ctaText: string;
  subcopy: string; footText: string; link: string; clabel: string; cval: string; cdiv: string;
};

// stageBg is a SOLID approximation of the preview's radial stage (email-safe).
const P: Record<Palette, Tokens> = {
  preview:  { outer:'#070b15',card:'#0e1220',strip:'#14203a',border:'#1e2a44',stageBg:'#141d33',papel:'festive',eyebrow:'#9fb6e0',headline:'#eef2f9',accent:'#a9c4f0',body:'#a6b0c6',ctaGrad:'linear-gradient(135deg,#6a9bff 0%,#4b6fe0 100%)',ctaSolid:'#4b6fe0',ctaShadow:'rgba(75,111,224,.38)',ctaText:'#ffffff',subcopy:'#8394b8',footText:'#67718c',link:'#aec4ea',clabel:'#8394b8',cval:'#e7ecf5',cdiv:'#24314e' },
  confirm:  { outer:'#06120d',card:'#0b1a13',strip:'#12241c',border:'#17342a',stageBg:'#0f2a22',papel:'festive',eyebrow:'#7fd0a8',headline:'#eef6ef',accent:'#8fe6b8',body:'#9fb8ac',ctaGrad:'linear-gradient(135deg,#f0c675 0%,#d99a3e 100%)',ctaSolid:'#d99a3e',ctaShadow:'rgba(217,154,62,.36)',ctaText:'#2a1a06',subcopy:'#7fa893',footText:'#6a7d74',link:'#a8d6c2',clabel:'#7fa893',cval:'#e7f2ec',cdiv:'#1c3a2e' },
  reminder: { outer:'#140f06',card:'#1b1509',strip:'#241c0e',border:'#342a12',stageBg:'#2a2110',papel:'festive',eyebrow:'#e0c07a',headline:'#f5efe0',accent:'#f0c780',body:'#b8ac96',ctaGrad:'linear-gradient(135deg,#f0c675 0%,#dd9c3c 100%)',ctaSolid:'#dd9c3c',ctaShadow:'rgba(221,156,60,.36)',ctaText:'#2a1a06',subcopy:'#b0996f',footText:'#7d7159',link:'#e6cf94',clabel:'#b0996f',cval:'#f2ead7',cdiv:'#3a2f16' },
  recovery: { outer:'#170a0a',card:'#1e0e0d',strip:'#241210',border:'#351917',stageBg:'#2a120f',papel:'festive',eyebrow:'#e8a08a',headline:'#f5e8e2',accent:'#f0a890',body:'#c7a89e',ctaGrad:'linear-gradient(135deg,#f5603a 0%,#e0447f 100%)',ctaSolid:'#e0553a',ctaShadow:'rgba(224,85,58,.36)',ctaText:'#ffffff',subcopy:'#b78f80',footText:'#7d655c',link:'#eab4a4',clabel:'#b78f80',cval:'#f2e4de',cdiv:'#3a201c' },
  apology:  { outer:'#0d0f13',card:'#14171c',strip:'#1a1e24',border:'#262b33',stageBg:'#1a1e24',papel:'muted',eyebrow:'#9aa4b0',headline:'#e6e9ee',accent:'#b8c2ce',body:'#a0a8b2',ctaGrad:'linear-gradient(135deg,#6b7686 0%,#565f6d 100%)',ctaSolid:'#565f6d',ctaShadow:'rgba(90,100,114,.32)',ctaText:'#ffffff',subcopy:'#8a929c',footText:'#6a727c',link:'#aab4c0',clabel:'#8a929c',cval:'#e2e6ec',cdiv:'#2a2f37' },
  video:    { outer:'#0f0817',card:'#160e22',strip:'#1f1533',border:'#2e2044',stageBg:'#1e1436',papel:'festive',eyebrow:'#c0a8e0',headline:'#f0ecf7',accent:'#cbb0f0',body:'#b0a6c2',ctaGrad:'linear-gradient(135deg,#a06cf5 0%,#7c3aed 100%)',ctaSolid:'#7c3aed',ctaShadow:'rgba(124,58,237,.40)',ctaText:'#ffffff',subcopy:'#9a8cb8',footText:'#726488',link:'#c7b0ea',clabel:'#9a8cb8',cval:'#ece6f5',cdiv:'#2e2044' },
  affiliate:{ outer:'#061312',card:'#0b1a19',strip:'#10221f',border:'#163430',stageBg:'#0e2a26',papel:'festive',eyebrow:'#7fd0c4',headline:'#eef6f4',accent:'#8fe6d8',body:'#9fb8b2',ctaGrad:'linear-gradient(135deg,#2fbfa8 0%,#159183 100%)',ctaSolid:'#159183',ctaShadow:'rgba(21,145,131,.36)',ctaText:'#eafffb',subcopy:'#7fa89f',footText:'#6a7d78',link:'#a8d6cc',clabel:'#7fa89f',cval:'#e7f2ef',cdiv:'#163a34' },
};

const WORD = '#c9b58a'; // gold wordmark — brand constant

// Which hero graphic to use. Vinyl variants track the palette; others are 1:1.
export type Hero = 'vinyl' | 'video' | 'photos' | 'progress' | 'lock' | 'partner';
function heroAsset(hero: Hero, palette: Palette): string {
  if (hero === 'vinyl') {
    const key = (palette === 'preview' || palette === 'apology') ? palette
      : (palette === 'recovery') ? 'recovery' : 'confirm';
    return `hero-vinyl-${key}.png`;
  }
  return `hero-${hero}.png`;
}

function esc(s: string): string { return (s || '').replace(/&(?![a-zA-Z#0-9]+;)/g, '&amp;'); }

export interface CreditItem { label: string; value: string; }
export interface SongRow { name: string; href: string; label: string; sub?: { text: string; href: string } }
export interface EmailConfig {
  palette: Palette;
  hero: Hero;
  preheader?: string;
  eyebrow?: string;            // small label above the headline/hero
  headline: string;           // may contain inline <span> accent markup
  sub: string;
  credits?: CreditItem[];      // optional "liner notes" row (Para / De / Estilo)
  apologyTop?: string;         // pill banner above headline (apology emails)
  coupon?: { code: string; pct: string };
  credentials?: CreditItem[];  // affiliate welcome
  songRows?: SongRow[];        // multi-song list (recover-song) — one button per song, each href passed through verbatim
  ctaText?: string;            // omit for status-only emails (e.g. "in the making")
  ctaHref?: string;            // MUST be the caller's already-computed URL
  subcopy?: string;
}

function banner(c: Tokens): string {
  const src = `${ASSET_BASE}/papel-${c.papel}.png`;
  return `<tr><td style="padding:0;line-height:0;background:${c.strip};" bgcolor="${c.strip}"><img src="${src}" width="600" alt="" style="display:block;width:100%;height:auto;border:0;"></td></tr>`;
}
// The flat two-colour Cenzo mark sits above the wordmark. It is a self-contained
// circle with a transparent surround, so it reads correctly on all 7 palettes.
// Served from the site because public/brand/cenzo/ ships with the frontend deploy.
const CENZO_MARK = 'https://regalosquecantan.com/brand/cenzo/cenzo-mark.png';
function wordmark(): string {
  return `<tr><td align="center" style="padding:24px 26px 0;"><img src="${CENZO_MARK}" width="46" height="46" alt="" style="display:block;margin:0 auto 12px;width:46px;height:46px;border:0;"><span style="font-size:11px;letter-spacing:4px;color:${WORD};font-weight:bold;">R E G A L O S &nbsp; Q U E &nbsp; C A N T A N</span></td></tr>`;
}
function hero(c: Tokens, h: Hero, palette: Palette, eyebrow?: string): string {
  const src = `${ASSET_BASE}/${heroAsset(h, palette)}`;
  const eb = eyebrow ? `<p style="margin:0 0 18px;font-size:10px;letter-spacing:4px;color:${c.eyebrow};text-transform:uppercase;font-weight:bold;">${eyebrow}</p>` : '';
  return `<tr><td align="center" style="padding:34px 20px 30px;background:${c.stageBg};" bgcolor="${c.stageBg}">${eb}<img src="${src}" width="240" alt="" style="display:block;margin:0 auto;max-width:260px;width:100%;height:auto;border:0;"></td></tr>`;
}
// Multi-song list: one card + button per song. Each href is the caller's
// existing per-song URL, passed straight through (never rebuilt here).
function songList(c: Tokens, rows: SongRow[]): string {
  const items = rows.map((r) => `<tr><td style="padding:8px 0;"><table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:rgba(255,255,255,.04);border:1px solid ${c.border};border-radius:12px;"><tr><td style="padding:16px 20px;"><p style="margin:0 0 12px;font-size:16px;color:${c.headline};font-weight:bold;">Para <span style="color:${c.accent};">${r.name}</span></p><table cellpadding="0" cellspacing="0" role="presentation"><tr><td bgcolor="${c.ctaSolid}" style="border-radius:10px;background:${c.ctaSolid};background:${c.ctaGrad};"><a href="${r.href}" style="display:inline-block;padding:12px 26px;color:${c.ctaText};font-size:14px;font-weight:bold;text-decoration:none;">${r.label}</a></td></tr></table>${r.sub ? `<p style="margin:12px 0 0;font-size:12px;"><a href="${r.sub.href}" style="color:${c.link};font-weight:600;text-decoration:none;">${r.sub.text}</a></p>` : ''}</td></tr></table></td></tr>`).join('');
  return `<table width="100%" role="presentation"><tr><td style="padding:22px 0 0;"><table width="100%" cellpadding="0" cellspacing="0" role="presentation">${items}</table></td></tr></table>`;
}
function ctaButton(c: Tokens, text: string, href: string): string {
  return `<table width="100%" role="presentation"><tr><td align="center" style="padding:30px 0 0;"><table cellpadding="0" cellspacing="0" role="presentation" align="center"><tr><td align="center" bgcolor="${c.ctaSolid}" style="border-radius:44px;background:${c.ctaSolid};background:${c.ctaGrad};box-shadow:0 14px 30px ${c.ctaShadow};"><a href="${href}" style="display:inline-block;padding:19px 50px;color:${c.ctaText};font-size:15.5px;font-weight:bold;letter-spacing:.5px;text-decoration:none;">${text}</a></td></tr></table></td></tr></table>`;
}
function creditsRow(c: Tokens, items: CreditItem[]): string {
  const w = Math.floor(100 / items.length);
  const cells = items.map((it, i) => {
    const bord = (i > 0 && i < items.length) ? `border-left:1px solid ${c.cdiv};` : '';
    return `<td width="${w}%" align="center" style="padding:0 6px;${bord}"><p style="margin:0;font-size:10px;letter-spacing:2px;color:${c.clabel};text-transform:uppercase;">${it.label}</p><p style="margin:4px 0 0;font-size:14px;color:${c.cval};">${it.value}</p></td>`;
  }).join('');
  return `<table width="100%" role="presentation"><tr><td align="center" style="padding:26px 0 0;"><table cellpadding="0" cellspacing="0" role="presentation" style="width:420px;max-width:100%;"><tr>${cells}</tr></table></td></tr></table>`;
}
function couponModule(c: Tokens, code: string, pct: string): string {
  return `<table width="100%" role="presentation"><tr><td align="center" style="padding:24px 0 0;"><table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;border:2px dashed ${c.ctaSolid};border-radius:14px;"><tr><td align="center" style="padding:20px;"><p style="margin:0 0 6px;font-size:10px;letter-spacing:2px;color:${c.eyebrow};text-transform:uppercase;font-weight:bold;">Un regalo para ti</p><p style="margin:0 0 8px;font-family:Georgia,serif;font-size:30px;color:${c.accent};font-weight:bold;">${pct} OFF</p><div style="display:inline-block;background:${c.card};border:1px solid ${c.ctaSolid};border-radius:8px;padding:9px 22px;"><span style="color:${c.headline};font-size:19px;font-weight:bold;letter-spacing:4px;font-family:monospace;">${code}</span></div><p style="margin:12px 0 0;font-size:11px;color:${c.subcopy};">V&aacute;lido 24 horas &middot; solo para esta canci&oacute;n</p></td></tr></table></td></tr></table>`;
}
function credentialsModule(c: Tokens, rows: CreditItem[]): string {
  const r = rows.map((it) => `<tr><td style="padding:10px 0;border-top:1px solid ${c.cdiv};"><table width="100%" role="presentation"><tr><td style="font-size:10px;letter-spacing:2px;color:${c.clabel};text-transform:uppercase;">${it.label}</td><td align="right" style="font-size:14px;color:${c.cval};font-family:monospace;">${it.value}</td></tr></table></td></tr>`).join('');
  return `<table width="100%" role="presentation"><tr><td style="padding:24px 0 0;"><table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:rgba(0,0,0,.25);border:1px solid ${c.border};border-radius:12px;"><tr><td style="padding:6px 20px 16px;">${r}</td></tr></table></td></tr></table>`;
}
function apologyBanner(c: Tokens, text: string): string {
  return `<table width="100%" role="presentation"><tr><td align="center" style="padding:0 0 4px;"><span style="display:inline-block;background:rgba(255,255,255,.06);color:${c.accent};border:1px solid ${c.cdiv};font-size:12px;font-weight:bold;padding:9px 16px;border-radius:30px;">${text}</span></td></tr></table>`;
}
function footer(c: Tokens): string {
  // <!-- can-spam --> sentinel stops buildEmailParts from injecting a 2nd address block.
  return `<tr><td style="padding:0;line-height:0;background:${c.strip};" bgcolor="${c.strip}"><img src="${ASSET_BASE}/papel-${c.papel}.png" width="600" alt="" style="display:block;width:100%;height:auto;border:0;transform:rotate(180deg);"></td></tr>`
    + `<tr><td align="center" style="padding:24px 40px 30px;background:${c.card};" bgcolor="${c.card}"><!-- can-spam --><p style="margin:0 0 6px;font-size:11px;letter-spacing:3px;color:${WORD};font-weight:bold;">REGALOS QUE CANTAN</p><p style="margin:0;font-size:11px;color:${c.footText};line-height:1.7;">&iquest;Necesitas ayuda? <a href="mailto:hola@regalosquecantan.com" style="color:${c.link};text-decoration:underline;">hola@regalosquecantan.com</a><br>Regalos Que Cantan &bull; Los Angeles, CA 91324, USA</p></td></tr>`;
}

/** Build the full HTML body. Pass the result through buildEmailParts(html, preheader). */
export function renderEmail(cfg: EmailConfig): string {
  const c = P[cfg.palette];
  let mid = '';
  if (cfg.apologyTop) mid += apologyBanner(c, cfg.apologyTop);
  mid += `<table width="100%" role="presentation"><tr><td align="center"><h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:31px;line-height:1.2;color:${c.headline};font-weight:normal;">${cfg.headline}</h1><p style="margin:18px auto 0;max-width:392px;font-size:15px;line-height:1.75;color:${c.body};">${cfg.sub}</p></td></tr></table>`;
  if (cfg.credits && cfg.credits.length) mid += creditsRow(c, cfg.credits);
  if (cfg.coupon) mid += couponModule(c, cfg.coupon.code, cfg.coupon.pct);
  if (cfg.credentials && cfg.credentials.length) mid += credentialsModule(c, cfg.credentials);
  if (cfg.songRows && cfg.songRows.length) mid += songList(c, cfg.songRows);
  if (cfg.ctaText && cfg.ctaHref) mid += ctaButton(c, cfg.ctaText, cfg.ctaHref);
  if (cfg.subcopy) mid += `<table width="100%" role="presentation"><tr><td align="center" style="padding:14px 0 0;"><p style="margin:0;font-size:12px;color:${c.subcopy};">${cfg.subcopy}</p></td></tr></table>`;

  const pre = cfg.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${c.outer};">${esc(cfg.preheader)}</div>`
    : '';

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${c.outer};font-family:'Helvetica Neue',Arial,sans-serif;">${pre}
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${c.outer};" bgcolor="${c.outer}"><tr><td align="center" style="padding:36px 16px;">
<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:${c.card};border:1px solid ${c.border};" bgcolor="${c.card}">
${banner(c)}
${wordmark()}
${hero(c, cfg.hero, cfg.palette, cfg.eyebrow)}
<tr><td style="padding:32px 52px 42px;">${mid}</td></tr>
${footer(c)}
</table></td></tr></table></body></html>`;
}
