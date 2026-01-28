import React, { useState, useEffect } from 'react';
import { HelmetProvider } from 'react-helmet-async';

// Import all existing pages
import LandingPage from './pages/LandingPage';
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

// Import SEO landing pages
import GenerosHub from './pages/seo/GenerosHub';
import OcasionesHub from './pages/seo/OcasionesHub';
import GenreLanding from './pages/seo/GenreLanding';
import OccasionLanding from './pages/seo/OccasionLanding';

// Import SEO data for route validation
import { getGenreBySlug, getOccasionBySlug } from './data/seoData';

// App State Context
export const AppContext = React.createContext();

// App version - INCREMENT THIS TO FORCE CACHE CLEAR
const APP_VERSION = '2.1.0';

// Storage keys
const STORAGE_KEYS = {
  VERSION: 'rqc_version',
  PAGE: 'rqc_currentPage',
  FORM_DATA: 'rqc_formData',
  SONG_DATA: 'rqc_songData'
};

// Check version and clear old data if needed
const checkVersion = () => {
  const storedVersion = localStorage.getItem(STORAGE_KEYS.VERSION);
  if (storedVersion !== APP_VERSION) {
    sessionStorage.clear();
    localStorage.setItem(STORAGE_KEYS.VERSION, APP_VERSION);
    console.log(`App updated from ${storedVersion} to ${APP_VERSION} - cleared cache`);
    return true;
  }
  return false;
};

const versionChanged = checkVersion();

// Detect if this is a fresh navigation (new tab/window) vs a refresh
const isPageRefresh = () => {
  if (performance.getEntriesByType) {
    const navEntries = performance.getEntriesByType('navigation');
    if (navEntries.length > 0 && navEntries[0].type === 'reload') {
      return true;
    }
  }
  if (performance.navigation) {
    return performance.navigation.type === 1;
  }
  return false;
};

// Check if coming from a direct URL route
const isDirectRoute = () => {
  const path = window.location.pathname;
  return path.startsWith('/preview/') || 
         path.startsWith('/create/') || 
         path.startsWith('/generos/') ||
         path.startsWith('/ocasiones/') ||
         path === '/generos' ||
         path === '/ocasiones' ||
         path === '/admin' || 
         path === '/admin/dashboard' ||
         path === '/success' ||
         path === '/comparison' ||
         path === '/como-funciona' ||
         path === '/precios' ||
         path === '/ejemplos';
};

// Map URL to page name - UPDATED with SEO routes
const getPageFromUrl = () => {
  const path = window.location.pathname;
  
  // SEO Hub pages
  if (path === '/generos') return 'generos';
  if (path === '/ocasiones') return 'ocasiones';
  
  // SEO Landing pages - genres
  if (path.startsWith('/generos/')) {
    const slug = path.replace('/generos/', '').replace('/', '');
    if (getGenreBySlug(slug)) {
      return `generos/${slug}`;
    }
    return 'generos';
  }
  
  // SEO Landing pages - occasions
  if (path.startsWith('/ocasiones/')) {
    const slug = path.replace('/ocasiones/', '').replace('/', '');
    if (getOccasionBySlug(slug)) {
      return `ocasiones/${slug}`;
    }
    return 'ocasiones';
  }
  
  // Static info pages
  if (path === '/como-funciona') return 'comoFunciona';
  if (path === '/precios') return 'precios';
  if (path === '/ejemplos') return 'ejemplos';
  
  // Admin routes
  if (path === '/admin') return 'adminLogin';
  if (path === '/admin/dashboard') return 'adminDashboard';
  
  // Preview route with songId
  if (path.startsWith('/preview/')) return 'preview';
  if (path === '/preview') return 'preview';
  
  // Comparison page
  if (path === '/comparison') return 'comparison';
  
  // Success page
  if (path === '/success') return 'success';
  
  // Create flow routes
  if (path === '/create/genre') return 'genre';
  if (path === '/create/artist') return 'artist';
  if (path === '/create/subgenre') return 'subgenre';
  if (path === '/create/occasion') return 'occasion';
  if (path === '/create/names') return 'names';
  if (path === '/create/voice') return 'voice';
  if (path === '/create/details') return 'details';
  if (path === '/create/email') return 'email';
  if (path === '/create/generating') return 'generating';
  
  return null;
};

// Clear old session data on fresh visits
const initializeSession = () => {
  if (versionChanged) return true;
  
  const refresh = isPageRefresh();
  const directRoute = isDirectRoute();
  
  if (!refresh && !directRoute) {
    sessionStorage.removeItem(STORAGE_KEYS.PAGE);
    sessionStorage.removeItem(STORAGE_KEYS.FORM_DATA);
    sessionStorage.removeItem(STORAGE_KEYS.SONG_DATA);
    return true;
  }
  return false;
};

const isFreshStart = initializeSession();

// Load state from sessionStorage
const loadFromStorage = (key, defaultValue) => {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Error loading from storage:', e);
  }
  return defaultValue;
};

// Get songId from URL
const getSongIdFromUrl = () => {
  const path = window.location.pathname;
  const match = path.match(/^\/preview\/([a-zA-Z0-9-]+)/);
  return match ? match[1] : null;
};

// Get initial page
const getInitialPage = () => {
  const pageFromUrl = getPageFromUrl();
  if (pageFromUrl) return pageFromUrl;
  if (isFreshStart) return 'landing';
  return loadFromStorage(STORAGE_KEYS.PAGE, 'landing');
};

const initialSongId = getSongIdFromUrl();

// Default form data structure with ALL fields needed by generate-song
const defaultFormData = {
  genre: '',
  genreName: '',
  subGenre: '',
  subGenreName: '',
  artistInspiration: '',
  occasion: '',
  occasionName: '',
  customOccasion: '',
  emotionalTone: '',
  recipientName: '',
  senderName: '',
  relationship: '',
  customRelationship: '',
  details: '',
  voiceType: 'male',
  email: ''
};

export default function App() {
  const [currentPage, setCurrentPage] = useState(getInitialPage);
  const [directSongId, setDirectSongId] = useState(initialSongId);
  const [formData, setFormData] = useState(() => {
    const stored = loadFromStorage(STORAGE_KEYS.FORM_DATA, null);
    return { ...defaultFormData, ...stored };
  });
  const [songData, setSongData] = useState(() => 
    loadFromStorage(STORAGE_KEYS.SONG_DATA, null)
  );

  // Save to sessionStorage when state changes
  useEffect(() => {
    if (!currentPage.startsWith('admin') && !currentPage.startsWith('generos') && !currentPage.startsWith('ocasiones')) {
      sessionStorage.setItem(STORAGE_KEYS.PAGE, JSON.stringify(currentPage));
    }
  }, [currentPage]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEYS.FORM_DATA, JSON.stringify(formData));
  }, [formData]);

  useEffect(() => {
    if (songData) {
      sessionStorage.setItem(STORAGE_KEYS.SONG_DATA, JSON.stringify(songData));
    }
  }, [songData]);

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = (event) => {
      if (event.state?.page) {
        setCurrentPage(event.state.page);
      } else {
        const pageFromUrl = getPageFromUrl();
        if (pageFromUrl) {
          setCurrentPage(pageFromUrl);
        } else {
          setCurrentPage('landing');
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    
    if (!window.history.state?.page) {
      window.history.replaceState({ page: currentPage }, '', window.location.pathname);
    }
    
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const updateFormData = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const navigateTo = (page) => {
    setCurrentPage(page);
    
    const pageUrls = {
      landing: '/',
      generos: '/generos',
      ocasiones: '/ocasiones',
      comoFunciona: '/como-funciona',
      precios: '/precios',
      ejemplos: '/ejemplos',
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
      adminLogin: '/admin',
      adminDashboard: '/admin/dashboard'
    };
    
    let url = pageUrls[page];
    if (!url) {
      if (page.startsWith('generos/')) {
        url = `/${page}`;
      } else if (page.startsWith('ocasiones/')) {
        url = `/${page}`;
      } else {
        url = '/';
      }
    }
    
    window.history.pushState({ page }, '', url);
    window.scrollTo(0, 0);
  };

  const clearSession = () => {
    sessionStorage.removeItem(STORAGE_KEYS.PAGE);
    sessionStorage.removeItem(STORAGE_KEYS.FORM_DATA);
    sessionStorage.removeItem(STORAGE_KEYS.SONG_DATA);
    setFormData(defaultFormData);
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

  const getSlugFromPage = (page, prefix) => {
    if (page.startsWith(prefix)) {
      return page.replace(prefix, '');
    }
    return null;
  };

  return (
    <HelmetProvider>
      <AppContext.Provider value={contextValue}>
        <div className="min-h-screen bg-background-light dark:bg-background-dark transition-colors duration-300">
          {/* Original pages */}
          {currentPage === 'landing' && <LandingPage />}
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
        </div>
      </AppContext.Provider>
    </HelmetProvider>
  );
}
