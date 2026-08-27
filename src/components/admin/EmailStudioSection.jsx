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
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { Card, Badge, SectionLabel, btn } from './ui';
import EmailBrainstormPanel from './EmailBrainstormPanel';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-studio`;
const SITE = 'https://regalosquecantan.com';
const GTS = 'https://giftsthatsing.com';

// Animado stills — real customer frames, already live on our own CDN (the www
// host is canonical; the apex 307-redirects, and some inbox image proxies won't
// follow that). They are 9:16 PORTRAIT, so they go to the designer as a POSTER
// ROW, never as a banner or a landscape tile: cropping a 420x747 still to the
// 540x392 tile throws away the face and upscales what's left into mush.
const CDN = 'https://www.regalosquecantan.com';
const ANIMADO_POSTERS = [
  { url: `${CDN}/images/paquete/animado-poster-6.jpg`, label: 'Para mamá', w: 9, h: 16 },
  { url: `${CDN}/images/paquete/animado-poster-7.jpg`, label: 'Padre e hija', w: 9, h: 16 },
  { url: `${CDN}/images/paquete/animado-poster-1.jpg`, label: 'En familia', w: 9, h: 16 },
];

// Library folders. 'animado-likeness' holds the Pixar renders of REAL customers
// lifted out of story-video-assets — kept OUT of photo-lab on purpose, because
// photo-lab is what auto-design draws from unattended.
const LIB_FOLDERS = [
  { id: 'photo-lab', label: 'House photos' },
  { id: 'animado-likeness', label: 'Animado faces' },
];

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
    id: 'three_pack', label: '3-Pack', desc: '$59.98 — paga 2, la 3ª gratis', styleId: 'royal_deep', ctaUrl: SITE,
    brief: `Promo email for the 3-Pack ($59.98 — pay for 2 songs at $29.99, the 3rd is FREE): three personalized songs for the whole family. Angle: one gift that covers mamá, papá y los abuelos — la tercera va gratis. Listen free before paying, each song made for one specific person.`,
  },
  {
    id: 'animado', label: 'Canción + Animado', desc: '$59.99 — película animada', styleId: 'midnight_serenade', ctaUrl: SITE,
    posters: ANIMADO_POSTERS,
    brief: `Promo email for the CANCIÓN + ANIMADO bundle ($59.99) — our most emotional offer, sold as ONE gift instead of an add-on. What it is: we take a real photo of the person, turn them into an animated character, and build a short animated MOVIE of their story set to their own personalized song. Angle: "no solo va a escuchar su canción — se va a VER en ella". Lead with the reveal moment: the face when they recognize themselves on screen. Use the poster row of real customer stills as the proof that this is real. Anchor the price: the song alone is $29.99, so the movie is the part that turns a gift into a keepsake. Keep the proof points — escúchala completa GRATIS antes de pagar, lista en ~3 minutos. CTA: create the song and add the animated movie.`,
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

// Everything you were working on survives a refresh, a closed tab, or a switch
// to another Creative Studio view (this component unmounts on every view
// switch — before this, that silently threw away the whole session, including
// a queued draft opened via "Edit in Studio").
const STORAGE_KEY = 'rqc_email_studio_state_v1';
const loadSaved = () => {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return s && typeof s === 'object' ? s : null;
  } catch { return null; }
};
const EMPTY_BH = { headline: '', kicker: '', accent: '', sub: '', cta: '', align: 'center', prompt: '' };

// The three real stages of making a campaign, numbered because they ARE a
// sequence: idea -> design -> review & send.
const StepLabel = ({ n, title, hint }) => (
  <div className="flex items-center gap-2 pt-1">
    <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-semibold flex items-center justify-center flex-shrink-0">{n}</span>
    <span className="text-sm font-semibold text-gray-800">{title}</span>
    {hint && <span className="text-[11px] text-gray-400 truncate">{hint}</span>}
  </div>
);

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
  // Read once per mount; each field below falls back to its normal default.
  const [saved] = useState(loadSaved);
  const [styleId, setStyleId] = useState(saved?.styleId || STYLES[0].id);
  const [styleNote, setStyleNote] = useState(saved?.styleNote || ''); // free-form color/theme override
  const [brief, setBrief] = useState(saved?.brief || '');
  const [presetId, setPresetId] = useState(saved?.presetId ?? null);
  const [ctaUrl, setCtaUrl] = useState(saved?.ctaUrl || SITE);
  const [polish, setPolish] = useState(saved?.polish ?? true);
  const [segment, setSegment] = useState(saved?.segment || 'all');
  const [abTest, setAbTest] = useState(saved?.abTest ?? false);
  const [subjectB, setSubjectB] = useState(saved?.subjectB || '');
  const [subjOpts, setSubjOpts] = useState([]); // subject-coach candidates
  const [subjBusy, setSubjBusy] = useState(false);
  // The art tools (hero / banner / posters / tiles) fold away until needed —
  // open by default only when something is already staged.
  const [showArt, setShowArt] = useState(
    !!(saved?.imageUrl || saved?.bannerUrl || (saved?.posters || []).length || (saved?.gallery || []).length)
  );

  const [imageUrl, setImageUrl] = useState(saved?.imageUrl || '');
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const fileRef = useRef(null);

  // Designed banner hero (text-free photo + our typeset design layer) and the
  // gallery that feeds the photo-tile grid.
  const [bannerUrl, setBannerUrl] = useState(saved?.bannerUrl || '');
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bh, setBh] = useState(saved?.bh || EMPTY_BH);
  const [gallery, setGallery] = useState(saved?.gallery || []);
  const galleryRef = useRef(null);
  // Portrait 9:16 stills (Animado frames) — kept apart from `gallery` because
  // they must reach the designer uncropped, as a poster row.
  const [posters, setPosters] = useState(saved?.posters || []);

  // The house photo library (creative-studio/photo-lab) — text-free shots the
  // ad lab already produced. Free to reuse; generating a new photo costs credits.
  const [library, setLibrary] = useState([]);
  const [libRole, setLibRole] = useState('');   // '' | 'hero' | 'tile' | 'poster'
  const [libBusy, setLibBusy] = useState(false);
  const [libFolder, setLibFolder] = useState('photo-lab');
  const [libCache, setLibCache] = useState({}); // folder -> photos[], so switching tabs is instant
  const [plan, setPlan] = useState(saved?.plan ?? null);   // what auto-design chose, shown as chips

  const [html, setHtml] = useState(saved?.html || '');
  const [subject, setSubject] = useState(saved?.subject || '');
  const [previewText, setPreviewText] = useState(saved?.previewText || '');
  const [stage, setStage] = useState('');            // '', 'design', 'polish', 'refine'
  const [busy, setBusy] = useState(false);            // send/queue actions
  const [error, setError] = useState('');
  const [tab, setTab] = useState('preview');          // 'preview' | 'html'
  const [device, setDevice] = useState('desktop');
  const [refineText, setRefineText] = useState('');
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState(saved?.history || []);
  const [editingId, setEditingId] = useState(saved?.editingId ?? null); // set when editing an existing email_queue draft

  // "Edit in Studio" handoff from the Emails section: load the queued draft.
  // Runs after the restore above, so an explicit handoff always wins over a
  // restored session.
  useEffect(() => {
    if (!initialDraft) return;
    setHtml(initialDraft.html || '');
    setSubject(initialDraft.subject || '');
    setPreviewText(initialDraft.preview_text || '');
    setSegment(initialDraft.segment || 'all');
    setSubjectB(initialDraft.subject_b || '');
    setAbTest(!!initialDraft.subject_b);
    if (initialDraft.cta_url) setCtaUrl(initialDraft.cta_url);
    setEditingId(initialDraft.id || null);
    setTab('preview');
    onDraftConsumed?.();
  }, [initialDraft, onDraftConsumed]);

  // Autosave the working session (debounced). Quota/blocked storage is
  // non-fatal — the studio just behaves like before.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          presetId, brief, styleId, styleNote, ctaUrl, polish, segment, abTest, subjectB,
          imageUrl, bannerUrl, bh, gallery, posters, plan,
          html, subject, previewText, editingId,
          history: history.slice(0, 3),
        }));
      } catch { /* storage full or blocked — non-fatal */ }
    }, 400);
    return () => clearTimeout(t);
  }, [presetId, brief, styleId, styleNote, ctaUrl, polish, segment, abTest, subjectB,
      imageUrl, bannerUrl, bh, gallery, posters, plan, html, subject, previewText, editingId, history]);

  const startFresh = () => {
    if ((html || brief) && !window.confirm('Clear the studio and start a fresh email? Drafts already saved to the Emails queue are not affected.')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setPresetId(null); setBrief(''); setStyleId(STYLES[0].id); setStyleNote(''); setCtaUrl(SITE);
    setSegment('all'); setAbTest(false); setSubjectB(''); setImageUrl(''); setImagePrompt('');
    setBannerUrl(''); setBh(EMPTY_BH); setGallery([]); setPosters([]); setPlan(null);
    setHtml(''); setSubject(''); setPreviewText(''); setEditingId(null); setHistory([]);
    setError(''); setRefineText('');
  };

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
    setPosters(p.posters || []);
    if (p.posters?.length) setShowArt(true); // staged posters shouldn't hide in a folded panel
  };

  // Hook options for the subject line — pick one as A, one more click A/Bs it.
  const suggestSubjects = async () => {
    if (!brief.trim() && !subject.trim()) { showToast?.('Write a brief or generate the email first'); return; }
    setSubjBusy(true);
    try {
      const r = await call({ action: 'suggest_subjects', brief, subject });
      if (!r.success) throw new Error(errOf(r, 'Could not suggest subjects'));
      setSubjOpts(r.subjects || []);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setSubjBusy(false); }
  };

  // The strategist agreed a brief — drop it into the form. Nothing generates or
  // sends here; this only fills the same boxes you'd fill by hand.
  const applyBrief = useCallback((b) => {
    if (!b) return;
    setPresetId(null);
    setBrief(b.brief || '');
    if (b.style_id) setStyleId(b.style_id);
    setStyleNote((b.style_note || '').toString());
    if (b.cta_url) setCtaUrl(b.cta_url);
    if (b.segment) setSegment(b.segment);
    setPlan(null);
    // If the agreed idea is the Animado bundle, stage the real customer stills
    // so the email actually SHOWS the thing it's selling.
    const wantPosters = /animado/i.test(`${b.label || ''} ${b.brief || ''}`);
    setPosters(wantPosters ? ANIMADO_POSTERS : []);
    if (wantPosters) setShowArt(true);
  }, []);

  const pushHistory = (h, subj) => {
    setHistory((prev) => [{ ts: Date.now(), html: h, subject: subj, styleId }, ...prev].slice(0, 5));
  };

  // Editing a queued draft? Generating builds a NEW email — warn before the
  // silent detach that used to make a "fix" quietly land nowhere.
  const confirmDetach = () => !editingId
    || window.confirm('You are editing a queued draft. Generating builds a NEW email and detaches from that draft — the version in the Emails queue stays as it is. Continue?');

  const generate = async () => {
    if (!brief.trim()) { showToast?.('Write a brief first (or pick a preset)'); return; }
    if (!confirmDetach()) return;
    setEditingId(null); // a fresh generate is a NEW email, not the queued draft
    setError(''); setStage('design'); setTab('preview');
    try {
      const r = await call({
        action: 'generate', brief, style_id: styleId, style_note: styleNote || undefined,
        image_url: imageUrl || undefined,
        banner_url: bannerUrl || undefined,
        image_urls: gallery.length ? gallery : undefined,
        posters: posters.length ? posters : undefined,
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

  // Same concept, different look. Picking a new style while an email is on
  // screen used to do nothing (the dropdown only fed the NEXT generate, and
  // "Design it for me" even overrode it) — now it re-skins the current email:
  // copy, photos and links stay identical, only the visual system changes.
  const restyleEmail = async (newStyleId) => {
    const s = STYLES.find((x) => x.id === newStyleId);
    setError(''); setStage('restyle');
    try {
      const r = await call({ action: 'restyle', html, style_id: newStyleId, style_note: styleNote || undefined });
      if (!r.success) throw new Error(errOf(r, 'Restyle failed'));
      setHtml(r.html); pushHistory(r.html, subject);
      showToast?.(`Restyled to ${s?.label || newStyleId} — flip back anytime in Recent versions.`);
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
      // Adopt the queued row: further saves update it instead of inserting a duplicate.
      if (r.id) setEditingId(r.id);
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
  // `o` lets a caller (the strategist's "Design it now") drive a run from a brief
  // it just handed us, without waiting a render for the state to settle.
  const autoDesign = async (o = {}) => {
    const runBrief = (o.brief ?? brief).toString();
    const runCta = (o.ctaUrl ?? ctaUrl).toString();
    const runNote = (o.styleNote ?? styleNote).toString();
    const runPosters = o.posters ?? posters;
    if (!runBrief.trim()) { showToast?.('Pick an offering above, or write one line about the email'); return; }
    if (!confirmDetach()) return;
    setEditingId(null);
    setError(''); setPlan(null); setStage('auto'); setTab('preview');
    try {
      const p = await call({ action: 'auto_plan', brief: runBrief, cta_url: runCta, style_note: runNote || undefined });
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
        style_note: runNote || undefined, banner_url: bRes.url,
        image_urls: tileUrls.length ? tileUrls : undefined,
        posters: runPosters.length ? runPosters : undefined,
        cta_url: runCta,
      });
      if (!r.success) throw new Error(errOf(r, 'Could not design the email'));
      let out = r.html;
      setHtml(out); setSubject(r.subject || ''); setPreviewText(r.preview_text || '');

      if (polish) {
        setStage('polish');
        const r2 = await call({ action: 'improve', html: out, style_id: p.style_id, style_note: runNote || undefined });
        if (r2.success && r2.html) { out = r2.html; setHtml(out); }
      }
      pushHistory(out, r.subject || '');
      // First run with an uncatalogued library: describe the photos in the
      // background so the next auto-design picks from real descriptions.
      if (p.plan && p.plan.catalogued === false) runCatalog();
    } catch (e) { setError(e.message); showToast?.(`Error: ${e.message}`); }
    finally { setStage(''); }
  };

  // The strategist's "Design it now": fill the form AND run it in one click,
  // passing the brief through directly so we don't race React's state update.
  const designFromBrief = (b) => {
    if (!b?.brief) return;
    applyBrief(b);
    autoDesign({
      brief: b.brief,
      ctaUrl: b.cta_url || SITE,
      styleNote: b.style_note || '',
      posters: /animado/i.test(`${b.label || ''} ${b.brief || ''}`) ? ANIMADO_POSTERS : [],
    });
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

  const loadFolder = useCallback(async (folder) => {
    setLibFolder(folder);
    if (libCache[folder]) { setLibrary(libCache[folder]); return; }
    setLibBusy(true);
    try {
      const r = await call({ action: 'list_photos', folder });
      if (!r.success) throw new Error(errOf(r, 'Could not load the library'));
      const photos = r.photos || [];
      setLibCache((c) => ({ ...c, [folder]: photos }));
      setLibrary(photos);
    } catch (e) { showToast?.(`Error: ${e.message}`); }
    finally { setLibBusy(false); }
  }, [call, libCache, showToast]);

  // A poster pick opens straight into the Animado faces folder — that's the only
  // folder whose contents belong in a poster row.
  const openLibrary = (role) => {
    setLibRole(role);
    loadFolder(role === 'poster' ? 'animado-likeness' : libFolder);
  };

  const pickPhoto = async (url, name) => {
    const role = libRole;
    setLibBusy(true);
    try {
      const r = await call({ action: 'use_photo', url, role });
      if (!r.success) throw new Error(errOf(r, 'Could not use that photo'));
      setLibRole('');
      if (role === 'poster') {
        setPosters((ps) => [...ps, { url: r.url, label: '', w: r.w, h: r.h }].slice(0, 4));
        showToast?.('Added to the poster row — kept portrait, not cropped.');
      } else if (role === 'tile') {
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

  const artCount = (imageUrl ? 1 : 0) + (bannerUrl ? 1 : 0) + posters.length + gallery.length;
  const generating = stage === 'design' || stage === 'polish' || stage === 'auto' || stage === 'art';
  const stageLabel = stage === 'auto' ? 'Choosing the style, photo & headline…'
    : stage === 'art' ? 'Making the banner & tiles…'
    : stage === 'design' ? 'Designing…'
    : stage === 'polish' ? 'Art-director polish…'
    : stage === 'restyle' ? 'Re-styling — same email, new look…'
    : stage === 'refine' ? 'Applying your change…' : '';

  return (
    <div className="max-w-6xl">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Palette size={18} className="text-indigo-600" /> Email Studio
          </h3>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Design a marketing email on demand for any offering. Generate, refine in plain English, send yourself a test —
            then add it to the Emails queue, where you approve it before it goes to your list.
            Your work saves automatically — it survives a refresh or switching tabs.
          </p>
        </div>
        {(html || brief) && (
          <button onClick={startFresh} disabled={!!stage || busy} className={btn.ghost + ' whitespace-nowrap'} title="Clear the studio and start a new email">
            <X size={15} /> Start fresh
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* ---- LEFT: controls ---- */}
        <div className="lg:col-span-2 space-y-4">
          <StepLabel n={1} title="The idea" hint="what you're selling & the angle" />
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

          <EmailBrainstormPanel
            accessToken={accessToken}
            showToast={showToast}
            onUseBrief={applyBrief}
            onDesignNow={designFromBrief}
            busy={!!stage}
          />

          <Card className="p-4">
            <SectionLabel className="mb-2">The brief</SectionLabel>
            <textarea value={brief} onChange={(e) => { setBrief(e.target.value); setPresetId(null); }} rows={7}
              placeholder="What is this email selling, to whom, with what angle? Pick a preset above or write your own — the brand facts, prices and proof points are always built in."
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400 resize-y" />
            <p className="text-[11px] text-gray-400 mt-1.5">Your "This week's push" (top of Creative Studio) is factored in automatically.</p>
          </Card>

          <StepLabel n={2} title="The look" hint="style, colors & photos" />
          <Card className="p-4">
            <SectionLabel className="mb-2">Visual style</SectionLabel>
            <select value={styleId} disabled={!!stage}
              onChange={(e) => { const v = e.target.value; setStyleId(v); if (html) restyleEmail(v); }}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:border-indigo-400 disabled:opacity-50">
              {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label} — {s.blurb}</option>)}
            </select>
            {html && (
              <p className="text-[11px] text-gray-400 mt-1.5">
                Picking a different style re-skins the email on screen — same copy &amp; photos, new look. Undo via Recent versions.
              </p>
            )}

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

          <button onClick={() => setShowArt((v) => !v)} className={btn.ghost + ' w-full'}>
            {showArt ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            Photos &amp; banner{artCount ? ` · ${artCount} staged` : ' (optional)'}
          </button>
          {showArt && (<>
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

          {/* Portrait 9:16 stills — the Animado proof row. Staged by the Animado
              preset (or by an agreed Animado brief), shown here so you can see
              exactly which frames the email will carry, and drop any of them. */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <SectionLabel className="flex items-center gap-1.5"><Images size={12} /> Animado poster row</SectionLabel>
              <span className="text-[11px] text-gray-400">— portrait stills</span>
              {posters.length > 0 && (
                <button onClick={() => setPosters([])} className="ml-auto text-gray-300 hover:text-gray-700" title="Remove all">
                  <X size={14} />
                </button>
              )}
            </div>
            {posters.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                {posters.map((p) => (
                  <div key={p.url} className="relative">
                    <img src={p.url} alt={p.label || 'animado still'} loading="lazy"
                      className="w-full aspect-[2/3] object-cover rounded-md border border-gray-200" />
                    <button onClick={() => setPosters((ps) => ps.filter((x) => x.url !== p.url))}
                      className="absolute top-0.5 right-0.5 bg-white/90 rounded-full p-0.5 text-gray-500 hover:text-gray-800">
                      <X size={11} />
                    </button>
                    {p.label && <span className="block text-[10px] text-gray-400 truncate mt-0.5">{p.label}</span>}
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => openLibrary('poster')} disabled={libBusy || !!stage || posters.length >= 4}
              className={btn.ghost + ' w-full'}>
              {libBusy && libRole === 'poster' ? <Loader2 size={15} className="animate-spin" /> : <Images size={15} />}
              Animado faces ({posters.length}/4)
            </button>
            <p className="text-[11px] text-gray-400 mt-2">
              The 20 Pixar likenesses from real Animado orders. Kept portrait and downscaled — never cropped to landscape.
              “usada” marks the option that customer's finished video actually used.
            </p>
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
                <span className="text-[11px] text-gray-400">
                  {libRole === 'poster' ? '— adds a portrait poster' : libRole === 'tile' ? '— adds a cropped tile' : '— sets the hero'}
                </span>
                <button onClick={() => setLibRole('')} className="ml-auto text-gray-400 hover:text-gray-700"><X size={14} /></button>
              </div>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-2">
                {LIB_FOLDERS.map((f) => (
                  <button key={f.id} onClick={() => loadFolder(f.id)} disabled={libBusy}
                    className={`flex-1 px-2 py-1 text-[11px] rounded-md transition ${libFolder === f.id ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
                    {f.label}
                  </button>
                ))}
              </div>
              {libFolder === 'animado-likeness' && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5 mb-2">
                  Real customers' faces. Only use one in a broadcast if you're comfortable showing that family to the whole list.
                </p>
              )}
              {libBusy && !library.length ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
                  <Loader2 size={15} className="animate-spin" /> Loading the library…
                </div>
              ) : library.length ? (
                <div className="grid grid-cols-3 gap-1.5 max-h-72 overflow-y-auto">
                  {library.map((p) => (
                    <button key={p.url} onClick={() => pickPhoto(p.url, p.name)} disabled={libBusy} title={p.name}
                      className="relative group rounded-md overflow-hidden border border-gray-200 hover:border-indigo-400 focus:outline-none focus:border-indigo-500 disabled:opacity-50">
                      {/* The likeness renders are portraits — show them tall so you
                          can actually see the face you're picking. */}
                      <img src={p.url} alt={p.name} loading="lazy"
                        className={`w-full object-cover ${libFolder === 'animado-likeness' ? 'h-32' : 'h-20'}`} />
                      <span className="block text-[10px] text-gray-500 truncate px-1 py-0.5 bg-white">{p.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-gray-400 py-4 text-center">No photos found in the library.</p>
              )}
            </Card>
          )}
          </>)}

          <div className="space-y-2">
            <button onClick={() => autoDesign()} disabled={!!stage || !brief.trim()} className={btn.accent + ' w-full !py-3'}>
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
              <button onClick={() => autoDesign()} disabled={!!stage} className={btn.ghost + ' w-full mt-3'}>
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
              <StepLabel n={3} title="Review & send" hint="subject, test, audience" />
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

                {/* The subject coach: 4 hook archetypes, grounded in what this
                    list has actually opened and bought from. "Use" sets A;
                    "Test as B" fills B and turns the A/B on. */}
                <div className="mt-2">
                  <button onClick={suggestSubjects} disabled={subjBusy} className={btn.ghost + ' !px-3 !py-1.5 !text-xs'}>
                    {subjBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    {subjOpts.length ? 'Suggest different subjects' : 'Suggest subject lines'}
                  </button>
                  {subjOpts.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {subjOpts.map((s) => (
                        <div key={s.text} className="flex items-start gap-2.5 text-xs bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2">
                          <div className="flex-1 min-w-0">
                            <span className="block text-gray-800">{s.text}</span>
                            <span className="block text-[10px] text-gray-400 mt-0.5">
                              {s.hook}{s.preview_text ? ` — ${s.preview_text}` : ''}
                            </span>
                          </div>
                          <button onClick={() => { setSubject(s.text); if (s.preview_text) setPreviewText(s.preview_text); }}
                            className="text-indigo-600 hover:text-indigo-800 font-medium whitespace-nowrap mt-0.5">Use</button>
                          <button onClick={() => { setSubjectB(s.text); setAbTest(true); }}
                            className="text-gray-500 hover:text-gray-800 font-medium whitespace-nowrap mt-0.5" title="Half the list gets this as subject B">Test as B</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
              {segment === 'all' && (
                <p className="text-[11px] text-gray-400">
                  Tip: your best campaign went to <span className="font-medium text-gray-500">Everyone incl. non-buyers</span> — for occasion pushes, wider usually wins.
                </p>
              )}
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
