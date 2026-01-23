import React, { useState, useEffect } from 'react';

// Import all pages
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
import ComparisonPage from './pages/ComparisonPage';  // ← ADDED
import SuccessPage from './pages/SuccessPage';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';

// App State Context
export const AppContext = React.createContext();

// App version
const APP_VERSION = '1.7.0';

// Storage keys
const STORAGE_KEYS = {
  VERSION: 'rqc_version',
  PAGE: 'rqc_currentPage',
  FORM_DATA: 'rqc_formData',
  SONG_DATA: 'rqc_songData'
};

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
         path === '/admin' || 
         path === '/admin/dashboard' ||
         path === '/success' ||
         path === '/comparison';  // ← ADDED
};

// Map URL to page name
const getPageFromUrl = () => {
  const path = window.location.pathname;
  
  // Admin routes
  if (path === '/admin') return 'adminLogin';
  if (path === '/admin/dashboard') return 'adminDashboard';
  
  // Preview route with songId
  if (path.startsWith('/preview/')) return 'preview';
  if (path === '/preview') return 'preview';
  
  // Comparison page
  if (path === '/comparison') return 'comparison';  // ← ADDED
  
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

// Default form data structure with all fields
const defaultFormData = {
  // Genre selection
  genre: '',
  subGenre: '',
  
  // Artist inspiration
  artistInspiration: '',
  
  // Occasion
  occasion: '',
  customOccasion: '',
  emotionalTone: '',
  
  // Names & Relationship
  recipientName: '',
  senderName: '',
  relationship: '',
  customRelationship: '',
  
  // Details
  details: '',
  
  // Voice
  voiceType: '',
  
  // Contact
  email: ''
};

export default function App() {
  const [currentPage, setCurrentPage] = useState(getInitialPage);
  const [directSongId, setDirectSongId] = useState(initialSongId);
  const [formData, setFormData] = useState(() => 
    loadFromStorage(STORAGE_KEYS.FORM_DATA, defaultFormData)
  );
  const [songData, setSongData] = useState(() => 
    loadFromStorage(STORAGE_KEYS.SONG_DATA, null)
  );

  // Save to sessionStorage when state changes
  useEffect(() => {
    if (!currentPage.startsWith('admin')) {
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
    
    // Map pages to URLs
    const pageUrls = {
      landing: '/',
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
      comparison: '/comparison',  // ← ADDED
      success: '/success',
      adminLogin: '/admin',
      adminDashboard: '/admin/dashboard'
    };
    
    const url = pageUrls[page] || '/';
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

  return (
    <AppContext.Provider value={contextValue}>
      <div className="min-h-screen bg-background-light dark:bg-background-dark transition-colors duration-300">
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
        {currentPage === 'comparison' && <ComparisonPage />}  {/* ← ADDED */}
        {currentPage === 'success' && <SuccessPage />}
        {currentPage === 'adminLogin' && <AdminLogin />}
        {currentPage === 'adminDashboard' && <AdminDashboard />}
      </div>
    </AppContext.Provider>
  );
}
