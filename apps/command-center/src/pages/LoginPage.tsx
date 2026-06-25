import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';

export function LoginPage() {
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const login    = useAuthStore(s => s.login);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/ops', { replace: true });
    } catch {
      setError('Identifiants invalides ou accès non autorisé.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🛡️</div>
          <h1 className="text-white font-bold text-xl">SINAUR-RDC</h1>
          <p className="text-cc-600 text-sm font-mono mt-1">CENTRE DE COMMANDEMENT</p>
          <div className="mt-2 h-px bg-cc-700 mx-8" />
          <p className="text-cc-600 text-xs mt-2">Accès réservé au personnel autorisé</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-cc-600 font-mono uppercase tracking-wider mb-1.5">
              Adresse e-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="username"
              className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-cc-600 focus:outline-none focus:border-sinaur-600 focus:ring-1 focus:ring-sinaur-600"
              placeholder="utilisateur@sinaur-rdc.cd"
            />
          </div>

          <div>
            <label className="block text-xs text-cc-600 font-mono uppercase tracking-wider mb-1.5">
              Mot de passe
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2.5 pr-10 text-sm text-gray-100 placeholder-cc-600 focus:outline-none focus:border-sinaur-600 focus:ring-1 focus:ring-sinaur-600"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-cc-500 hover:text-gray-300 transition-colors select-none"
                tabIndex={-1}
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                {showPassword ? (
                  // Œil barré
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  // Œil ouvert
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-950 border border-red-800 rounded-lg px-3 py-2.5 text-red-300 text-xs">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-sinaur-700 hover:bg-sinaur-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            {loading ? 'Connexion…' : 'Accéder au centre de commandement'}
          </button>
        </form>

        <p className="text-center text-xs text-cc-600 mt-6">
          Toutes les sessions sont auditées — §9 SINAUR-RDC
        </p>
      </div>
    </div>
  );
}
