// src/pages/AnimadoPhotoUploadV2.jsx
//
// PROPOSAL (2026-09-02) for the post-purchase Animado photo step — ONE screen.
// Motivated by order 56b175ba (Alex "El Chino" Morales): a 12-person family
// photo produced likenesses of the WRONG relatives, the "recipient" tag landed
// on a niece, and buyer/recipient were never confirmed.
//
// The customer does at most three things:
//   1. Upload a photo of the recipient. If more than one face, TAP the face.
//   2. (Optional) upload a family photo and TAP the recipient again, and the
//      partner when the song is for a partner. Everyone else is "familia"
//      automatically — no per-person forms, no names, no dropdowns.
//   3. Press "Crear mi película".
// A one-line header shows "Para X · de Y" with a swap link, so buyer/recipient
// gets confirmed without a separate step.
//
// The taps give us an exact face box for the likeness crop and an unambiguous
// hero/partner for the storyboard. Rendered from /animado-demo (tab
// "3 · Propuesta"); `demo` supplies preloaded photos + face boxes.

import React, { useState, useRef } from 'react';

const GOLD = '#E8B44A';
const PINK = '#E7699F';
const TEAL = '#43C2BA';
const INK = '#1a1020';

const CSS = `
@keyframes v2fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
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
function FacePicker({ photo, faces, picks, onTap }) {
  const ids = Object.keys(picks);
  return (
    <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#000' }}>
      <img src={photo.url} alt="" draggable={false} style={{ display: 'block', width: '100%' }} />
      {faces.map((f, i) => {
        const cls = picks[f.id] ? (ids[0] === f.id ? ' on' : ' on2') : '';
        return (
          <div key={f.id} className={`v2-ring${cls}`} onClick={() => onTap(f.id)}
            style={{ left: `${(f.x + f.w / 2) * 100}%`, top: `${(f.y + f.h / 2) * 100}%`, width: `${f.w * 135}%`, aspectRatio: `${photo.w * f.w} / ${photo.h * f.h}` }}>
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
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </div>
  );
}

export default function AnimadoPhotoUploadV2({
  recipientName = 'Alex',
  senderName = 'Sandra',
  relationship = 'pareja',   // 'pareja' | anything else
  isFamily = true,
  askPhone = true,
  onConfirm = null,
  demo = null,               // { main: {url,w,h,faces}, family: {url,w,h,faces} }
}) {
  const [names, setNames] = useState({ recipient: recipientName, sender: senderName });
  const [main, setMain] = useState(null);
  const [mainFace, setMainFace] = useState(null);
  const [family, setFamily] = useState(null);
  const [famRecipient, setFamRecipient] = useState(null);
  const [famPartner, setFamPartner] = useState(null);
  const [partnerAbsent, setPartnerAbsent] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const fileMain = useRef(null), fileFamily = useRef(null);
  const isPartner = /pareja|espos|novi/i.test(relationship);
  const partnerName = names.sender;

  // production: boxes come from face detection; a picked file here gets one centered box
  const loadFile = (file, setter) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setter({ url, w: img.naturalWidth, h: img.naturalHeight, faces: [{ id: 'f1', x: 0.35, y: 0.2, w: 0.3, h: 0.25 }] });
    img.src = url;
  };

  const mainPick = main ? (main.faces.length === 1 ? main.faces[0].id : mainFace) : null;
  const famDone = !family || (famRecipient && (!isPartner || famPartner || partnerAbsent));
  const ready = !!mainPick && famDone;
  const others = family ? family.faces.filter((f) => f.id !== famRecipient && f.id !== famPartner).length : 0;

  const tapFamily = (id) => {
    if (!famRecipient) return setFamRecipient(id);
    if (id === famRecipient) return; // already the hero
    if (isPartner && !partnerAbsent) setFamPartner(id === famPartner ? null : id);
  };

  const finish = async () => {
    setBusy(true);
    const payload = {
      names,
      recipient_face: main.faces.find((f) => f.id === mainPick),
      family: family ? { recipient_face: famRecipient, partner_face: famPartner, others_are_family: true } : null,
      phone: phone || null,
    };
    try { if (onConfirm) await onConfirm(payload); else await new Promise((r) => setTimeout(r, 600)); setDone(true); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="v2-card" style={{ textAlign: 'center', borderColor: 'rgba(67,194,186,0.5)' }}>
        <style>{CSS}</style>
        <div style={{ width: 60, height: 60, borderRadius: '50%', margin: '0 auto 12px', background: `linear-gradient(135deg,#1F8C86,${TEAL})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 24px rgba(67,194,186,0.5)' }}><Icon d={I.check} size={30} color="#fff" /></div>
        <h2 className="v2-h">¡Listo! Ya estamos creando la película de {names.recipient}</h2>
        <p className="v2-sub">Te la enviamos en 1–2 días.</p>
      </div>
    );
  }

  const famLabel = !famRecipient
    ? `Toca a ${names.recipient}`
    : isPartner && !famPartner && !partnerAbsent
      ? `Ahora toca a ${partnerName} (su pareja)`
      : 'Listo. Los demás salen como su familia.';
  const famPicks = {};
  if (famRecipient) famPicks[famRecipient] = names.recipient;
  if (famPartner) famPicks[famPartner] = partnerName;

  return (
    <div className="v2-card">
      <style>{CSS}</style>

      {/* who is who, in one line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '9px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', fontSize: 13, lineHeight: 1.4 }}>
        <Icon d={I.film} size={18} color={GOLD} />
        <span style={{ color: 'rgba(255,255,255,0.7)' }}>
          Película para <strong style={{ color: '#fff' }}>{names.recipient}</strong> · regalo de <strong style={{ color: '#fff' }}>{names.sender}</strong>.{' '}
          <button className="v2-link" onClick={() => setNames((n) => ({ recipient: n.sender, sender: n.recipient }))}>¿Al revés?</button>
        </span>
      </div>

      <h2 className="v2-h">Sube una foto de {names.recipient}</h2>
      <p className="v2-sub" style={{ marginBottom: 14 }}>De frente y con buena luz. Si salen más personas, tocas su cara y listo.</p>

      {/* 1. recipient photo */}
      {!main
        ? <Drop title={`Foto de ${names.recipient}`} hint="JPG o PNG · que se vea bien la cara" onDemo={demo?.main ? () => setMain(demo.main) : null} inputRef={fileMain} onFile={(f) => loadFile(f, setMain)} />
        : (
          <div>
            {main.faces.length > 1 && !mainPick && (
              <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 800, color: GOLD, display: 'flex', alignItems: 'center', gap: 6 }}><Icon d={I.hand} size={16} color={GOLD} /> Toca la cara de {names.recipient}</p>
            )}
            <FacePicker photo={main} faces={main.faces} picks={mainPick ? { [mainPick]: names.recipient } : {}} onTap={(id) => setMainFace(id)} />
            {mainPick && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: '8px 10px', borderRadius: 12, background: 'rgba(67,194,186,0.1)', border: '1px solid rgba(67,194,186,0.35)' }}>
                <FaceThumb photo={main} box={main.faces.find((f) => f.id === mainPick)} size={44} />
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: '#89DAD4', flex: 1 }}>Este es {names.recipient}</p>
                <button className="v2-chip" onClick={() => { setMain(null); setMainFace(null); }}>Cambiar</button>
              </div>
            )}
          </div>
        )}

      {/* 2. optional family photo */}
      {isFamily && (
        <div style={{ marginTop: 18 }}>
          <p style={{ margin: '0 0 8px', fontSize: 14.5, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon d={I.users} size={17} color={GOLD} /> ¿Sale con su familia? <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 700, fontSize: 12.5 }}>· opcional</span>
          </p>
          {!family
            ? <Drop title="Foto con la familia" hint="Todos juntos, que se vean las caras" onDemo={demo?.family ? () => setFamily(demo.family) : null} inputRef={fileFamily} onFile={(f) => loadFile(f, setFamily)} />
            : (
              <div>
                <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 800, color: famDone ? '#89DAD4' : GOLD, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon d={famDone ? I.check : I.hand} size={16} color={famDone ? '#89DAD4' : GOLD} /> {famLabel}
                </p>
                <FacePicker photo={family} faces={family.faces} picks={famPicks} onTap={tapFamily} />
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

      {askPhone && (
        <div style={{ marginTop: 18 }}>
          <p style={{ margin: '0 0 6px', fontSize: 13.5, fontWeight: 800 }}>Tu teléfono <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>· te avisamos cuando esté lista</span></p>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d\s\-+()]/g, ''))} placeholder="Tu número"
            style={{ width: '100%', boxSizing: 'border-box', padding: '13px 14px', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 15, outline: 'none', border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: 12, fontFamily: 'inherit' }} />
        </div>
      )}

      <button className="v2-btn" disabled={!ready || busy} onClick={finish} style={{ marginTop: 18 }}>
        {busy ? 'Guardando…' : ready ? 'Crear mi película' : main ? (mainPick ? `Toca a ${famRecipient ? partnerName : names.recipient} en la foto familiar` : `Toca la cara de ${names.recipient}`) : `Sube la foto de ${names.recipient}`}
      </button>
      <p style={{ margin: '12px 0 0', fontSize: 10.5, color: 'rgba(255,255,255,0.35)', textAlign: 'center', lineHeight: 1.5 }}>
        Estilo animado (Pixar): una versión artística de sus fotos. Nuestro equipo revisa cada personaje antes de animar.
      </p>
    </div>
  );
}
