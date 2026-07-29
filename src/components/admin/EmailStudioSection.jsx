// src/components/admin/EmailStudioSection.jsx
// "Email Studio" section of the Creative Studio — the EmailForge designer,
// rebuilt on our stack. Pick an offering preset (or write a free brief) + a
// visual style, generate a designed email, refine it with plain English, then
// send yourself a test or queue it into the Emails approval pipeline (the same
// review → approve → send-to-list flow the weekly drafts use).
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Palette, Loader2, Sparkles, Wand2, Send, Inbox, Copy, Download, Check,
  Monitor, Smartphone, Image as ImageIcon, X, Code, Eye, History, Layers, Images,
} from 'lucide-react';
import { Card, Badge, SectionLabel, btn } from './ui';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-studio`;
const SITE = 'https://regalosquecantan.com';
const GTS = 'https://giftsthatsing.com';

// Visual styles — must match the STYLES ids in supabase/functions/email-studio.
const STYLES = [
  { id: 'dark_luxury',       label: 'Dark Luxury',       blurb: 'Cinematic blacks, gold accents' },
  { id: 'warm_editorial',    label: 'Warm Editorial',    blurb: 'Magazine quality, terracotta & cream' },
  { id: 'bold_graphic',      label: 'Bold Graphic',      blurb: 'Electric contrast, studio energy' },
  { id: 'soft_premium',      label: 'Soft Premium',      blurb: 'Refined blush, elegant & airy' },
  { id: 'clean_modern',      label: 'Clean Modern',      blurb: 'Apple/Linear clarity' },
  { id: 'neon_retro',        label: 'Neon Retro',        blurb: 'Synthwave on deep purple' },
  { id: 'earthy_organic',    label: 'Earthy Organic',    blurb: 'Natural, warm greens' },
  { id: 'royal_deep',        label: 'Royal Deep',        blurb: 'Deep navy, commanding' },
  { id: 'vibrant_fiesta',    label: 'Cálido Fiesta',     blurb: 'Warm celebration, refined' },
  { id: 'minimal_zen',       label: 'Minimal Zen',       blurb: 'Ultra-minimal, serene' },
  { id: 'romantico_calido',  label: 'Romántico Cálido',  blurb: 'Sunset warmth, tender' },
  { id: 'midnight_serenade', label: 'Midnight Serenade', blurb: 'Moody indigo, musical' },
];

// Quick-start briefs, one per real offering (prices live in the server-side
// brand brief too — keep these consistent with _shared/brand-brief.ts).
const PRESETS = [
  {
    id: 'song', label: 'Personalized song', desc: 'The core $29.99 offer', styleId: 'dark_luxury', ctaUrl: SITE,
    brief: `Promo email for the core product: a personalized Spanish song ($29.99) written for ONE specific person, in their favorite genre (corrido, banda, norteño, bachata, mariachi, cumbia). Evergreen angle — "sorpréndelo/a un día cualquiera, sin razón". Lean hard on "Escúchala completa GRATIS antes de pagar" and "lista en ~3 minutos". CTA: create their song now.`,
  },
  {
    id: 'two_pack', label: '2-Pack', desc: '$39.99 — two songs', styleId: 'warm_editorial', ctaUrl: SITE,
    brief: `Promo email for the 2-Pack ($39.99): two personalized songs — perfect for "una para mamá y otra para papá" or for a couple. Angle: why choose one person when you can make two people cry of happiness. Show the savings vs two singles ($59.98). Risk reversal: listen free before paying.`,
  },
  {
    id: 'three_pack', label: '3-Pack', desc: '$49.99 — family bundle', styleId: 'royal_deep', ctaUrl: SITE,
    brief: `Promo email for the 3-Pack family bundle ($49.99): three personalized songs for the whole family. Angle: one gift that covers mamá, papá y los abuelos — the best value in the store. Listen free before paying, each song made for one specific person.`,
  },
  {
    id: 'video_addon', label: 'Video con foto', desc: '$9.99 — top add-on', styleId: 'romantico_calido', ctaUrl: SITE, segment: 'no_video',
    brief: `Promo email for the photo-video add-on ($9.99), our best-selling upgrade: it turns the song into an animated video with THEIR photos and a personal recorded message. Angle: "no solo le mandes una canción — mándale un recuerdo que va a guardar para siempre". Target: past customers who already know the songs.`,
  },
  {
    id: 'lyric_video', label: 'Video con letra', desc: '$9.99 — lyric video', styleId: 'midnight_serenade', ctaUrl: SITE,
    brief: `Promo email for the lyric video ($9.99): the song with its lyrics on screen, synchronized — made to share on WhatsApp so the whole family sings along. Angle: the version everyone asks for after they hear the song.`,
  },
  {
    id: 'karaoke', label: 'Instrumental', desc: '$7.99 — sing it yourself', styleId: 'vibrant_fiesta', ctaUrl: SITE,
    brief: `Promo email for the instrumental version ($7.99): the song without vocals, to sing it yourself at the party / karaoke. Angle: imagine dedicating it LIVE — you sing, everyone cries. Fun but premium.`,
  },
  {
    id: 'english', label: 'Gifts That Sing', desc: 'English platform', styleId: 'clean_modern', ctaUrl: GTS,
    brief: `Email pitched IN SPANISH to our list about our ENGLISH platform giftsthatsing.com: "for your English-speaking family and friends — gift a personalized song in English". Same process, listen free before paying, from $24.99. The CTA button must go to giftsthatsing.com.`,
  },
  {
    id: 'seasonal', label: 'Seasonal / holiday', desc: 'Date-driven push', styleId: 'soft_premium', ctaUrl: SITE,
    brief: `Seasonal promo email. OCCASION: [write the occasion here — e.g. "Día de las Madres in 12 days"]. Use the occasion's color story tastefully (never clip-art). Big emotional hook tied to the date, urgency line with the days left, core song $29.99, listen free before paying.`,
  },
  {
    id: 'winback', label: 'Win-back', desc: 'Re-engage past buyers', styleId: 'earthy_organic', ctaUrl: SITE, segment: 'winback',
    brief: `Warm win-back email for customers who bought a song a while ago. Angle: "la última canción hizo llorar a alguien — ¿quién sigue?". Remind them how easy it was (3 minutes, listen free before paying) and suggest the next person to surprise (mamá, su pareja, el compadre). No discounts — pure warmth and a nudge.`,
  },
];

const DEVICE_WIDTHS = { desktop: '100%', mobile: 390 };

// Platform-level failures (a wall-clock kill, a gateway error) come back as
// {code, message} with no `error` field. Without this the UI showed a generic
// "failed" and hid the one detail that explains what happened.
const errOf = (r, fallback) => r?.error || r?.message || (r?.code ? String(r.code) : '') || fallback;

// Audience segments — must match the enum in email-studio + the SQL filters in
// enqueue_marketing_recipients. "Everyone" is the default.
const SEGMENTS = [
  { id: 'all',          label: 'All buyers' },
  { id: 'buyers_7d',    label: 'Bought last 7 days' },
  { id: 'buyers_30d',   label: 'Bought last 30 days' },
  { id: 'recent',       label: 'Recent buyers (≤90 days)' },
  { id: 'winback',      label: 'Win-back (>90 days)' },
  { id: 'video_buyers', label: 'Video-addon buyers' },
  { id: 'no_video',     label: 'Bought song, never video' },
  { id: 'nonbuyers',    label: 'Non-buyers (started, never paid)' },
  { id: 'everyone_all', label: 'Everyone incl. non-buyers' },
];

export default function EmailStudioSection({ accessToken, showToast, initialDraft, onDraftConsumed }) {
  const [styleId, setStyleId] = useState(STYLES[0].id);
  const [styleNote, setStyleNote] = useState(''); // free-form color/theme override
  const [brief, setBrief] = useState('');
  const [presetId, setPresetId] = useState(null);
  const [ctaUrl, setCtaUrl] = useState(SITE);
  const [polish, setPolish] = useState(true);
  const [segment, setSegment] = useState('all');
  const [abTest, setAbTest] = useState(false);
  const [subjectB, setSubjectB] = useState('');

  const [imageUrl, setImageUrl] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const fileRef = useRef(null);

  // Designed banner hero (text-free photo + our typeset design layer) and the
  // gallery that feeds the photo-tile grid.
  const [bannerUrl, setBannerUrl] = useState('');
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bh, setBh] = useState({ headline: '', kicker: '', accent: '', sub: '', cta: '', align: 'center', prompt: '' });
  const [gallery, setGallery] = useState([]);
  const galleryRef = useRef(null);

  // The house photo library (creative-studio/photo-lab) — text-free shots the
  // ad lab already produced. Free to reuse; generating a new photo costs credits.
  const [library, setLibrary] = useState([]);
  const [libRole, setLibRole] = useState('');   // '' | 'hero' | 'tile'
  const [libBusy, setLibBusy] = useState(false);
  const [plan, setPlan] = useState(null);   // what auto-design chose, shown as chips

  const [html, setHtml] = useState('');
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [stage, setStage] = useState('');            // '', 'design', 'polish', 'refine'
  const [busy, setBusy] = useState(false);            // send/queue actions
  const [error, setError] = useState('');
  const [tab, setTab] = useState('preview');          // 'preview' | 'html'
  const [device, setDevice] = useState('desktop');
  const [refineText, setRefineText] = useState('');
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState([]);
  const [editingId, setEditingId] = useState(null); // set when editing an existing email_queue draft

  // "Edit in Studio" handoff from the Emails section: load the queued draft.
  useEffect(() => {
    if (!initialDraft) return;
    setHtml(initialDraft.html || '');
    setSubject(initialDraft.subject || '');
    setPreviewText(initialDraft.preview_text || '');
    setSegment(initialDraft.segment || 'all');
    setSubjectB(initialDraft.subject_b || '');
    setAbTest(!!initialDraft.subject_b);
    setEditingId(initialDraft.id || null);
    setTab('preview');
    onDraftConsumed?.();
  }, [initialDraft, onDraftConsumed]);

  const call = useCallback(async (payload) => {
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify(payload),
    });
    // Not every failure is JSON — a killed worker or a gateway error can return
    // plain text, and res.json() would throw a parse error that hides the cause.
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { return { success: false, error: `HTTP ${res.status}: ${text.slice(0, 200) || 'empty response'}` }; }
  }, [accessToken]);

  const pickPreset = (p) => {
    setPresetId(p.id);
    setBrief(p.brief);
    setStyleId(p.styleId);
    setCtaUrl(p.ctaUrl);
    setSegment(p.segment || 'all');
  };

  const pushHistory = (h, subj) => {
    setHistory((prev) => [{ ts: Date.now(), html: h, subject: subj, styleId }, ...prev].slice(0, 5));
  };

  const generate = async () => {
    if (!brief.trim()) { showToast?.('Write a brief first (or pick a preset)'); return; }
    setEditingId(null); // a fresh generate is a NEW email, not the queued draft
    setError(''); setStage('design'); setTab('preview');
    try {
      const r = await call({
        action: 'generate', brief, style_id: styleId, style_note: styleNote || undefined,
        image_url: imageUrl || undefined,
        banner_url: bannerUrl || undefined,
        image_urls: gallery.length ? gallery : undefined,
        cta_url: ctaUrl,
      });
      if (!r.success) throw new Error(errOf(r, 'Generation failed'));
      let out = r.html;
      setHtml(out); setSubject(r.subject || ''); setPreviewText(r.preview_text || '');
      if (polish) {
        setStage('polish');
        const r2 = await call({ action: 'improve', html: out, style_id: styleId, style_note: styleNote || undefined });
        if (r2.success && r2.html) { out = r2.html; setHtml(out); }
      }
      pushHistory(out, r.subject || '');
    } catch (e) { setError(e.message); showToast?.(`Error: ${e.message}`); }
    finally { setStage(''); }
  };

  const refine = async () => {
    if (!refineText.trim() || !html) return;
    setError(''); setStage('refine');
    try {
      const r = await call({ action: 'refine', html, instruction: refineText, style_id: styleId });
      if (!r.success) throw new Error(errOf(r, 'Refine failed'));
      setHtml(r.html); setRefineText(''); pushHistory(r.html, subject);
    } catch (e) { setError(e.message); showToast?.(`Error: ${e.message}`); }
    finally { setStage(''); }
  };

  const sendTestToMe = async () => {
    setBusy(true);
    try {
      const r = await call({ action: 'send_test', html, subject, preview_text: previewText, style_id: styleId });
      if (!r.success) throw new Error(errOf(r, 'Test failed'));
      showToast?.(`Test sent to ${r.sent_to}`);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusy(false); }
  };

  const queueEmail = async () => {
    if (!subject.trim()) { showToast?.('Give the email a subject first'); return; }
    if (abTest && !subjectB.trim()) { showToast?.('Add a second subject (B) or turn off the A/B test'); return; }
    const msg = editingId
      ? `Save your changes to "${subject}"? It stays in the Emails queue awaiting your approval.`
      : `Add "${subject}" to the Emails queue? It will wait there for your approval before anything is sent.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const r = await call({ action: 'queue', id: editingId || undefined, html, subject, subject_b: abTest ? subjectB : '', segment, preview_text: previewText, cta_url: ctaUrl, style_id: styleId });
      if (!r.success) throw new Error(errOf(r, 'Queue failed'));
      showToast?.(r.updated ? 'Draft updated — review it in the Emails section.' : 'Added to the Emails queue — open the Emails section to test & approve the send.');
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBusy(false); }
  };

  // Drop a ready hero image into the email already in the preview. The image is
  // otherwise only consumed by a full "Generate email"; without this, generating
  // or uploading a hero after an email exists leaves the preview unchanged
  // ("I don't see it applied"). A targeted refine inserts/replaces the hero
  // without redesigning the copy. No-op (just stages it) if no email yet.
  const applyHeroToEmail = async (url) => {
    if (!url || !html) return;
    setError(''); setStage('refine');
    try {
      const r = await call({
        action: 'refine', html, style_id: styleId,
        instruction: `Place this hosted hero image near the TOP of the email, full content width (about 600x400, rounded corners, descriptive alt text). If a hero image already exists, REPLACE its src with this one; otherwise insert it. Use EXACTLY this URL and change NOTHING else about the copy or layout: ${url}`,
      });
      if (!r.success) throw new Error(errOf(r, 'Could not apply the image'));
      setHtml(r.html); pushHistory(r.html, subject);
      showToast?.('Hero image added to the email.');
    } catch (e) { setError(e.message); showToast?.(`Error: ${e.message}`); }
    finally { setStage(''); }
  };

  const readDataUrl = (file) => new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => res(rd.result); rd.onerror = rej;
    rd.readAsDataURL(file);
  });

  const uploadImage = async (fileList) => {
    const f = Array.from(fileList || []).find((x) => x.type.startsWith('image/'));
    if (!f) return;
    setImageBusy(true);
    try {
      const dataUrl = await readDataUrl(f);
      const r = await call({ action: 'upload_image', image: dataUrl });
      if (!r.success) throw new Error(errOf(r, 'Upload failed'));
      setImageUrl(r.url);
      showToast?.(html ? 'Image hosted — applying it to the email…' : 'Image hosted — it will be used as the hero.');
      await applyHeroToEmail(r.url);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setImageBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const genImage = async () => {
    if (!imagePrompt.trim()) { showToast?.('Describe the image first'); return; }
    setImageBusy(true);
    try {
      const r = await call({ action: 'gen_image', prompt: imagePrompt });
      if (!r.success) throw new Error(errOf(r, 'Image generation failed'));
      setImageUrl(r.url);
      showToast?.(html ? 'Image generated — applying it to the email…' : 'Hero image generated.');
      await applyHeroToEmail(r.url);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setImageBusy(false); }
  };

  // A designed banner is the hero — it goes FULL-BLEED at the very top, edge to
  // edge, exactly like a premium DTC email. The live headline + button stay
  // underneath it so the email still sells when the inbox blocks images.
  const applyBannerToEmail = async (url) => {
    if (!url || !html) return;
    setError(''); setStage('refine');
    try {
      const r = await call({
        action: 'refine', html, style_id: styleId,
        instruction: `Place this hosted DESIGNED BANNER as the very first element under the brand header, FULL-BLEED: edge to edge, no side padding, no rounded corners, no border, wrapped in a link to the main CTA URL, as <img width="600" height="375" style="display:block;width:100%;max-width:600px;height:auto;border:0;">. Its alt text must repeat the banner headline: "${bh.headline.replace(/\|/g, ' ')}". If a hero image or banner already sits at the top, REPLACE it with this one. Keep a live HTML headline and a real CTA button directly beneath the banner. Change nothing else. Use EXACTLY this URL: ${url}`,
      });
      if (!r.success) throw new Error(errOf(r, 'Could not apply the banner'));
      setHtml(r.html); pushHistory(r.html, subject);
      showToast?.('Banner placed at the top of the email.');
    } catch (e) { setError(e.message); showToast?.(`Error: ${e.message}`); }
    finally { setStage(''); }
  };

  const makeBanner = async () => {
    if (!bh.headline.trim()) { showToast?.('Write the banner headline first'); return; }
    if (!imageUrl && !bh.prompt.trim()) { showToast?.('Add a hero photo above, or describe the photo for the banner'); return; }
    setBannerBusy(true);
    try {
      const r = await call({
        action: 'banner_hero', style_id: styleId,
        photo_url: imageUrl || undefined,
        prompt: imageUrl ? undefined : bh.prompt,
        headline: bh.headline, kicker: bh.kicker, accent: bh.accent, sub: bh.sub, cta: bh.cta, align: bh.align,
      });
      if (!r.success) throw new Error(errOf(r, 'Banner failed'));
      setBannerUrl(r.url);
      showToast?.(html ? 'Banner made — placing it in the email…' : 'Banner made — it becomes the hero when you Generate email.');
      await applyBannerToEmail(r.url);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setBannerBusy(false); }
  };

  // Extra photos for the tile grid / editorial splits. Uploaded one at a time so
  // a single oversized file can't fail the whole batch.
  const uploadGallery = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/')).slice(0, 6);
    if (!files.length) return;
    setImageBusy(true);
    let ok = 0, failed = 0;
    try {
      for (const f of files) {
        try {
          const r = await call({ action: 'upload_image', image: await readDataUrl(f), role: 'tile' });
          if (r.success) { setGallery((prev) => [...prev, r.url].slice(0, 6)); ok++; } else failed++;
        } catch { failed++; }
      }
      showToast?.(failed
        ? `${ok} image(s) added, ${failed} failed (max 4MB each).`
        : `${ok} image(s) added — they'll become photo tiles when you Generate email.`);
    } finally { setImageBusy(false); if (galleryRef.current) galleryRef.current.value = ''; }
  };

  // One-click: the brief is the only input. Runs as THREE requests on purpose —
  // plan+artwork, then design, then polish. Doing it in one invocation exceeded
  // the edge function's wall-clock limit, which comes back as a bare
  // {code, message} the app can't catch as an error.
  const autoDesign = async () => {
    if (!brief.trim()) { showToast?.('Pick an offering above, or write one line about the email'); return; }
    setEditingId(null);
    setError(''); setPlan(null); setStage('auto'); setTab('preview');
    try {
      const p = await call({ action: 'auto_plan', brief, cta_url: ctaUrl, style_note: styleNote || undefined });
      if (!p.success) throw new Error(errOf(p, 'Could not plan the email'));
      setPlan(p.plan || null);
      if (p.style_id) setStyleId(p.style_id);

      // One render per request — the platform kills an invocation that tries to
      // do the banner and the tile crops together.
      setStage('art');
      const b = p.hero?.banner || {};
      const bRes = await call({
        action: 'banner_hero', style_id: p.style_id,
        photo_url: p.hero?.url, focus: p.hero?.focus,
        headline: b.headline, kicker: b.kicker, accent: b.accent,
        sub: b.sub, cta: b.cta, align: b.align,
      });
      if (!bRes.success) throw new Error(errOf(bRes, 'Could not render the banner'));
      setBannerUrl(bRes.url);

      const tileUrls = [];
      for (const t of p.tiles || []) {
        const c = await call({ action: 'use_photo', url: t.url, role: 'tile', focus: t.focus });
        if (c.success && c.url) tileUrls.push(c.url);
      }
      if (tileUrls.length) setGallery(tileUrls);
      if ((p.tiles || []).length && !tileUrls.length) showToast?.('Tiles could not be prepared — building without the photo grid.');

      setStage('design');
      const r = await call({
        action: 'generate', brief: p.design_brief, style_id: p.style_id,
        style_note: styleNote || undefined, banner_url: bRes.url,
        image_urls: tileUrls.length ? tileUrls : undefined, cta_url: ctaUrl,
      });
      if (!r.success) throw new Error(errOf(r, 'Could not design the email'));
      let out = r.html;
      setHtml(out); setSubject(r.subject || ''); setPreviewText(r.preview_text || '');

      if (polish) {
        setStage('polish');
        const r2 = await call({ action: 'improve', html: out, style_id: p.style_id, style_note: styleNote || undefined });
        if (r2.success && r2.html) { out = r2.html; setHtml(out); }
      }
      pushHistory(out, r.subject || '');
      // First run with an uncatalogued library: describe the photos in the
      // background so the next auto-design picks from real descriptions.
      if (p.plan && p.plan.catalogued === false) runCatalog();
    } catch (e) { setError(e.message); showToast?.(`Error: ${e.message}`); }
    finally { setStage(''); }
  };

  // Best-effort, idempotent: only uncatalogued photos are sent, in batches.
  const runCatalog = useCallback(async () => {
    try {
      for (let i = 0; i < 15; i++) {
        const r = await call({ action: 'catalog_photos' });
        if (!r?.success || !r.remaining) break;
      }
    } catch { /* background nicety — never surfaced as an error */ }
  }, [call]);

  const openLibrary = async (role) => {
    setLibRole(role);
    if (library.length) return;
    setLibBusy(true);
    try {
      const r = await call({ action: 'list_photos', folder: 'photo-lab' });
      if (!r.success) throw new Error(errOf(r, 'Could not load the library'));
      setLibrary(r.photos || []);
    } catch (e) { showToast?.(`Error: ${e.message}`); setLibRole(''); }
    finally { setLibBusy(false); }
  };

  const pickPhoto = async (url) => {
    const role = libRole;
    setLibBusy(true);
    try {
      const r = await call({ action: 'use_photo', url, role });
      if (!r.success) throw new Error(errOf(r, 'Could not use that photo'));
      setLibRole('');
      if (role === 'tile') {
        setGallery((g) => [...g, r.url].slice(0, 6));
        showToast?.('Cropped to landscape and added as a tile.');
      } else {
        setImageUrl(r.url);
        showToast?.(html ? 'Hero photo set — applying it…' : 'Hero photo set.');
        await applyHeroToEmail(r.url);
      }
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLibBusy(false); }
  };

  const copyHtml = () => {
    navigator.clipboard.writeText(html);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const downloadHtml = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = `email-${styleId}.html`;
    a.click();
  };

  const generating = stage === 'design' || stage === 'polish' || stage === 'auto' || stage === 'art';
  const stageLabel = stage === 'auto' ? 'Choosing the style, photo & headline…'
    : stage === 'art' ? 'Making the banner & tiles…'
    : stage === 'design' ? 'Designing…'
    : stage === 'polish' ? 'Art-director polish…'
    : stage === 'refine' ? 'Applying your change…' : '';

  return (
    <div className="max-w-6xl">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <Palette size={18} className="text-indigo-600" /> Email Studio
        </h3>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Design a marketing email on demand for any offering. Generate, refine in plain English, send yourself a test —
          then add it to the Emails queue, where you approve it before it goes to your list.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* ---- LEFT: controls ---- */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4">
            <SectionLabel className="mb-2">Quick start — pick an offering</SectionLabel>
            <div className="grid grid-cols-3 gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => pickPreset(p)} title={p.desc}
                  className={`text-left px-2.5 py-2 rounded-lg border text-xs transition ${presetId === p.id ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  <span className="block font-medium truncate">{p.label}</span>
                  <span className="block text-[10px] text-gray-400 truncate">{p.desc}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <SectionLabel className="mb-2">The brief</SectionLabel>
            <textarea value={brief} onChange={(e) => { setBrief(e.target.value); setPresetId(null); }} rows={7}
              placeholder="What is this email selling, to whom, with what angle? Pick a preset above or write your own — the brand facts, prices and proof points are always built in."
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400 resize-y" />
            <p className="text-[11px] text-gray-400 mt-1.5">Your "This week's push" (top of Creative Studio) is factored in automatically.</p>

            <SectionLabel className="mt-3 mb-2">Visual style</SectionLabel>
            <select value={styleId} onChange={(e) => setStyleId(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400">
              {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label} — {s.blurb}</option>)}
            </select>

            <SectionLabel className="mt-3 mb-2">Color / theme override (optional)</SectionLabel>
            <input value={styleNote} onChange={(e) => setStyleNote(e.target.value)}
              placeholder='e.g. "4th of July — red, white & blue American colors, festive but premium"'
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400" />
            <p className="text-[11px] text-gray-400 mt-1.5">Overrides the style's colors — describe the palette or occasion in plain English. The style still controls the typography &amp; layout craft.</p>

            <SectionLabel className="mt-3 mb-2">Button link</SectionLabel>
            <input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400" />

            <label className="flex items-center gap-2 mt-3 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={polish} onChange={(e) => setPolish(e.target.checked)} className="accent-indigo-600" />
              Two-pass polish (art-director review after the first design — better, a bit slower)
            </label>
          </Card>

          <Card className="p-4">
            <SectionLabel className="mb-2">Hero image (optional)</SectionLabel>
            {imageUrl ? (
              <>
                <div className="relative">
                  <img src={imageUrl} alt="hero" className="w-full h-28 object-cover rounded-lg border border-gray-200" />
                  <button onClick={() => setImageUrl('')} className="absolute top-1.5 right-1.5 bg-white/90 rounded-full p-1 text-gray-500 hover:text-gray-800">
                    <X size={14} />
                  </button>
                </div>
                {html ? (
                  <button onClick={() => applyHeroToEmail(imageUrl)} disabled={!!stage || imageBusy} className={btn.ghost + ' w-full mt-2'}>
                    {stage === 'refine' ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />} Add to current email
                  </button>
                ) : (
                  <p className="text-[11px] text-gray-400 mt-2">Will be placed as the hero when you Generate email.</p>
                )}
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <button onClick={() => openLibrary('hero')} disabled={imageBusy || libBusy} className={btn.ghost + ' flex-1'}>
                    {libBusy && libRole === 'hero' ? <Loader2 size={15} className="animate-spin" /> : <Images size={15} />} Photo library
                  </button>
                  <button onClick={() => fileRef.current?.click()} disabled={imageBusy} className={btn.ghost + ' flex-1'}>
                    {imageBusy ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />} Upload
                  </button>
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadImage(e.target.files)} />
                <div className="flex gap-2 mt-2">
                  <input value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)}
                    placeholder="…or describe an AI photo (uses image credits)"
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400" />
                  <button onClick={genImage} disabled={imageBusy || !imagePrompt.trim()} className={btn.ghost}>
                    {imageBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  </button>
                </div>
              </>
            )}
          </Card>

          {/* Designed banner: a text-free photo + our own typeset layer, in the
              chosen style's accent color. This is the full-bleed premium hero. */}
          <Card className="p-4">
            <SectionLabel className="mb-2 flex items-center gap-1.5"><Layers size={12} /> Designed banner hero</SectionLabel>
            {bannerUrl ? (
              <>
                <div className="relative">
                  <img src={bannerUrl} alt="designed banner" className="w-full rounded-lg border border-gray-200" />
                  <button onClick={() => setBannerUrl('')} className="absolute top-1.5 right-1.5 bg-white/90 rounded-full p-1 text-gray-500 hover:text-gray-800">
                    <X size={14} />
                  </button>
                </div>
                {html ? (
                  <button onClick={() => applyBannerToEmail(bannerUrl)} disabled={!!stage || bannerBusy} className={btn.ghost + ' w-full mt-2'}>
                    {stage === 'refine' ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />} Place at top of email
                  </button>
                ) : (
                  <p className="text-[11px] text-gray-400 mt-2">Becomes the full-bleed hero when you Generate email.</p>
                )}
              </>
            ) : (
              <>
                <input value={bh.headline} onChange={(e) => setBh({ ...bh, headline: e.target.value })}
                  placeholder='Banner headline — use "|" for a line break'
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400" />
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input value={bh.kicker} onChange={(e) => setBh({ ...bh, kicker: e.target.value })} placeholder="Kicker (small caps)"
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400" />
                  <input value={bh.accent} onChange={(e) => setBh({ ...bh, accent: e.target.value })} placeholder="Word to accent"
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400" />
                </div>
                <input value={bh.sub} onChange={(e) => setBh({ ...bh, sub: e.target.value })} placeholder="Small line under the headline (optional)"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400 mt-2" />
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input value={bh.cta} onChange={(e) => setBh({ ...bh, cta: e.target.value })} placeholder="Pill text (optional)"
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400" />
                  <select value={bh.align} onChange={(e) => setBh({ ...bh, align: e.target.value })}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400">
                    <option value="center">Centered</option>
                    <option value="left">Left-aligned</option>
                  </select>
                </div>
                {!imageUrl && (
                  <input value={bh.prompt} onChange={(e) => setBh({ ...bh, prompt: e.target.value })}
                    placeholder="Describe the photo (uses image credits)"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400 mt-2" />
                )}
                <p className="text-[11px] text-gray-400 mt-2">
                  {imageUrl
                    ? 'Uses the hero image above as the photo, with the headline typeset on top in your style’s accent color.'
                    : 'No hero image staged — describe the photo and we generate a text-free one, then typeset the headline on it.'}
                </p>
                <button onClick={makeBanner} disabled={bannerBusy || !!stage || !bh.headline.trim()} className={btn.ghost + ' w-full mt-2'}>
                  {bannerBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Make designed banner
                </button>
              </>
            )}
          </Card>

          {/* Extra photos → the "explora por estilo" tile grid. */}
          <Card className="p-4">
            <SectionLabel className="mb-2">Photo tiles (optional)</SectionLabel>
            {gallery.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                {gallery.map((u, i) => (
                  <div key={u} className="relative">
                    <img src={u} alt={`tile ${i + 1}`} className="w-full h-16 object-cover rounded-md border border-gray-200" />
                    <button onClick={() => setGallery((g) => g.filter((x) => x !== u))}
                      className="absolute top-0.5 right-0.5 bg-white/90 rounded-full p-0.5 text-gray-500 hover:text-gray-800">
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => openLibrary('tile')} disabled={imageBusy || libBusy || gallery.length >= 6} className={btn.ghost + ' flex-1'}>
                {libBusy && libRole === 'tile' ? <Loader2 size={15} className="animate-spin" /> : <Images size={15} />} Library
              </button>
              <button onClick={() => galleryRef.current?.click()} disabled={imageBusy || gallery.length >= 6} className={btn.ghost + ' flex-1'}>
                {imageBusy ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />} Upload ({gallery.length}/6)
              </button>
            </div>
            <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => uploadGallery(e.target.files)} />
            <p className="text-[11px] text-gray-400 mt-2">Become the "explora por estilo" photo grid and editorial splits. Cropped to landscape automatically — Outlook squashes uncropped portraits.</p>
          </Card>

          {/* House photo library — free to reuse, already art-directed. */}
          {libRole && (
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <SectionLabel className="flex items-center gap-1.5"><Images size={12} /> Photo library</SectionLabel>
                <span className="text-[11px] text-gray-400">{libRole === 'tile' ? '— adds a cropped tile' : '— sets the hero'}</span>
                <button onClick={() => setLibRole('')} className="ml-auto text-gray-400 hover:text-gray-700"><X size={14} /></button>
              </div>
              {libBusy && !library.length ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
                  <Loader2 size={15} className="animate-spin" /> Loading the library…
                </div>
              ) : library.length ? (
                <div className="grid grid-cols-3 gap-1.5 max-h-72 overflow-y-auto">
                  {library.map((p) => (
                    <button key={p.url} onClick={() => pickPhoto(p.url)} disabled={libBusy} title={p.name}
                      className="relative group rounded-md overflow-hidden border border-gray-200 hover:border-indigo-400 focus:outline-none focus:border-indigo-500 disabled:opacity-50">
                      <img src={p.url} alt={p.name} loading="lazy" className="w-full h-20 object-cover" />
                      <span className="block text-[10px] text-gray-500 truncate px-1 py-0.5 bg-white">{p.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-gray-400 py-4 text-center">No photos found in the library.</p>
              )}
            </Card>
          )}

          <div className="space-y-2">
            <button onClick={autoDesign} disabled={!!stage || !brief.trim()} className={btn.accent + ' w-full !py-3'}>
              {generating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
              {generating ? stageLabel : 'Design it for me'}
            </button>
            <p className="text-[11px] text-gray-400 text-center">
              Picks the style, the photo, the banner headline and the tiles from your brief — then builds the whole email.
            </p>
            <button onClick={generate} disabled={generating || !!stage || !brief.trim()} className={btn.ghost + ' w-full'}>
              {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {generating ? stageLabel : 'Generate from my settings instead'}
            </button>
          </div>

          {plan && (
            <Card className="p-4">
              <SectionLabel className="mb-2">What it chose</SectionLabel>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className="text-[11px] px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">{plan.style_name}</span>
                <span className="text-[11px] px-2 py-1 rounded-md bg-gray-50 text-gray-600 border border-gray-200">{plan.hero_label}</span>
                {plan.tiles?.map((t) => (
                  <span key={t.path} className="text-[11px] px-2 py-1 rounded-md bg-gray-50 text-gray-600 border border-gray-200">tile · {t.title}</span>
                ))}
              </div>
              <p className="text-xs text-gray-700 leading-relaxed">
                “{String(plan.banner?.headline || '').replace(/\s*\|\s*/g, ' ')}”
              </p>
              {plan.banner?.kicker && <p className="text-[11px] text-gray-400 mt-1">Kicker: {plan.banner.kicker}</p>}
              <button onClick={autoDesign} disabled={!!stage} className={btn.ghost + ' w-full mt-3'}>
                {stage === 'auto' ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Try a different take
              </button>
            </Card>
          )}

          {history.length > 1 && (
            <Card className="p-4">
              <SectionLabel className="mb-2 flex items-center gap-1.5"><History size={12} /> Recent versions</SectionLabel>
              <div className="space-y-1.5">
                {history.map((h, i) => (
                  <button key={h.ts} onClick={() => { setHtml(h.html); setTab('preview'); }}
                    className="w-full text-left text-xs text-gray-600 hover:text-gray-900 truncate">
                    {i === 0 ? '• Current' : `• ${new Date(h.ts).toLocaleTimeString()}`} — {h.subject || '(no subject)'}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ---- RIGHT: preview + actions ---- */}
        <div className="lg:col-span-3 space-y-3">
          {html ? (
            <>
              {editingId && (
                <div className="flex items-center gap-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                  <Palette size={13} /> Editing a queued draft — "Save changes" updates it in the Emails queue.
                  <button onClick={() => setEditingId(null)} className="ml-auto text-indigo-400 hover:text-indigo-700" title="Detach — save as a new email instead">
                    <X size={13} />
                  </button>
                </div>
              )}
              <Card className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <SectionLabel className="w-14 flex-shrink-0">Subject</SectionLabel>
                  <input value={subject} onChange={(e) => setSubject(e.target.value)}
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-800 bg-white focus:outline-none focus:border-indigo-400" />
                </div>
                <div className="flex items-center gap-2">
                  <SectionLabel className="w-14 flex-shrink-0">Preview</SectionLabel>
                  <input value={previewText} onChange={(e) => setPreviewText(e.target.value)} placeholder="Inbox preview text"
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 bg-white focus:outline-none focus:border-indigo-400" />
                </div>
                <label className="flex items-center gap-2 mt-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={abTest} onChange={(e) => setAbTest(e.target.checked)} className="accent-indigo-600" />
                  A/B test the subject — half your list gets B; the Results tab shows the winner
                </label>
                {abTest && (
                  <div className="flex items-center gap-2 mt-2">
                    <SectionLabel className="w-14 flex-shrink-0">Subject B</SectionLabel>
                    <input value={subjectB} onChange={(e) => setSubjectB(e.target.value)} placeholder="Second subject line to test"
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-800 bg-white focus:outline-none focus:border-indigo-400" />
                  </div>
                )}
              </Card>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                  {[['preview', 'Preview', Eye], ['html', 'HTML', Code]].map(([k, label, Icon]) => (
                    <button key={k} onClick={() => setTab(k)}
                      className={`inline-flex items-center gap-1 px-3 py-1 text-xs rounded-md transition ${tab === k ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500'}`}>
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>
                {tab === 'preview' && (
                  <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                    {[['desktop', Monitor], ['mobile', Smartphone]].map(([k, Icon]) => (
                      <button key={k} onClick={() => setDevice(k)}
                        className={`px-2.5 py-1 rounded-md transition ${device === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400'}`}>
                        <Icon size={14} />
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex-1" />
                <button onClick={copyHtml} className={btn.ghost + ' !px-3 !py-1.5 !text-xs'}>
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy HTML'}
                </button>
                <button onClick={downloadHtml} className={btn.ghost + ' !px-3 !py-1.5 !text-xs'}>
                  <Download size={13} /> Download
                </button>
              </div>

              {tab === 'preview' ? (
                <div className="flex justify-center bg-gray-50 border border-gray-200 rounded-xl p-3 relative">
                  {stage && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 rounded-xl">
                      <span className="flex items-center gap-2 text-sm text-gray-600"><Loader2 size={16} className="animate-spin" /> {stageLabel}</span>
                    </div>
                  )}
                  <iframe title="email preview" srcDoc={html.replace(/\{\{UNSUB_URL\}\}/g, '#')}
                    className="bg-white border border-gray-200 rounded-lg transition-all"
                    style={{ width: DEVICE_WIDTHS[device], maxWidth: '100%', height: 620 }} />
                </div>
              ) : (
                <textarea readOnly value={html} className="w-full h-[620px] text-[11px] font-mono border border-gray-200 rounded-xl p-3 text-gray-600 bg-gray-50 resize-none" />
              )}

              <div className="flex gap-2">
                <input value={refineText} onChange={(e) => setRefineText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') refine(); }}
                  placeholder='Refine in plain English — e.g. "make the headline bigger and the hero warmer"'
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400" />
                <button onClick={refine} disabled={!!stage || !refineText.trim()} className={btn.primary}>
                  {stage === 'refine' ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Refine
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <label className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="whitespace-nowrap">Send to</span>
                  <select value={segment} onChange={(e) => setSegment(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white focus:outline-none focus:border-indigo-400">
                    {SEGMENTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
                <button onClick={sendTestToMe} disabled={busy || !!stage} className={btn.ghost}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send test to me
                </button>
                <button onClick={queueEmail} disabled={busy || !!stage} className={btn.success}>
                  <Inbox size={15} /> {editingId ? 'Save changes to queue' : 'Add to Emails queue'}
                </button>
                <span className="text-[11px] text-gray-400">Nothing goes to your list until you approve it in the Emails section.</span>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-center border border-dashed border-gray-200 rounded-xl py-24 px-8">
              {generating ? (
                <>
                  <Loader2 size={22} className="animate-spin text-indigo-500 mb-3" />
                  <p className="text-sm text-gray-600">{stageLabel}</p>
                  <p className="text-xs text-gray-400 mt-1">Usually 30–90 seconds{polish ? ' per pass' : ''}.</p>
                </>
              ) : (
                <>
                  <Palette size={22} className="text-gray-300 mb-3" />
                  <p className="text-sm text-gray-500 max-w-sm">
                    Pick an offering preset (or write one line) and hit <span className="font-medium text-gray-700">Design it for me</span>.
                    It chooses the style, the photo, the banner headline and the tiles — your brand facts, prices and proof points are baked in.
                  </p>
                </>
              )}
              {error && <Badge tone="red" className="mt-4">{error}</Badge>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
