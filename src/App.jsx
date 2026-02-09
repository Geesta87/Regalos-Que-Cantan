import React, { useState, useEffect } from 'react';
import { HelmetProvider } from 'react-helmet-async';

// Import all pages
import LandingPage from './pages/LandingPage';
import LandingPageV2 from './pages/LandingPageV2';
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
import WhatsAppButton from './components/WhatsAppButton';

// SEO Hub pages
import GenerosHub from './pages/seo/GenerosHub';
import OcasionesHub from './pages/seo/OcasionesHub';
import GenreLanding from './pages/seo/GenreLanding';
import OccasionLanding from './pages/seo/OccasionLanding';

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
  '/v2': 'landing_v2',
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
  '/admin': 'adminLogin',
  '/admin/dashboard': 'adminDashboard',
  '/generos': 'generos',
  '/ocasiones': 'ocasiones'
};

// Helper to get initial page from URL - runs BEFORE first render
function getInitialPage() {
  const path = window.location.pathname;
  const urlParams = new URLSearchParams(window.location.search);
  
  // Handle direct song links
  if (urlParams.get('song')) {
    return 'preview';
  }
  
  // Check for dynamic SEO routes
  if (path.startsWith('/generos/') && path !== '/generos/') {
    return path.substring(1);
  }
  if (path.startsWith('/ocasiones/') && path !== '/ocasiones/') {
    return path.substring(1);
  }
  
  // Check pathToPage mapping
  if (pathToPage[path]) {
    return pathToPage[path];
  }
  
  // Default to landing
  return 'landing';
}

// Helper to extract slug from page path
const getSlugFromPage = (page, prefix) => {
  return page.replace(prefix, '');
};

export default function App() {
  // ✅ FIX: Initialize currentPage from URL IMMEDIATELY (not in useEffect)
  const [currentPage, setCurrentPage] = useState(getInitialPage);
  const [formData, setFormData] = useState({
    genre: '',
    genreName: '',
    genreStyle: '',
    subGenre: '',
    subGenreName: '',
    subGenrePrompt: '',
    artistInspiration: '',
    occasion: '',
    occasionPrompt: '',
    customOccasion: '',
    emotionalTone: '',
    recipientName: '',
    senderName: '',
    relationship: '',
    details: '',
    email: '',
    voiceType: 'male'
  });
  const [songData, setSongData] = useState(null);
  const [directSongId, setDirectSongId] = useState(null);

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

    // Load form data from localStorage if not a direct URL navigation
    const savedFormData = localStorage.getItem(STORAGE_KEYS.FORM_DATA);
    const savedSongData = localStorage.getItem(STORAGE_KEYS.SONG_DATA);

    if (savedFormData) {
      try {
        setFormData(JSON.parse(savedFormData));
      } catch (e) {
        console.error('Error parsing saved form data:', e);
      }
    }
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
    if (currentPage && currentPage !== 'landing' && currentPage !== 'landing_v2') {
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
      landing_v2: '/v2',
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
      adminLogin: '/admin',
      adminDashboard: '/admin/dashboard',
      generos: '/generos',
      ocasiones: '/ocasiones'
    };
    
    const url = pageUrls[page] || '/';
    window.history.pushState({ page }, '', url);
    
    window.scrollTo(0, 0);
  };

  const clearSession = () => {
    localStorage.removeItem(STORAGE_KEYS.PAGE);
    localStorage.removeItem(STORAGE_KEYS.FORM_DATA);
    localStorage.removeItem(STORAGE_KEYS.SONG_DATA);
    setFormData({
      genre: '',
      genreName: '',
      genreStyle: '',
      subGenre: '',
      subGenreName: '',
      subGenrePrompt: '',
      artistInspiration: '',
      occasion: '',
      occasionPrompt: '',
      customOccasion: '',
      emotionalTone: '',
      recipientName: '',
      senderName: '',
      relationship: '',
      details: '',
      email: '',
      voiceType: 'male'
    });
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
          
          {/* Admin pages */}
          {currentPage === 'adminLogin' && <AdminLogin />}
          {currentPage === 'adminDashboard' && <AdminDashboard />}
          
          {/* SEO Hub pages */}
          {currentPage === 'generos' && <GenerosHub />}
          {currentPage === 'ocasiones' && <OcasionesHub />}
          
          {/* SEO Dynamic Genre pages */}
          {currentPage.startsWith('generos/') && (
            <GenreLanding genreSlug={getSlugFromPage(currentPage, 'generos/')} />
          )}
          
          {/* SEO Dynamic Occasion pages */}
          {currentPage.startsWith('ocasiones/') && (
            <OccasionLanding occasionSlug={getSlugFromPage(currentPage, 'ocasiones/')} />
          )}

          {/* WhatsApp floating button - only on landing, comparison, and success pages */}
          {(currentPage === 'landing' || currentPage === 'landing_v2' || currentPage === 'comparison' || currentPage === 'success') && (
            <WhatsAppButton />
          )}
        </div>
      </AppContext.Provider>
    </HelmetProvider>
  );
}
