import React, { useContext, useState, useEffect, useRef } from 'react';
import { AppContext } from '../App';
import { trackStep } from '../services/tracking';

// Canonical list — shared with the admin "Make Song for Customer" brief so the
// two can never drift apart. Ids/names/icons are unchanged from when this array
// lived here. See src/config/songOptions.js.
import { RELATIONSHIPS as relationships } from '../config/songOptions';

export default function NamesStep() {
  const { formData, updateFormData, navigateTo } = useContext(AppContext);
  const isParaMi = formData.occasion === 'para_mi';
  const [recipientName, setRecipientName] = useState(formData.recipientName || '');
  const [senderName, setSenderName] = useState(formData.senderName || '');
  const [relationship, setRelationship] = useState(isParaMi ? 'yo_mismo' : (formData.relationship || ''));
  const [customRelationship, setCustomRelationship] = useState(formData.customRelationship || '');
  const [showOtroModal, setShowOtroModal] = useState(false);
  const [errors, setErrors] = useState({});
  const continueButtonRef = useRef(null);
  const isForSelf = relationship === 'yo_mismo';

  // Track page view
  useEffect(() => {
    trackStep('names');
  }, []);

  const handleRelationshipSelect = (relationshipId) => {
    setRelationship(relationshipId);
    if (relationshipId === 'otro') {
      setShowOtroModal(true);
    } else {
      // Auto-scroll to Continue button
      setTimeout(() => {
        continueButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  };

  const handleOtroModalClose = () => {
    if (!customRelationship || customRelationship.length < 3) {
      setRelationship('');
    }
    setShowOtroModal(false);
  };

  const handleOtroModalConfirm = () => {
    if (customRelationship.length >= 3) {
      setShowOtroModal(false);
      // Auto-scroll to Continue button after modal closes
      setTimeout(() => {
        continueButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  };

  const validateFields = () => {
    const newErrors = {};

    if (!isForSelf && (!recipientName || recipientName.trim().length < 2)) {
      newErrors.recipientName = 'Mínimo 2 caracteres';
    }

    if (!senderName || senderName.trim().length < 2) {
      newErrors.senderName = 'Mínimo 2 caracteres';
    }

    if (!relationship) {
      newErrors.relationship = 'Selecciona una relación';
    }

    if (relationship === 'otro' && (!customRelationship || customRelationship.length < 3)) {
      newErrors.customRelationship = 'Describe la relación';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinue = () => {
    if (validateFields()) {
      const finalSenderName = senderName.trim();
      updateFormData('recipientName', isForSelf ? finalSenderName : recipientName.trim());
      updateFormData('senderName', finalSenderName);
      updateFormData('relationship', relationship);
      if (relationship === 'otro') {
        updateFormData('customRelationship', customRelationship);
      }
      navigateTo('details');
    }
  };

  const handleBack = () => {
    navigateTo('occasion');
  };

  const isOtroValid = relationship !== 'otro' || (customRelationship && customRelationship.length >= 3);
  const isValid = (isForSelf || recipientName.trim().length >= 2) && senderName.trim().length >= 2 && relationship && isOtroValid;

  return (
    <div className="bg-forest text-white antialiased min-h-screen flex flex-col">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 md:px-24 py-8">
        <div 
          className="flex items-center gap-2 group cursor-pointer"
          onClick={() => navigateTo('landing')}
        >
          <h2 className="font-display text-white text-2xl font-medium tracking-tight">
            RegalosQueCantan
          </h2>
        </div>
        <div className="hidden md:flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gold/40"></span>
            <span className="w-2 h-2 rounded-full bg-gold/40"></span>
            <span className="w-8 h-2 rounded-full bg-gold"></span>
            <span className="w-2 h-2 rounded-full bg-white/10"></span>
            <span className="w-2 h-2 rounded-full bg-white/10"></span>
          </div>
          <span className="text-gold text-xs font-bold uppercase tracking-widest ml-4">Paso 3 de 5</span>
        </div>
        <div className="flex items-center">
          <button 
            onClick={() => navigateTo('landing')}
            className="text-white/60 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 w-full h-full bg-forest">
          <div 
            className="absolute inset-0 bg-cover bg-center mix-blend-overlay opacity-30"
            style={{
              backgroundImage: 'url("https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200")'
            }}
          ></div>
          <div className="absolute inset-0 bg-gradient-to-b from-forest/98 via-forest/95 to-background-dark/92"></div>
        </div>

        <div className="relative z-20 container mx-auto px-6 max-w-xl pt-32 pb-24">
          {/* Title */}
          <div className="text-center mb-10">
            <h1 className="font-display text-white text-5xl md:text-6xl font-black mb-4 leading-tight">
              {isForSelf ? (
                <>Personaliza <br/><span className="italic text-gold">tu canción</span></>
              ) : (
                <>¿A quién va <br/><span className="italic text-gold">dedicada?</span></>
              )}
            </h1>
            <p className="text-gold text-sm font-medium tracking-widest uppercase">
              {isForSelf ? 'Tu canción, tu historia' : 'Personaliza los nombres del regalo'}
            </p>
          </div>

          {/* Form */}
          <div className="space-y-6">
            {/* Recipient Name — hidden when song is for self */}
            {/* Boxed inputs with visible borders + readable labels. The old
                underline-only fields on the dark background didn't read as
                "spaces to fill" to low-tech buyers (audit 2026-08: "no es
                claro para llenar los espacios"). */}
            {!isForSelf && (
              <div className="group">
                <label className="block text-white/90 text-sm font-bold mb-2" htmlFor="recipient">
                  ¿Para quién es la canción? <span className="text-white/50 font-normal">(su nombre se cantará)</span>
                </label>
                <input
                  id="recipient"
                  type="text"
                  value={recipientName}
                  onChange={(e) => {
                    setRecipientName(e.target.value);
                    updateFormData('recipientName', e.target.value);
                    if (errors.recipientName) setErrors({...errors, recipientName: null});
                  }}
                  className={`w-full bg-white/[0.07] border-2 ${errors.recipientName ? 'border-red-400' : 'border-white/25'} focus:border-gold focus:ring-0 rounded-xl text-white text-lg py-4 px-4 transition-all`}
                />
                <p className="text-white/40 text-xs mt-1.5">Por ejemplo: María Elena</p>
                {errors.recipientName && (
                  <p className="text-red-400 text-sm mt-1">Escribe su nombre para continuar</p>
                )}
              </div>
            )}

            {/* Sender Name */}
            <div className="group">
              <label className="block text-white/90 text-sm font-bold mb-2" htmlFor="sender">
                Tu nombre {!isForSelf && <span className="text-white/50 font-normal">(de parte de quién viene el regalo)</span>}
              </label>
              <input
                id="sender"
                type="text"
                value={senderName}
                onChange={(e) => {
                  setSenderName(e.target.value);
                  updateFormData('senderName', e.target.value);
                  if (errors.senderName) setErrors({...errors, senderName: null});
                }}
                className={`w-full bg-white/[0.07] border-2 ${errors.senderName ? 'border-red-400' : 'border-white/25'} focus:border-gold focus:ring-0 rounded-xl text-white text-lg py-4 px-4 transition-all`}
              />
              <p className="text-white/40 text-xs mt-1.5">Por ejemplo: Roberto</p>
              {errors.senderName && (
                <p className="text-red-400 text-sm mt-1">Escribe tu nombre para continuar</p>
              )}
            </div>

            {/* Relationship — hidden when occasion is para_mi (already yo_mismo) */}
            {!isParaMi && (
            <div className="group">
              <label className="block text-white/90 text-sm font-bold mb-3">
                ¿Quién es para ti?
              </label>
              <div className="grid grid-cols-3 gap-2">
                {relationships.map((rel) => (
                  <button
                    key={rel.id}
                    type="button"
                    onClick={() => handleRelationshipSelect(rel.id)}
                    className={`
                      flex flex-col items-center justify-center p-3 rounded-xl transition-all text-xs
                      ${relationship === rel.id
                        ? 'bg-gold/20 border border-gold text-gold'
                        : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-gold/30'}
                    `}
                  >
                    <span className="material-symbols-outlined text-xl mb-1">{rel.icon}</span>
                    <span className="font-medium text-center leading-tight">{rel.name}</span>
                    {rel.id === 'otro' && relationship === 'otro' && customRelationship.length >= 3 && (
                      <span className="material-symbols-outlined text-gold text-xs mt-1">check_circle</span>
                    )}
                  </button>
                ))}
              </div>
              {errors.relationship && (
                <p className="text-red-400 text-xs mt-2 ml-1">{errors.relationship}</p>
              )}
            </div>
            )}

            {/* Buttons */}
            <div ref={continueButtonRef} className="pt-8 flex flex-col items-center gap-6">
              {/* Not disabled: tapping with missing fields runs validateFields
                  and shows what's missing — a dead button explains nothing. */}
              <button
                onClick={handleContinue}
                className={`
                  group relative flex w-full cursor-pointer items-center justify-center overflow-hidden 
                  rounded-full h-16 text-lg font-bold shadow-2xl transition-all hover:scale-[1.02] active:scale-95
                  ${isValid
                    ? 'bg-bougainvillea text-white'
                    : 'bg-white/10 text-white/40 hover:scale-100'}
                `}
              >
                <span className="relative z-10 flex items-center gap-2">
                  Continuar
                  <span className="material-symbols-outlined">arrow_forward</span>
                </span>
                {isValid && (
                  <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
                )}
              </button>
              <button
                onClick={handleBack}
                className="text-white/40 hover:text-white transition-colors flex items-center gap-2 text-sm uppercase tracking-widest font-medium"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                Atrás
              </button>
            </div>
          </div>
        </div>

        {/* Decorative corners */}
        <div className="absolute top-32 left-8 w-24 h-24 border-l border-t border-gold/20 opacity-30 hidden md:block"></div>
        <div className="absolute bottom-32 right-8 w-24 h-24 border-r border-b border-gold/20 opacity-30 hidden md:block"></div>
      </main>

      {/* Footer */}
      <footer className="bg-background-dark py-8 px-8 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="font-display text-white/30 text-lg">RegalosQueCantan</div>
          <p className="text-white/20 text-[10px] uppercase tracking-widest font-bold">© 2026 Inspiración y Tradición.</p>
        </div>
      </footer>

      {/* "Otro" Relationship Modal */}
      {showOtroModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={handleOtroModalClose}
          ></div>
          
          <div className="relative bg-forest border border-gold/30 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <button 
              onClick={handleOtroModalClose}
              className="absolute top-4 right-4 text-white/50 hover:text-white"
            >
              <span className="material-symbols-outlined">close</span>
            </button>

            <div className="text-center mb-6">
              <span className="material-symbols-outlined text-gold text-5xl mb-4">people</span>
              <h3 className="font-display text-2xl font-bold text-white mb-2">¿Cuál es la relación?</h3>
              <p className="text-white/60 text-sm">Describe brevemente el vínculo con el destinatario.</p>
            </div>

            <div className="mb-6">
              <label className="block text-gold text-xs uppercase tracking-widest font-bold mb-2">
                Describe la relación *
              </label>
              <input
                type="text"
                value={customRelationship}
                onChange={(e) => setCustomRelationship(e.target.value.slice(0, 50))}
                placeholder="Ej: Mi madrina, Mi suegra, Mi compadre..."
                className="w-full bg-white/5 border border-gold/20 rounded-xl p-4 text-white focus:ring-1 focus:ring-gold focus:border-gold outline-none transition-all text-sm placeholder:text-white/30"
              />
              <div className="flex justify-between mt-2">
                <span className={`text-xs ${customRelationship.length < 3 ? 'text-red-400' : 'text-gold/60'}`}>
                  Mínimo 3 caracteres
                </span>
                <span className="text-xs text-white/40">{customRelationship.length} / 50</span>
              </div>
            </div>

            <button
              onClick={handleOtroModalConfirm}
              disabled={customRelationship.length < 3}
              className={`
                w-full py-4 rounded-full font-bold transition-all flex items-center justify-center gap-2
                ${customRelationship.length >= 3
                  ? 'bg-bougainvillea text-white hover:scale-[1.02]'
                  : 'bg-white/10 text-white/30 cursor-not-allowed'}
              `}
            >
              Confirmar
              <span className="material-symbols-outlined">check</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
