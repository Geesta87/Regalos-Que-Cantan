import React, { useState, useContext } from 'react';
import { AppContext } from '../App';
import { supabase } from '../services/api';

// Login is backed by Supabase Auth. Users are created in Supabase Dashboard
// (Authentication → Users) and granted dashboard access by inserting a row
// into the `admin_users` table with role 'admin' or 'assistant'. There are
// no admin credentials in the JS bundle.

export default function AdminLogin() {
  const { navigateTo } = useContext(AppContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError || !data?.user) {
        setError('Email o contraseña incorrectos');
        setIsLoading(false);
        return;
      }

      // Confirm this user is registered in admin_users (RLS will only return
      // their own row — if no row exists they have no dashboard access).
      const { data: roleRow, error: roleError } = await supabase
        .from('admin_users')
        .select('role')
        .eq('user_id', data.user.id)
        .single();

      if (roleError || !roleRow) {
        await supabase.auth.signOut();
        setError('Este usuario no tiene acceso al panel');
        setIsLoading(false);
        return;
      }

      navigateTo('adminDashboard');
    } catch (err) {
      setError('No se pudo iniciar sesión. Inténtalo de nuevo.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-forest to-forest/90 flex items-center justify-center p-6">
      <div className="bg-white dark:bg-[#2c3136] rounded-2xl shadow-2xl p-8 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto bg-gradient-to-br from-gold/20 to-gold/10 rounded-full flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-gold text-3xl">admin_panel_settings</span>
          </div>
          <h1 className="text-2xl font-bold text-[#171612] dark:text-white">Admin Dashboard</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">RegalosQueCantan</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-[#171612] dark:text-white focus:ring-2 focus:ring-gold focus:border-transparent"
              placeholder="tu@email.com"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-[#171612] dark:text-white focus:ring-2 focus:ring-gold focus:border-transparent"
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-4 rounded-xl font-bold text-white bg-gradient-to-r from-gold to-gold/80 hover:brightness-110 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Verificando...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined">login</span>
                Iniciar Sesión
              </>
            )}
          </button>
        </form>

        {/* Back link */}
        <div className="text-center mt-6">
          <a
            href="/"
            className="text-gray-400 hover:text-gold transition-colors text-sm"
          >
            ← Volver al sitio
          </a>
        </div>
      </div>
    </div>
  );
}
