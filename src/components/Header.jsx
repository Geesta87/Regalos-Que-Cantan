import React, { useContext } from 'react';
import { AppContext } from '../App';

export default function Header({ variant = 'default' }) {
  const { navigateTo, clearSession, formData } = useContext(AppContext);
  const isPremium = formData?.pricingTier === 'premium';

  const handleLogoClick = () => {
    if (isPremium) {
      navigateTo('landing_premium');
    } else {
      clearSession();
    }
  };

  if (variant === 'landing') {
    return (
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-24 py-6">
        <button 
          onClick={handleLogoClick}
          className="flex items-center gap-3 group cursor-pointer hover:opacity-90 transition-opacity"
        >
          <img 
            src="/images/logo-small.png" 
            alt="RegalosQueCantan" 
            className="h-12 w-12 md:h-14 md:w-14 object-contain drop-shadow-lg"
          />
          <h2 className="font-display text-white text-xl md:text-2xl font-medium tracking-tight drop-shadow-lg">
            RegalosQueCantan
          </h2>
        </button>
        <div className="flex items-center gap-4">
          <button className="glass-morphism text-white px-6 py-2 rounded-full text-sm font-semibold hover:bg-white/20 transition-all">
            Ingresar
          </button>
        </div>
      </header>
    );
  }

  // Default header for flow pages (not used anymore, each page has its own header)
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-forest/80 backdrop-blur-md border-b border-white/5">
      <div className="max-w-6xl mx-auto px-6 md:px-24 h-16 md:h-20 flex items-center justify-between">
        <button 
          onClick={handleLogoClick}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <img 
            src="/images/logo-small.png" 
            alt="RegalosQueCantan" 
            className="h-10 w-10 md:h-12 md:w-12 object-contain"
          />
          <span className="font-display text-lg md:text-xl font-medium tracking-tight text-white">
            RegalosQueCantan
          </span>
        </button>
        <div className="hidden md:flex items-center gap-8">
          <a className="text-sm font-medium text-white/50 hover:text-gold transition-colors" href="#">Proceso</a>
          <a className="text-sm font-medium text-white/50 hover:text-gold transition-colors" href="#">Precios</a>
          <a className="text-sm font-medium text-white/50 hover:text-gold transition-colors" href="#">Ayuda</a>
        </div>
      </div>
    </header>
  );
}
