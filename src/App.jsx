import React, { useState, useEffect } from 'react';
import { HelmetProvider } from 'react-helmet-async';

// Import all pages
import LandingPage from './pages/LandingPage';
import LandingPageV2 from './pages/LandingPageV2';
import LandingPagePremium from './pages/LandingPagePremium';
import GenreStep from './pages/GenreStep';
import ArtistStep from './pages/ArtistStep';
import SubGenreStep from './pages/SubGenreStep';
import OccasionStep from './pages/OccasionStep';
import NamesStep from './pages/NamesStep';
import VoiceStep from './pages/VoiceStep';
import DetailsStep from './pages/DetailsStep';
import EmailStep from './pages/EmailStep';
import GeneratingPage from './pages/GeneratingPage';
import PreviewPage from './pages/PreviewPage';
import ComparisonPage from './pages/ComparisonPage';
import SuccessPage from './pages/SuccessPage';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import ShareablePreviewPage from './pages/ShareablePreviewPage';
import SongPage from './pages/SongPage';
import KaraokePage from './pages/KaraokePage';
import RecoverSongPage from './pages/RecoverSongPage';
import ReviewPage from './pages/ReviewPage';
import WhatsAppButton from './components/WhatsAppButton';

// SEO Hub pages
import GenerosHub from './pages/seo/GenerosHub';
import OcasionesHub from './pages/seo/OcasionesHub';
import GenreLanding from './pages/seo/GenreLanding';
import OccasionLanding from './pages/seo/OccasionLanding';
import ComoFunciona from './pages/seo/ComoFunciona';
import PreguntasFrecuentes from './pages/seo/PreguntasFrecuentes';
import SobreNosotros from './pages/seo/SobreNosotros';
import DiaDeLasMadresLanding from './pages/seo/DiaDeLasMadresLanding';
import CancionesParaRegalarLanding from './pages/seo/CancionesParaRegalarLanding';
import DiaDelPadreLanding from './pages/seo/DiaDelPadreLanding';
import ComboLanding from './pages/seo/ComboLanding';
import { getComboBySlug } from './data/seoData';
import NotFoundPage from './pages/NotFoundPage';
import CorridosLanding from './pages/CorridosLanding';
import BachataLanding from './pages/BachataLanding';
import AffiliateLogin from './pages/AffiliateLogin';
import AffiliateResetPassword from './pages/AffiliateResetPassword';
import AffiliateOnboarding from './pages/AffiliateOnboarding';
import AffiliateDashboard from './pages/AffiliateDashboard';
import AffiliateTerms from './pages/AffiliateTerms';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import SmsConsentPreview from './pages/SmsConsentPreview';
import SmsConsentMarketingPreview from './pages/SmsConsentMarketingPreview';
import AffiliateLanding from './pages/AffiliateLanding';
import AffiliateVSL from './pages/AffiliateVSL';
import ClonaMiVoz from './pages/ClonaMiVoz';
import StorePage from './pages/StorePage';
import PackReadyPage from './pages/PackReadyPage';
import AnimadoUpsell from './pages/AnimadoUpsell';
import PaqueteLanding from './pages/PaqueteLanding';
import PaqueteCheckout from './pages/PaqueteCheckout';
import OneTapUpsellDemo from './components/OneTapUpsell';
import SimpleCreateFlow from './pages/SimpleCreateFlow';
import { captureAffiliateRef, captureTrafficSource } from './services/tracking';

// App State Context
export const AppContext = React.createContext();

// Version for cache busting
const APP_VERSION = '2.0.2';

// Storage keys
const STORAGE_KEYS = {
  PAGE: 'rqc_currentPage',
  FORM_DATA: 'rqc_formData',
  SONG_DATA: 'rqc_songData',
  VERSION: 'rqc_version'
};

// Map URL paths to pages - MOVED OUTSIDE for immediate access
const pathToPage = {
  '/': 'landing',
  '/crear': 'crear',
  '/v2': 'landing_v2',
  '/premium': 'landing_premium',
  '/create/genre': 'genre',
  '/create/artist': 'artist',
  '/create/subgenre': 'subgenre',
  '/create/occasion': 'occasion',
  '/create/names': 'names',
  '/create/voice': 'voice',
  '/create/details': 'details',
  '/create/email': 'email',
  '/create/generating': 'generating',
  '/preview': 'preview',
  '/comparison': 'comparison',
  '/success': 'success',
  '/listen': 'listen',
  '/mi-cancion': 'recoverSong',
  '/calificar': 'calificar',
  '/admin': 'adminLogin',
  '/admin/dashboard': 'adminDashboard',
  '/generos': 'generos',
  '/ocasiones': 'ocasiones',
  '/como-funciona': 'comoFunciona',
  '/preguntas-frecuentes': 'preguntasFrecuentes',
  '/sobre-nosotros': 'sobreNosotros',
  '/canciones-para-regalar': 'cancionesParaRegalar',
  '/dia-de-las-madres': 'diaDeLasMadres',
  '/dia-del-padre': 'diaDelPadre',
  '/corridos': 'corridos',
  '/bachata': 'bachata',
  '/afiliados': 'affiliateLanding',
  '/partners': 'affiliateVSL',
  '/afiliado': 'affiliateLogin',
  '/afiliado/reset': 'affiliateResetPassword',
  '/afiliado/bienvenida': 'affiliateOnboarding',
  '/afiliado/dashboard': 'affiliateDashboard',
  '/afiliado/terminos': 'affiliateTerms',
  '/politica-de-privacidad': 'privacyPolicy',
  '/terminos-de-servicio': 'termsOfService',
  '/sms-consent-preview': 'smsConsentPreview',
  '/sms-consent-marketing-preview': 'smsConsentMarketingPreview',
  '/clonamivoz': 'clonamivoz',
  '/tienda': 'store',
  '/paquete': 'paquete',
  '/paquete/checkout': 'paqueteCheckout',
  '/pack-listo': 'packReady',
  '/animado-demo': 'animadoDemo',
  '/upsell-demo': 'upsellDemo'
};

// Helper to get initial page from URL - runs BEFORE first render
function getInitialPage() {
  const path = window.location.pathname;
  const urlParams = new URLSearchParams(window.location.search);
  
  // Handle direct song links
  if (urlParams.get('song')) {
    return 'preview';
  }

  // Handle /song/:id shareable pages
  if (path.startsWith('/song/')) {
    return 'songPage';
  }

  // Handle /karaoke/:id shareable instrumental page. The .mp3 file path is
  // proxied by vercel.json before this app loads, so only the bare id lands here.
  if (path.startsWith('/karaoke/')) {
    return 'karaokePage';
  }

  // Handle /preview/:id links (from emails) → redirect to listen page
  if (path.startsWith('/preview/') && path !== '/preview') {
    const songId = path.replace('/preview/', '');
    if (songId) {
      // Preserve UTM params and add song_id
      const currentParams = new URLSearchParams(window.location.search);
      currentParams.set('song_id', songId);
      window.history.replaceState({}, '', `/listen?${currentParams.toString()}`);
      return 'listen';
    }
  }
  
  // Check pathToPage mapping first (includes affiliate routes, admin, etc.)
  if (pathToPage[path]) {
    return pathToPage[path];
  }

  // Check for dynamic SEO routes
  if (path.startsWith('/generos/') && path !== '/generos/') {
    return path.substring(1);
  }
  if (path.startsWith('/ocasiones/') && path !== '/ocasiones/') {
    return path.substring(1);
  }
  if (path.startsWith('/canciones/') && path !== '/canciones/') {
    return path.substring(1);
  }

  // Root path fallback
  if (path === '/') return 'landing';

  // Unknown page - show 404
  return 'notFound';
}

// Helper to extract slug from page path
const getSlugFromPage = (page, prefix) => {
  return page.replace(prefix, '');
};

const DEFAULT_FORM_DATA = {
  genre: '',
  genreName: '',
  genreStyle: '',
  subGenre: '',
  subGenreName: '',
  subGenrePrompt: '',
  customStyle: '',
  artistInspiration: '',
  occasion: '',
  occasionPrompt: '',
  customOccasion: '',
  emotionalTone: '',
  recipientName: '',
  senderName: '',
  relationship: '',
  details: '',
  useCustomLyrics: false,
  customLyrics: '',
  email: '',
  voiceType: 'male',
  pricingTier: ''
};

export default function App() {
  // ✅ FIX: Initialize currentPage from URL IMMEDIATELY (not in useEffect)
  const [currentPage, setCurrentPage] = useState(getInitialPage);
  // Load saved form data SYNCHRONOUSLY. It used to load in a useEffect after
  // the first render, so funnel steps seeded their local inputs from the empty
  // initial state — any refresh or phone app-switch mid-funnel showed every
  // field blank and the customer had to retype ("el sistema me saca").
  const [formData, setFormData] = useState(() => {
    try {
      if (localStorage.getItem(STORAGE_KEYS.VERSION) === APP_VERSION) {
        const saved = localStorage.getItem(STORAGE_KEYS.FORM_DATA);
        if (saved) return { ...DEFAULT_FORM_DATA, ...JSON.parse(saved) };
      }
    } catch { /* corrupted or unavailable — start fresh */ }
    return { ...DEFAULT_FORM_DATA };
  });
  const [songData, setSongData] = useState(null);
  const [directSongId, setDirectSongId] = useState(null);

  // Back/forward button support. navigateTo() pushes history entries but nothing
  // ever listened for popstate, so pressing the phone's back button changed the
  // URL while the screen stayed frozen — users pressed back repeatedly and got
  // thrown out of the site ("el sistema me saca"). Sync page state with the URL.
  useEffect(() => {
    const handlePopState = (event) => {
      const page = event.state?.page || getInitialPage();
      setCurrentPage(page);
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Initialize additional data from localStorage
  useEffect(() => {
    // Check version and clear if updated
    const storedVersion = localStorage.getItem(STORAGE_KEYS.VERSION);
    if (storedVersion !== APP_VERSION) {
      console.log(`App updated from ${storedVersion} to ${APP_VERSION} - cleared cache`);
      localStorage.removeItem(STORAGE_KEYS.PAGE);
      localStorage.removeItem(STORAGE_KEYS.FORM_DATA);
      localStorage.removeItem(STORAGE_KEYS.SONG_DATA);
      localStorage.setItem(STORAGE_KEYS.VERSION, APP_VERSION);
    }

    // Set directSongId if present
    const urlParams = new URLSearchParams(window.location.search);
    const songId = urlParams.get('song');
    if (songId) {
      setDirectSongId(songId);
    }

    // Capture affiliate ref code from URL and log a visit (one per session)
    captureAffiliateRef();

    // Capture how this visitor found us (Google/organic, referral, direct) from
    // document.referrer. Only used at checkout when there's no UTM tag, so it
    // fills the "unknown source" gap without touching paid attribution.
    captureTrafficSource();

    // Capture coupon code from the landing URL so it survives the funnel.
    // The checkout/comparison page reads sessionStorage['rqc_coupon'] as a
    // fallback when ?coupon= is no longer in the URL (e.g. the visitor landed
    // from an email on the homepage, then created a song before paying).
    const couponParam = urlParams.get('coupon');
    if (couponParam) {
      try {
        sessionStorage.setItem('rqc_coupon', couponParam.toUpperCase().trim());
      } catch { /* sessionStorage unavailable — ignore */ }
    }

    // Form data now loads synchronously in the useState initializer above —
    // re-setting it here after mount was the race that blanked typed fields.
    const savedSongData = localStorage.getItem(STORAGE_KEYS.SONG_DATA);

    if (savedSongData) {
      try {
        setSongData(JSON.parse(savedSongData));
      } catch (e) {
        console.error('Error parsing saved song data:', e);
      }
    }
  }, []);

  // Save to localStorage when state changes
  useEffect(() => {
    if (currentPage && currentPage !== 'landing' && currentPage !== 'landing_v2' && currentPage !== 'landing_premium') {
      localStorage.setItem(STORAGE_KEYS.PAGE, currentPage);
    }
  }, [currentPage]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.FORM_DATA, JSON.stringify(formData));
  }, [formData]);

  useEffect(() => {
    if (songData) {
      localStorage.setItem(STORAGE_KEYS.SONG_DATA, JSON.stringify(songData));
    }
  }, [songData]);

  const updateFormData = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const navigateTo = (page) => {
    console.log('Navigating to:', page);
    setCurrentPage(page);
    
    // Map pages to URLs for proper browser history
    const pageUrls = {
      landing: '/',
      crear: '/crear',
      landing_v2: '/v2',
      landing_premium: '/premium',
      genre: '/create/genre',
      artist: '/create/artist',
      subgenre: '/create/subgenre',
      occasion: '/create/occasion',
      names: '/create/names',
      voice: '/create/voice',
      details: '/create/details',
      email: '/create/email',
      generating: '/create/generating',
      preview: '/preview',
      comparison: '/comparison',
      success: '/success',
      listen: '/listen',
      recoverSong: '/mi-cancion',
      calificar: '/calificar',
      adminLogin: '/admin',
      adminDashboard: '/admin/dashboard',
      generos: '/generos',
      ocasiones: '/ocasiones',
      comoFunciona: '/como-funciona',
      preguntasFrecuentes: '/preguntas-frecuentes',
      sobreNosotros: '/sobre-nosotros',
      cancionesParaRegalar: '/canciones-para-regalar',
      diaDeLasMadres: '/dia-de-las-madres',
      diaDelPadre: '/dia-del-padre',
      corridos: '/corridos',
      bachata: '/bachata',
      affiliateLanding: '/afiliados',
      affiliateVSL: '/partners',
      affiliateLogin: '/afiliado',
      affiliateResetPassword: '/afiliado/reset',
      affiliateOnboarding: '/afiliado/bienvenida',
      affiliateDashboard: '/afiliado/dashboard',
      affiliateTerms: '/afiliado/terminos',
      privacyPolicy: '/politica-de-privacidad',
      termsOfService: '/terminos-de-servicio',
      smsConsentPreview: '/sms-consent-preview',
      smsConsentMarketingPreview: '/sms-consent-marketing-preview',
      clonamivoz: '/clonamivoz',
      store: '/tienda',
      paquete: '/paquete',
      paqueteCheckout: '/paquete/checkout',
      packReady: '/pack-listo'
    };

    // Handle dynamic SEO routes (generos/*, ocasiones/*)
    let url = pageUrls[page];
    if (!url) {
      url = (page.startsWith('generos/') || page.startsWith('ocasiones/') || page.startsWith('canciones/')) ? `/${page}` : '/';
    }
    window.history.pushState({ page }, '', url);
    
    window.scrollTo(0, 0);
  };

  const clearSession = () => {
    localStorage.removeItem(STORAGE_KEYS.PAGE);
    localStorage.removeItem(STORAGE_KEYS.FORM_DATA);
    localStorage.removeItem(STORAGE_KEYS.SONG_DATA);
    setFormData({ ...DEFAULT_FORM_DATA });
    setSongData(null);
    setDirectSongId(null);
    setCurrentPage('landing');
    window.history.pushState({ page: 'landing' }, '', '/');
  };

  const contextValue = {
    currentPage,
    navigateTo,
    formData,
    setFormData,
    updateFormData,
    songData,
    setSongData,
    clearSession,
    directSongId,
    setDirectSongId
  };

  // Debug log
  console.log('🔄 App rendering, currentPage:', currentPage);

  return (
    <HelmetProvider>
      <AppContext.Provider value={contextValue}>
        <div className="min-h-screen bg-background-light dark:bg-background-dark transition-colors duration-300">
          {/* Landing pages */}
          {currentPage === 'landing' && <LandingPage />}
          {currentPage === 'landing_v2' && <LandingPageV2 />}
          {currentPage === 'landing_premium' && <LandingPagePremium />}
          
          {/* Simplified one-question-per-screen creation flow (/crear) — local
              rebuild from the 2026-08 UX audit; classic funnel below untouched. */}
          {currentPage === 'crear' && <SimpleCreateFlow />}

          {/* Funnel pages */}
          {currentPage === 'genre' && <GenreStep />}
          {currentPage === 'artist' && <ArtistStep />}
          {currentPage === 'subgenre' && <SubGenreStep />}
          {currentPage === 'occasion' && <OccasionStep />}
          {currentPage === 'names' && <NamesStep />}
          {currentPage === 'voice' && <VoiceStep />}
          {currentPage === 'details' && <DetailsStep />}
          {currentPage === 'email' && <EmailStep />}
          {currentPage === 'generating' && <GeneratingPage />}
          {currentPage === 'preview' && <PreviewPage />}
          {currentPage === 'comparison' && <ComparisonPage />}
          {currentPage === 'success' && <SuccessPage />}
          {currentPage === 'listen' && <ShareablePreviewPage />}
          {currentPage === 'songPage' && <SongPage />}
          {currentPage === 'karaokePage' && <KaraokePage />}
          {currentPage === 'recoverSong' && <RecoverSongPage />}
          {currentPage === 'calificar' && <ReviewPage />}
          
          {/* Admin pages */}
          {currentPage === 'adminLogin' && <AdminLogin />}
          {currentPage === 'adminDashboard' && <AdminDashboard />}

          {/* Affiliate portal pages */}
          {currentPage === 'affiliateLanding' && <AffiliateLanding />}
          {currentPage === 'affiliateVSL' && <AffiliateVSL />}
          {currentPage === 'affiliateLogin' && <AffiliateLogin />}
          {currentPage === 'affiliateResetPassword' && <AffiliateResetPassword />}
          {currentPage === 'affiliateOnboarding' && <AffiliateOnboarding />}
          {currentPage === 'affiliateDashboard' && <AffiliateDashboard />}
          {currentPage === 'affiliateTerms' && <AffiliateTerms />}

          {/* Legal pages */}
          {currentPage === 'privacyPolicy' && <PrivacyPolicy />}
          {currentPage === 'termsOfService' && <TermsOfService />}
          {currentPage === 'smsConsentPreview' && <SmsConsentPreview />}
          {currentPage === 'smsConsentMarketingPreview' && <SmsConsentMarketingPreview />}

          {/* Clone Mi Voz — standalone voice-cloning tier (/clonamivoz).
              Not part of the main genre→artist→subgenre funnel; runs its
              own state, talks to its own edge functions (upload-customer-voice,
              generate-cloned-voice-lyrics, generate-cloned-voice-song,
              cloned-voice-status). Beta — no Stripe wiring yet. */}
          {currentPage === 'clonamivoz' && <ClonaMiVoz />}

          {/* Store — e-commerce catalog of the song + all upsells (/tienda) */}
          {currentPage === 'store' && <StorePage />}

          {/* Paquete — bundle landing: song + Animado video in one page (/paquete) */}
          {currentPage === 'paquete' && <PaqueteLanding />}

          {/* Paquete checkout — dedicated single-product checkout for /paquete buyers */}
          {currentPage === 'paqueteCheckout' && <PaqueteCheckout />}

          {/* 3-song pack post-purchase confirmation (/pack-listo) */}
          {currentPage === 'packReady' && <PackReadyPage />}

          {/* Local preview of the Animado story-video upsell (offer + photo upload).
              Demo-only route; not linked from the funnel yet. */}
          {currentPage === 'animadoDemo' && <AnimadoUpsell />}

          {/* Local preview of the post-purchase one-tap secondary upsell (/upsell-demo). */}
          {currentPage === 'upsellDemo' && <OneTapUpsellDemo />}

          {/* SEO Hub pages */}
          {currentPage === 'generos' && <GenerosHub />}
          {currentPage === 'ocasiones' && <OcasionesHub />}
          {currentPage === 'comoFunciona' && <ComoFunciona />}
          {currentPage === 'preguntasFrecuentes' && <PreguntasFrecuentes />}
          {currentPage === 'sobreNosotros' && <SobreNosotros />}
          {currentPage === 'cancionesParaRegalar' && <CancionesParaRegalarLanding />}
          {currentPage === 'diaDeLasMadres' && <DiaDeLasMadresLanding />}
          {currentPage === 'diaDelPadre' && <DiaDelPadreLanding />}
          {currentPage === 'corridos' && <CorridosLanding />}
          {currentPage === 'bachata' && <BachataLanding />}

          {/* SEO Dynamic Genre pages */}
          {currentPage.startsWith('generos/') && (
            <GenreLanding genreSlug={getSlugFromPage(currentPage, 'generos/')} />
          )}
          
          {/* SEO Dynamic Occasion pages */}
          {currentPage.startsWith('ocasiones/') && (
            <OccasionLanding occasionSlug={getSlugFromPage(currentPage, 'ocasiones/')} />
          )}

          {/* SEO Combo pages (genre + occasion) */}
          {currentPage.startsWith('canciones/') && (() => {
            const slug = getSlugFromPage(currentPage, 'canciones/');
            const combo = getComboBySlug(slug);
            return combo ? (
              <ComboLanding genreSlug={combo.genreSlug} occasionSlug={combo.occasionSlug} />
            ) : <NotFoundPage />;
          })()}

          {/* 404 Not Found */}
          {currentPage === 'notFound' && <NotFoundPage />}

          {/* WhatsApp floating button - only on landing, comparison, and success pages */}
          {(currentPage === 'landing' || currentPage === 'landing_v2' || currentPage === 'landing_premium' || currentPage === 'comparison' || currentPage === 'success' || currentPage === 'store') && (
            <WhatsAppButton />
          )}
        </div>
      </AppContext.Provider>
    </HelmetProvider>
  );
}
