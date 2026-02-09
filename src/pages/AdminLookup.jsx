import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const BASE_URL = 'https://www.regalosquecantan.com';

export default function AdminLookup() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('email'); // 'email' or 'name'
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState(false);

  // Simple password gate — change this to your own password
  const ADMIN_PASSWORD = 'rqc2024admin';

  const handleAuth = () => {
    if (password === ADMIN_PASSWORD) {
      setAuthenticated(true);
      setAuthError(false);
    } else {
      setAuthError(true);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setSearched(true);

    try {
      let query = supabase
        .from('songs')
        .select('id, recipient_name, sender_name, email, genre, genre_name, occasion, status, audio_url, image_url, created_at, version, session_id')
        .order('created_at', { ascending: false })
        .limit(20);

      if (searchType === 'email') {
        query = query.ilike('email', `%${searchQuery.trim()}%`);
      } else {
        query = query.ilike('recipient_name', `%${searchQuery.trim()}%`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Search error:', error);
        setResults([]);
      } else {
        setResults(data || []);
      }
    } catch (err) {
      console.error('Search error:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getPreviewLink = (songId) => `${BASE_URL}/listen?song_id=${songId}`;
  const getSuccessLink = (songId) => `${BASE_URL}/success?song_id=${songId}`;

  const getStatusBadge = (song) => {
    const isPaid = song.status === 'paid' || song.status === 'completed';
    const hasAudio = !!song.audio_url;

    if (isPaid) return { label: 'Pagada', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' };
    if (hasAudio) return { label: 'Lista (no pagada)', color: '#f5d77a', bg: 'rgba(245,215,122,0.15)' };
    return { label: 'Generando', color: '#f97316', bg: 'rgba(249,115,22,0.15)' };
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-MX', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // ==================== AUTH GATE ====================
  if (!authenticated) {
    return (
      <div style={{background: 'linear-gradient(160deg, #0f2027, #1a3a2f, #162832)', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'}}>
        <div style={{maxWidth: '380px', width: '100%', textAlign: 'center'}}>
          <div style={{fontSize: '48px', marginBottom: '16px'}}>🔒</div>
          <h1 style={{fontSize: '22px', fontWeight: 'bold', marginBottom: '8px'}}>Admin Lookup</h1>
          <p style={{fontSize: '14px', color: 'rgba(255,255,255,0.5)', marginBottom: '24px'}}>Ingresa la contraseña para continuar</p>

          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setAuthError(false); }}
            onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
            placeholder="Contraseña"
            style={{
              width: '100%', padding: '14px 16px',
              background: 'rgba(255,255,255,0.08)',
              border: `2px solid ${authError ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
              borderRadius: '10px', color: 'white',
              fontSize: '16px', outline: 'none',
              boxSizing: 'border-box', marginBottom: '12px',
              textAlign: 'center'
            }}
          />

          {authError && (
            <p style={{fontSize: '13px', color: '#f87171', marginBottom: '12px'}}>Contraseña incorrecta</p>
          )}

          <button
            onClick={handleAuth}
            style={{
              width: '100%', padding: '14px',
              background: '#22c55e', color: 'white',
              border: 'none', borderRadius: '10px',
              fontSize: '16px', fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Entrar
          </button>
        </div>
      </div>
    );
  }

  // ==================== MAIN LOOKUP PAGE ====================
  return (
    <div style={{background: 'linear-gradient(160deg, #0f2027, #1a3a2f, #162832)', color: 'white', minHeight: '100vh', padding: '20px 16px 40px'}}>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={{maxWidth: '600px', margin: '0 auto'}}>

        {/* Header */}
        <div style={{textAlign: 'center', marginBottom: '30px'}}>
          <h1 style={{fontSize: '24px', fontWeight: 'bold', marginBottom: '6px'}}>
            🔍 Buscar Canciones
          </h1>
          <p style={{fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: 0}}>
            Busca por email o nombre del destinatario
          </p>
        </div>

        {/* Search bar */}
        <div style={{
          background: 'rgba(255,255,255,0.06)', borderRadius: '16px',
          padding: '20px', marginBottom: '24px',
          border: '1px solid rgba(255,255,255,0.1)'
        }}>
          {/* Search type toggle */}
          <div style={{display: 'flex', gap: '8px', marginBottom: '12px'}}>
            {[
              { value: 'email', label: '📧 Email' },
              { value: 'name', label: '👤 Nombre' }
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setSearchType(opt.value)}
                style={{
                  flex: 1, padding: '10px',
                  background: searchType === opt.value ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)',
                  border: `2px solid ${searchType === opt.value ? '#22c55e' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '8px', color: 'white',
                  fontSize: '14px', fontWeight: '600',
                  cursor: 'pointer', transition: 'all 0.2s'
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Search input */}
          <div style={{display: 'flex', gap: '8px'}}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={searchType === 'email' ? 'cliente@email.com' : 'Nombre del destinatario'}
              style={{
                flex: 1, padding: '14px 16px',
                background: 'rgba(255,255,255,0.08)',
                border: '2px solid rgba(255,255,255,0.15)',
                borderRadius: '10px', color: 'white',
                fontSize: '16px', outline: 'none'
              }}
            />
            <button
              onClick={handleSearch}
              disabled={loading || !searchQuery.trim()}
              style={{
                padding: '14px 20px',
                background: loading ? 'rgba(255,255,255,0.1)' : '#22c55e',
                color: 'white', border: 'none', borderRadius: '10px',
                fontSize: '16px', fontWeight: '600',
                cursor: loading ? 'wait' : 'pointer',
                opacity: !searchQuery.trim() ? 0.5 : 1
              }}
            >
              {loading ? '...' : '🔍'}
            </button>
          </div>
        </div>

        {/* Results */}
        {searched && (
          <div>
            {/* Results count */}
            <p style={{fontSize: '14px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px'}}>
              {results.length === 0
                ? '❌ No se encontraron canciones.'
                : `✅ ${results.length} canción${results.length > 1 ? 'es' : ''} encontrada${results.length > 1 ? 's' : ''}`
              }
            </p>

            {/* Song cards */}
            <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
              {results.map((song, index) => {
                const status = getStatusBadge(song);
                const isPaid = song.status === 'paid' || song.status === 'completed';
                const previewLink = getPreviewLink(song.id);
                const successLink = getSuccessLink(song.id);

                return (
                  <div
                    key={song.id}
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      borderRadius: '16px', padding: '20px',
                      border: '1px solid rgba(255,255,255,0.1)',
                      animation: `fadeIn 0.3s ease-out ${index * 0.05}s both`
                    }}
                  >
                    {/* Top row: name + status */}
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px'}}>
                      <div>
                        <h3 style={{fontSize: '17px', fontWeight: '700', margin: '0 0 4px 0'}}>
                          🎵 Para: {song.recipient_name}
                        </h3>
                        {song.sender_name && (
                          <p style={{fontSize: '13px', color: 'rgba(255,255,255,0.5)', margin: 0}}>
                            De: {song.sender_name}
                          </p>
                        )}
                      </div>
                      <span style={{
                        fontSize: '11px', fontWeight: '700',
                        padding: '4px 10px', borderRadius: '50px',
                        background: status.bg, color: status.color,
                        whiteSpace: 'nowrap'
                      }}>
                        {status.label}
                      </span>
                    </div>

                    {/* Details row */}
                    <div style={{
                      display: 'flex', gap: '12px', fontSize: '12px',
                      color: 'rgba(255,255,255,0.45)', marginBottom: '14px',
                      flexWrap: 'wrap'
                    }}>
                      {song.email && <span>📧 {song.email}</span>}
                      {(song.genre_name || song.genre) && <span>🎶 {song.genre_name || song.genre}</span>}
                      {song.version && <span>v{song.version}</span>}
                      <span>📅 {formatDate(song.created_at)}</span>
                    </div>

                    {/* Song ID (small, copyable) */}
                    <div style={{
                      background: 'rgba(0,0,0,0.2)', borderRadius: '8px',
                      padding: '8px 12px', marginBottom: '14px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                      <code style={{fontSize: '11px', color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                        {song.id}
                      </code>
                      <button
                        onClick={() => copyToClipboard(song.id, `id-${song.id}`)}
                        style={{
                          background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)',
                          cursor: 'pointer', fontSize: '12px', padding: '2px 6px', whiteSpace: 'nowrap'
                        }}
                      >
                        {copiedId === `id-${song.id}` ? '✅' : '📋'}
                      </button>
                    </div>

                    {/* Link buttons */}
                    <div style={{display: 'flex', gap: '8px'}}>
                      {/* Preview link — always show if audio exists */}
                      {song.audio_url && (
                        <button
                          onClick={() => copyToClipboard(previewLink, `preview-${song.id}`)}
                          style={{
                            flex: 1, padding: '12px',
                            background: copiedId === `preview-${song.id}` ? 'rgba(34,197,94,0.2)' : 'rgba(245,215,122,0.1)',
                            border: `2px solid ${copiedId === `preview-${song.id}` ? '#22c55e' : 'rgba(245,215,122,0.3)'}`,
                            borderRadius: '10px',
                            color: copiedId === `preview-${song.id}` ? '#4ade80' : '#f5d77a',
                            fontSize: '13px', fontWeight: '700',
                            cursor: 'pointer', transition: 'all 0.2s'
                          }}
                        >
                          {copiedId === `preview-${song.id}` ? '✅ ¡Copiado!' : '🎧 Copiar Preview Link'}
                        </button>
                      )}

                      {/* Success link — always show if audio exists */}
                      {song.audio_url && (
                        <button
                          onClick={() => copyToClipboard(successLink, `success-${song.id}`)}
                          style={{
                            flex: 1, padding: '12px',
                            background: copiedId === `success-${song.id}` ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.1)',
                            border: `2px solid ${copiedId === `success-${song.id}` ? '#22c55e' : 'rgba(34,197,94,0.3)'}`,
                            borderRadius: '10px',
                            color: copiedId === `success-${song.id}` ? '#4ade80' : '#22c55e',
                            fontSize: '13px', fontWeight: '700',
                            cursor: 'pointer', transition: 'all 0.2s'
                          }}
                        >
                          {copiedId === `success-${song.id}` ? '✅ ¡Copiado!' : '📥 Copiar Download Link'}
                        </button>
                      )}
                    </div>

                    {/* Quick open links */}
                    {song.audio_url && (
                      <div style={{display: 'flex', gap: '12px', marginTop: '10px', justifyContent: 'center'}}>
                        <a href={previewLink} target="_blank" rel="noopener noreferrer"
                          style={{fontSize: '12px', color: 'rgba(255,255,255,0.4)', textDecoration: 'underline'}}>
                          Abrir preview ↗
                        </a>
                        <a href={successLink} target="_blank" rel="noopener noreferrer"
                          style={{fontSize: '12px', color: 'rgba(255,255,255,0.4)', textDecoration: 'underline'}}>
                          Abrir success ↗
                        </a>
                      </div>
                    )}

                    {/* No audio yet */}
                    {!song.audio_url && (
                      <div style={{
                        background: 'rgba(249,115,22,0.1)', borderRadius: '10px',
                        padding: '10px', textAlign: 'center'
                      }}>
                        <p style={{fontSize: '12px', color: '#f97316', margin: 0}}>
                          ⏳ Canción aún no generada — no hay links disponibles
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <p style={{textAlign: 'center', marginTop: '40px', color: 'rgba(255,255,255,0.2)', fontSize: '12px'}}>
          RegalosQueCantan Admin • Solo uso interno
        </p>
      </div>
    </div>
  );
}
