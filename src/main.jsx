import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');

// Remove prerender-content div once React takes over
const prerenderEl = document.getElementById('prerender-content');
if (prerenderEl) prerenderEl.remove();

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
