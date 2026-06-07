import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';

export function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
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
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-cc-600 focus:outline-none focus:border-sinaur-600 focus:ring-1 focus:ring-sinaur-600"
              placeholder="••••••••"
            />
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
