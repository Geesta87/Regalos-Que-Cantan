// src/pages/AnimadoPhotoUploadV2.jsx
//
// The post-purchase Animado photo step — ONE screen (live on the success page
// since 2026-09-04; the older AnimadoPhotoUpload stays only on /animado-demo).
// Born from order 56b175ba (Alex "El Chino"): a 12-person family photo produced
// likenesses of the WRONG relatives, the "recipient" tag landed on a niece, and
// buyer/recipient were never confirmed.
//
// The customer does at most three things:
//   1. Upload a photo of the recipient. We detect the faces (animado-photo
//      action=analyze returns a box per person); if more than one, TAP the face.
//   2. (Optional) upload a family photo and TAP the recipient again, and the
//      partner when the song is for a partner. Everyone else is "familia"
//      automatically — no per-person forms, no names, no dropdowns.
//   3. Answer up to three optional one-line questions ("3 detalles"), generated
//      from THIS song's story + lyrics (`questions` prop) or a per-relationship
//      template. Answers become customer facts for the storyboard.
//   4. Press "Crear mi película".
// A one-line header shows "Para X · de Y" with a swap link ("¿Al revés?"), so
// buyer/recipient gets confirmed without a separate step.
//
// Hooks (SuccessPage):
//   onDetect(file, 'main'|'family') -> { people:[{key,description,box:{x,y,w,h}}], quality:{usable,issues} }
//   onConfirm(payload)               -> resolves when attach succeeded
// `demo` (AnimadoUpsell demo page) supplies preloaded photos + face boxes instead.

import React, { useState, useRef } from 'react';

const GOLD = '#E8B44A';
const PINK = '#E7699F';
const TEAL = '#43C2BA';
const INK = '#1a1020';

const CSS = `
@keyframes v2fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes v2pulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
.v2-card { background: linear-gradient(160deg, #1a1020 0%, #140d18 100%); border: 2px solid rgba(232,180,74,0.45); border-radius: 20px; padding: 20px; animation: v2fade 0.4s ease-out both; font-family: 'Be Vietnam Pro', sans-serif; color: #fff; }
.v2-h { margin: 0 0 4px; font-size: 21px; font-weight: 900; line-height: 1.2; }
.v2-sub { margin: 0; font-size: 13.5px; color: rgba(255,255,255,0.62); line-height: 1.5; }
.v2-btn { width: 100%; padding: 16px; border-radius: 14px; border: none; cursor: pointer; font-size: 16.5px; font-weight: 900; color: #1a1020; background: linear-gradient(135deg, #E8B44A, #E7699F); box-shadow: 0 6px 20px rgba(231,105,159,0.4); transition: all .25s; font-family: inherit; }
.v2-btn:disabled { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.35); box-shadow: none; cursor: not-allowed; }
.v2-link { background: none; border: none; padding: 0; color: #E8B44A; font-weight: 800; font-size: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; font-family: inherit; }
.v2-chip { display: inline-flex; align-items: center; gap: 6px; padding: 7px 11px; border-radius: 999px; font-size: 12.5px; font-weight: 700; border: 1.5px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.8); cursor: pointer; font-family: inherit; }
.v2-drop { border: 2px dashed rgba(232,180,74,0.45); border-radius: 16px; padding: 22px 14px; text-align: center; cursor: pointer; background: rgba(232,180,74,0.05); }
.v2-ring { position: absolute; border: 3px solid rgba(255,255,255,0.92); border-radius: 50%; box-shadow: 0 0 0 2px rgba(0,0,0,0.45); cursor: pointer; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center; transition: all .15s; }
.v2-ring.on { border-color: #E8B44A; box-shadow: 0 0 0 3px rgba(232,180,74,0.45), 0 0 18px rgba(232,180,74,0.6); }
.v2-ring.on2 { border-color: #E7699F; box-shadow: 0 0 0 3px rgba(231,105,159,0.45), 0 0 18px rgba(231,105,159,0.6); }
.v2-ring .tag { position: absolute; top: 100%; margin-top: 3px; white-space: nowrap; font-size: 11px; font-weight: 900; padding: 2px 7px; border-radius: 999px; background: rgba(0,0,0,0.65); color: #fff; }
.v2-ring.on .tag { background: #E8B44A; color: #1a1020; }
.v2-ring.on2 .tag { background: #E7699F; color: #1a1020; }
.v2-scan { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.45); color: #fff; font-weight: 800; font-size: 14px; animation: v2pulse 1.2s ease-in-out infinite; }
`;

const Icon = ({ d, size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const I = {
  check: <path d="M20 6L9 17l-5-5" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.2" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><circle cx="17" cy="9" r="2.6" /><path d="M15.5 14.5a5 5 0 016 5" /></>,
  hand: <path d="M8 13V5.5a1.5 1.5 0 013 0V12m0-6.5a1.5 1.5 0 013 0V12m0-5a1.5 1.5 0 013 0v7a6 6 0 01-6 6h-1a6 6 0 01-5.2-3L3.6 13a1.4 1.4 0 012.3-1.6L8 13" />,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zm7 12l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />,
  warn: <><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18h.01" /></>,
};

// crops a normalized face box out of the photo with CSS
function FaceThumb({ photo, box, size = 56, color = GOLD }) {
  const pad = 0.7;
  const bw = box.w * (1 + pad), bh = box.h * (1 + pad);
  const bx = box.x - box.w * pad / 2, by = box.y - box.h * pad / 2;
  const imgW = size / bw, imgH = imgW * (photo.h / photo.w);
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, position: 'relative', background: '#000', boxShadow: `0 0 0 3px ${color}` }}>
      <img src={photo.url} alt="" draggable={false} style={{ position: 'absolute', width: imgW, height: imgH, left: -bx * imgW, top: -(by + bh / 2) * imgH + size / 2, maxWidth: 'none' }} />
    </div>
  );
}

// photo with tappable face rings. `picks` = { faceId: label }, first pick gold, second pink
function FacePicker({ photo, faces, picks, onTap, scanning }) {
  const ids = Object.keys(picks);
  return (
    <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#000' }}>
      <img src={photo.url} alt="" draggable={false} style={{ display: 'block', width: '100%' }} />
      {scanning && <div className="v2-scan">Buscando caras…</div>}
      {!scanning && (faces || []).map((f, i) => {
        const cls = picks[f.id] ? (ids[0] === f.id ? ' on' : ' on2') : '';
        return (
          <div key={f.id} className={`v2-ring${cls}`} onClick={() => onTap(f.id)}
            style={{ left: `${(f.x + f.w / 2) * 100}%`, top: `${(f.y + f.h / 2) * 100}%`, width: `${Math.max(f.w * 135, 9)}%`, aspectRatio: `${photo.w * f.w} / ${photo.h * f.h}` }}>
            <span className="tag">{picks[f.id] || i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}

function Drop({ title, hint, onDemo, onFile, inputRef }) {
  return (
    <div className="v2-drop" onClick={() => inputRef.current?.click()}>
      <div style={{ width: 44, height: 44, borderRadius: 14, margin: '0 auto 8px', background: 'rgba(232,180,74,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon d={I.camera} size={22} color={GOLD} /></div>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 900 }}>{title}</p>
      <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'rgba(255,255,255,0.55)' }}>{hint}</p>
      {onDemo && <button className="v2-chip" onClick={(e) => { e.stopPropagation(); onDemo(); }} style={{ marginTop: 10 }}>Usar foto de ejemplo</button>}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </div>
  );
}

// ── "3 detalles": per-case fallback questions. `{r}` = recipient name. ──────
// The song's own questions (animado-photo action=questions) lead when present;
// these fill in when fewer than three come back. Keys follow the order form's
// codes (relationship: pareja / yo_mismo / hijo / madre / padre / abuelo /
// hermano / amigo / jefe / esposa / familia / otro; occasion: memorial,
// dia_muertos, para_mi, …).
const QUESTION_SETS = {
  pareja: [
    { id: 'place', text: '¿Dónde se conocieron o cuál es su lugar especial?', hint: 'Ej. la iglesia de San Judas, la playa de Rosarito' },
    { id: 'together', text: '¿Qué hacen juntos que los define?', hint: 'Ej. carne asada los domingos, caminar en la montaña' },
    { id: 'must', text: '¿Qué no puede faltar en el video?', hint: 'Ej. su playera de Chivas, la troca, el perro' },
  ],
  parent: [
    { id: 'origin', text: '¿De dónde es {r} y qué extraña de allá?', hint: 'Ej. Jalisco, el rancho, la plaza del pueblo' },
    { id: 'signature', text: '¿Qué cocina o hace {r} que nadie más hace?', hint: 'Ej. sus tamales, arreglar todo en la casa' },
    { id: 'must', text: '¿Qué no puede faltar en el video?', hint: 'Ej. su sillón, su rosario, su jardín' },
  ],
  child: [
    { id: 'loves', text: '¿Qué le encanta a {r} ahora mismo?', hint: 'Ej. dinosaurios, fútbol, princesas, Minecraft' },
    { id: 'friend', text: '¿Su mascota, juguete o compañero favorito?', hint: 'Ej. su perrito Max, su peluche de oso' },
    { id: 'place', text: '¿Su lugar favorito?', hint: 'Ej. el parque, la alberca, la casa de la abuela' },
  ],
  sibling: [
    { id: 'memory', text: '¿Una travesura o recuerdo de siempre con {r}?', hint: 'Ej. las peleas por el control, los viajes a Tijuana' },
    { id: 'together', text: '¿Qué hacen cuando se juntan?', hint: 'Ej. karaoke, cocinar, ver el fútbol' },
    { id: 'must', text: '¿Algo que solo ustedes entienden?', hint: 'Ej. un apodo, una canción, un lugar' },
  ],
  friend: [
    { id: 'met', text: '¿Cómo o dónde se conocieron?', hint: 'Ej. en la secundaria, en el trabajo' },
    { id: 'together', text: '¿Qué hacen juntos?', hint: 'Ej. salir a bailar, pescar, los partidos' },
    { id: 'must', text: '¿Qué no puede faltar en el video?', hint: 'Ej. su carro, su equipo, su bebida' },
  ],
  family: [
    { id: 'place', text: '¿Dónde se junta la familia?', hint: 'Ej. la casa de la abuela, el rancho, el patio' },
    { id: 'tradition', text: '¿Qué hacen juntos que los define?', hint: 'Ej. la carne asada, la posada, ir a misa' },
    { id: 'must', text: '¿Qué no puede faltar en el video?', hint: 'Ej. el perro, la troca, la cocina de mamá' },
  ],
  self: [
    { id: 'proud', text: '¿De qué estás más orgulloso/a?', hint: 'Ej. mi negocio, mis hijos, llegar a este país' },
    { id: 'place', text: '¿Tu lugar?', hint: 'Ej. mi taller, mi cocina, la cancha' },
    { id: 'must', text: '¿Tu equipo, carro u oficio?', hint: 'Ej. Chivas, mi Silverado, la construcción' },
  ],
  memorial: [
    { id: 'remember', text: '¿Cómo recuerdas más a {r}?', hint: 'Ej. riéndose en la cocina, en su silla del porche' },
    { id: 'place', text: '¿Un lugar donde lo/la sientes cerca?', hint: 'Ej. el rancho, la iglesia, el mar' },
    { id: 'object', text: '¿Un objeto suyo que debe aparecer?', hint: 'Ej. su sombrero, su guitarra, su rosario' },
  ],
};
export function caseFor(relationship = '', occasion = '') {
  const r = String(relationship).toLowerCase(), o = String(occasion).toLowerCase();
  if (/memorial|dia_muertos|falleci|luto|difunt|cielo/.test(o + ' ' + r)) return 'memorial';
  if (/yo_mismo|mismo|misma|para_mi|para m[ií]|^yo$|self/.test(r + ' ' + o)) return 'self';
  if (/pareja|espos|novi|marido|mujer/.test(r)) return 'pareja';
  if (/familia/.test(r)) return 'family';
  if (/mam[aá]|pap[aá]|madre|padre|abuel|suegr/.test(r)) return 'parent';
  if (/hij[oa]|niet|beb[eé]|ni[ñn]/.test(r)) return 'child';
  if (/herman|prim/.test(r)) return 'sibling';
  return 'friend';
}

// a detector result -> the faces the picker draws. No boxes -> one centred box
// (single-face photo, or detection failed) so the flow never blocks.
function toFaces(people) {
  const list = (Array.isArray(people) ? people : []).filter((p) => p && p.box && Number.isFinite(+p.box.w));
  if (!list.length) return [{ id: 'f1', x: 0.3, y: 0.12, w: 0.4, h: 0.3, description: (people?.[0]?.description) || '', single: true }];
  return list.map((p, i) => ({ id: String(p.key || `p${i + 1}`), x: +p.box.x, y: +p.box.y, w: +p.box.w, h: +p.box.h, description: p.description || '', box: p.box }));
}

export default function AnimadoPhotoUploadV2({
  recipientName = 'tu ser querido',
  senderName = '',
  relationship = '',
  occasion = '',
  questions = null,          // song-generated [{id,text,hint}] (max 3); templates when null/short
  isFamily = true,
  askPhone = true,
  onDetect = null,           // (file, 'main'|'family') => { people, quality }
  onConfirm = null,          // (payload) => Promise
  demo = null,               // { main: {url,w,h,faces}, family: {url,w,h,faces} }
}) {
  const [names, setNames] = useState({ recipient: recipientName, sender: senderName });
  const [swapped, setSwapped] = useState(false);
  const [main, setMain] = useState(null);          // { url, w, h, faces, scanning, quality }
  const [mainFace, setMainFace] = useState(null);
  const [family, setFamily] = useState(null);
  const [famRecipient, setFamRecipient] = useState(null);
  const [famPartner, setFamPartner] = useState(null);
  const [partnerAbsent, setPartnerAbsent] = useState(false);
  const [answers, setAnswers] = useState({});
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const fileMain = useRef(null), fileFamily = useRef(null);

  const kind = caseFor(relationship, occasion);
  const isSelf = kind === 'self';
  const isPartner = kind === 'pareja';
  const partnerName = names.sender || 'tu pareja';

  // the three questions: song-generated first, templates fill the rest
  const tmpl = (QUESTION_SETS[kind] || QUESTION_SETS.friend).map((q) => ({ ...q, text: q.text.replace(/\{r\}/g, names.recipient) }));
  const qs = [...(Array.isArray(questions) ? questions.filter((q) => q && q.text).slice(0, 3) : [])];
  for (const t of tmpl) { if (qs.length >= 3) break; if (!qs.some((q) => q.id === t.id)) qs.push(t); }
  const answered = qs.filter((q) => (answers[q.id] || '').trim()).length;

  // pick a file -> show it immediately -> detect faces in the background
  const loadFile = (file, which, setter) => {
    setError(null);
    const isHeic = /\.hei[cf]$/i.test(file.name || '') || /image\/hei[cf]/i.test(file.type || '');
    if (isHeic) { setError('Esa foto es formato HEIC (iPhone). Toma una captura de pantalla o cámbiala a JPG y súbela de nuevo.'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      const base = { url, w: img.naturalWidth, h: img.naturalHeight };
      if (!onDetect) { setter({ ...base, faces: toFaces([]), scanning: false }); return; }
      setter({ ...base, faces: [], scanning: true });
      try {
        const res = await onDetect(file, which);
        setter({ ...base, faces: toFaces(res?.people), scanning: false, quality: res?.quality || null });
      } catch (e) {
        setter({ ...base, faces: toFaces([]), scanning: false });
      }
    };
    img.onerror = () => setError('No pudimos leer esa foto. Intenta con otra (JPG o PNG).');
    img.src = url;
  };

  const mainPick = main && !main.scanning ? (main.faces.length === 1 ? main.faces[0].id : mainFace) : null;
  const famDone = !family || (!family.scanning && famRecipient && (!isPartner || famPartner || partnerAbsent));
  const ready = !!mainPick && famDone && !busy;
  const others = family ? family.faces.filter((f) => f.id !== famRecipient && f.id !== famPartner).length : 0;

  const tapFamily = (id) => {
    if (!famRecipient) return setFamRecipient(id);
    if (id === famRecipient) return; // already the hero
    if (isPartner && !partnerAbsent) setFamPartner(id === famPartner ? null : id);
  };

  // never let the customer hang on "Guardando…": the server has almost
  // certainly saved by 12 s (the heavy work runs in the background there)
  const confirmSafely = (payload) => new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; resolve('timeout'); } }, 12000);
    Promise.resolve(onConfirm ? onConfirm(payload) : new Promise((r) => setTimeout(r, 600))).then(
      () => { if (!settled) { settled = true; clearTimeout(t); resolve('ok'); } },
      (e) => { if (!settled) { settled = true; clearTimeout(t); reject(e); } },
    );
  });

  const finish = async () => {
    if (!ready) return;
    setBusy(true); setError(null);
    const payload = {
      names, names_swapped: swapped,
      main: { faces: main.faces, recipient: mainPick },
      family: family ? { faces: family.faces, recipient: famRecipient, partner: famPartner, others_are_family: true } : null,
      answers: qs.filter((q) => (answers[q.id] || '').trim()).map((q) => ({ id: q.id, question: q.text, answer: answers[q.id].trim() })),
      phone: phone.trim() || null,
    };
    try { await confirmSafely(payload); setDone(true); }
    catch (e) { setError(e?.message || 'No se pudo guardar. Intenta de nuevo.'); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="v2-card" style={{ textAlign: 'center', borderColor: 'rgba(67,194,186,0.5)' }}>
        <style>{CSS}</style>
        <div style={{ width: 60, height: 60, borderRadius: '50%', margin: '0 auto 12px', background: `linear-gradient(135deg,#1F8C86,${TEAL})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 24px rgba(67,194,186,0.5)' }}><Icon d={I.check} size={30} color="#fff" /></div>
        <h2 className="v2-h">¡Listo! Ya estamos creando la película de {names.recipient}</h2>
        <p className="v2-sub">Te la enviamos en 1–2 días. Si necesitamos una mejor foto, te escribimos.</p>
      </div>
    );
  }

  const famLabel = !family ? '' : family.scanning ? 'Buscando caras…'
    : !famRecipient ? `Toca a ${names.recipient}`
    : isPartner && !famPartner && !partnerAbsent ? `Ahora toca a ${partnerName} (su pareja)`
    : 'Listo. Los demás salen como su familia.';
  const famPicks = {};
  if (famRecipient) famPicks[famRecipient] = names.recipient;
  if (famPartner) famPicks[famPartner] = partnerName;
  const issues = (p) => (p?.quality && p.quality.usable === false && Array.isArray(p.quality.issues) && p.quality.issues.length) ? p.quality.issues : null;
  const btnText = busy ? 'Guardando…'
    : ready ? 'Crear mi película'
    : !main ? `Sube la foto de ${names.recipient}`
    : main.scanning ? 'Buscando caras…'
    : !mainPick ? `Toca la cara de ${names.recipient}`
    : family && family.scanning ? 'Buscando caras…'
    : family && !famRecipient ? `Toca a ${names.recipient} en la foto familiar`
    : `Toca a ${partnerName} en la foto familiar`;

  return (
    <div className="v2-card">
      <style>{CSS}</style>

      {/* who is who, in one line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '9px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', fontSize: 13, lineHeight: 1.4 }}>
        <Icon d={I.film} size={18} color={GOLD} />
        <span style={{ color: 'rgba(255,255,255,0.7)' }}>
          {isSelf
            ? <>Tu película, <strong style={{ color: '#fff' }}>{names.recipient}</strong>.</>
            : <>Película para <strong style={{ color: '#fff' }}>{names.recipient}</strong>{names.sender ? <> · regalo de <strong style={{ color: '#fff' }}>{names.sender}</strong></> : null}.{' '}
                {names.sender && <button className="v2-link" onClick={() => { setNames((n) => ({ recipient: n.sender, sender: n.recipient })); setSwapped((s) => !s); }}>¿Al revés?</button>}</>}
        </span>
      </div>

      <h2 className="v2-h">Sube una foto de {names.recipient}</h2>
      <p className="v2-sub" style={{ marginBottom: 14 }}>De frente y con buena luz. Si salen más personas, tocas su cara y listo.</p>

      {/* 1. recipient photo */}
      {!main
        ? <Drop title={`Foto de ${names.recipient}`} hint="JPG o PNG · que se vea bien la cara" onDemo={demo?.main ? () => setMain({ ...demo.main, scanning: false }) : null} inputRef={fileMain} onFile={(f) => loadFile(f, 'main', setMain)} />
        : (
          <div>
            {!main.scanning && main.faces.length > 1 && !mainPick && (
              <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 800, color: GOLD, display: 'flex', alignItems: 'center', gap: 6 }}><Icon d={I.hand} size={16} color={GOLD} /> Toca la cara de {names.recipient}</p>
            )}
            <FacePicker photo={main} faces={main.faces} picks={mainPick ? { [mainPick]: names.recipient } : {}} onTap={(id) => setMainFace(id)} scanning={main.scanning} />
            {issues(main) && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, padding: '8px 10px', borderRadius: 12, background: 'rgba(232,180,74,0.1)', border: '1px solid rgba(232,180,74,0.35)' }}>
                <Icon d={I.warn} size={16} color={GOLD} />
                <p style={{ margin: 0, fontSize: 12.5, color: '#F4D08A', lineHeight: 1.4 }}>Esta foto podría no salir bien: {issues(main).join(', ')}. Si tienes una más clara, cámbiala.</p>
              </div>
            )}
            {mainPick && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: '8px 10px', borderRadius: 12, background: 'rgba(67,194,186,0.1)', border: '1px solid rgba(67,194,186,0.35)' }}>
                <FaceThumb photo={main} box={main.faces.find((f) => f.id === mainPick)} size={44} />
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: '#89DAD4', flex: 1 }}>{isSelf ? 'Con esta cara hacemos tu personaje' : `Este es ${names.recipient}`}</p>
                <button className="v2-chip" onClick={() => { setMain(null); setMainFace(null); }}>Cambiar</button>
              </div>
            )}
            {!mainPick && !main.scanning && <button className="v2-chip" onClick={() => { setMain(null); setMainFace(null); }} style={{ marginTop: 8 }}>Cambiar foto</button>}
          </div>
        )}

      {/* 2. optional family photo */}
      {isFamily && (
        <div style={{ marginTop: 18 }}>
          <p style={{ margin: '0 0 8px', fontSize: 14.5, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon d={I.users} size={17} color={GOLD} /> {isSelf ? '¿Sales con tu familia?' : '¿Sale con su familia?'} <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 700, fontSize: 12.5 }}>· opcional</span>
          </p>
          {!family
            ? <Drop title="Foto con la familia" hint="Todos juntos, que se vean las caras" onDemo={demo?.family ? () => setFamily({ ...demo.family, scanning: false }) : null} inputRef={fileFamily} onFile={(f) => loadFile(f, 'family', setFamily)} />
            : (
              <div>
                <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 800, color: famDone ? '#89DAD4' : GOLD, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon d={famDone ? I.check : I.hand} size={16} color={famDone ? '#89DAD4' : GOLD} /> {famLabel}
                </p>
                <FacePicker photo={family} faces={family.faces} picks={famPicks} onTap={tapFamily} scanning={family.scanning} />
                {issues(family) && (
                  <p style={{ margin: '8px 0 0', fontSize: 12.5, color: '#F4D08A', lineHeight: 1.4 }}>Esta foto podría no salir bien: {issues(family).join(', ')}.</p>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {isPartner && famRecipient && !famPartner && !partnerAbsent && (
                    <button className="v2-chip" onClick={() => setPartnerAbsent(true)}>{partnerName} no sale aquí</button>
                  )}
                  <button className="v2-chip" onClick={() => { setFamily(null); setFamRecipient(null); setFamPartner(null); setPartnerAbsent(false); }}>Cambiar foto</button>
                  {famDone && others > 0 && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{others} familiares más</span>}
                </div>
              </div>
            )}
        </div>
      )}

      {/* 3. the three questions */}
      <div style={{ marginTop: 20 }}>
        <p style={{ margin: '0 0 2px', fontSize: 14.5, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon d={I.spark} size={17} color={GOLD} /> 3 detalles para que salga perfecto
        </p>
        <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.45 }}>
          Opcional. Lo que nos cuentes aquí sale en las escenas; si lo dejas vacío, lo imaginamos nosotros.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {qs.map((q, i) => (
            <div key={q.id}>
              <p style={{ margin: '0 0 5px', fontSize: 13.5, fontWeight: 800, lineHeight: 1.35, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: (answers[q.id] || '').trim() ? TEAL : 'rgba(232,180,74,0.2)', color: (answers[q.id] || '').trim() ? INK : GOLD, fontSize: 11, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                  {(answers[q.id] || '').trim() ? '✓' : i + 1}
                </span>
                <span>{q.text}</span>
              </p>
              <input value={answers[q.id] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value.slice(0, 140) }))} placeholder={q.hint || ''} maxLength={140}
                style={{ width: '100%', boxSizing: 'border-box', padding: '11px 13px', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 14.5, outline: 'none', border: `1.5px solid ${(answers[q.id] || '').trim() ? 'rgba(67,194,186,0.5)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 12, fontFamily: 'inherit' }} />
            </div>
          ))}
        </div>
        {answered > 0 && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#89DAD4', fontWeight: 700 }}>{answered} de 3 · gracias, esto hace la diferencia</p>}
      </div>

      {askPhone && (
        <div style={{ marginTop: 18 }}>
          <p style={{ margin: '0 0 6px', fontSize: 13.5, fontWeight: 800 }}>Tu teléfono <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>· te avisamos cuando esté lista</span></p>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d\s\-+()]/g, ''))} placeholder="Tu número" maxLength={20}
            style={{ width: '100%', boxSizing: 'border-box', padding: '13px 14px', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 15, outline: 'none', border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: 12, fontFamily: 'inherit' }} />
        </div>
      )}

      {error && <p style={{ margin: '14px 0 0', fontSize: 12.5, color: '#f87171', textAlign: 'center', fontWeight: 700, lineHeight: 1.4 }}>{error}</p>}
      <button className="v2-btn" disabled={!ready} onClick={finish} style={{ marginTop: 18 }}>{btnText}</button>
      <p style={{ margin: '12px 0 0', fontSize: 10.5, color: 'rgba(255,255,255,0.35)', textAlign: 'center', lineHeight: 1.5 }}>
        Estilo animado (Pixar): una versión artística de sus fotos. Nuestro equipo revisa cada personaje antes de animar.
      </p>
    </div>
  );
}
