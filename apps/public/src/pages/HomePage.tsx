import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { publicApi } from '../api.js';
import { AlertCard, AlertBannerEmpty } from '../components/AlertBanner.js';
import { StatCard } from '../components/StatCard.js';

const HAZARD_FR: Record<string, string> = {
  flood:            'Inondation',
  conflict:         'Conflit armé',
  health_epidemic:  'Épidémie',
  mass_displacement:'Déplacement',
  drought:          'Sécheresse',
  other:            'Autre',
};

export function HomePage() {
  const { data: alerts,  isLoading: loadingAlerts }  = useQuery({ queryKey: ['public-alerts'],  queryFn: publicApi.getAlerts,  staleTime: 60_000 });
  const { data: stats,   isLoading: loadingStats }   = useQuery({ queryKey: ['public-stats'],   queryFn: publicApi.getStats,   staleTime: 300_000 });

  return (
    <div>
      {/* Hero */}
      <div className="bg-gradient-to-br from-rdc-red via-sinaur-700 to-sinaur-900 text-white py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            Portail Public SINAUR-RDC
          </h1>
          <p className="text-red-100 text-lg mb-6 max-w-2xl">
            Alertes officielles, statistiques et données ouvertes sur les sinistres en
            République Démocratique du Congo.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/carte"
              className="px-5 py-2.5 bg-white text-rdc-red font-semibold rounded-lg hover:bg-gray-100 transition-colors"
            >
              🗺️ Voir la carte
            </Link>
            <Link
              to="/donnees"
              className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-lg border border-white/30 transition-colors"
            >
              📥 Télécharger les données HXL
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-10">

        {/* Stats */}
        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Situation actuelle</h2>
          {loadingStats ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 bg-gray-200 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Alertes actives"       value={stats.activeAlerts}       icon="🚨" color="red"    subtitle="Alertes CAP publiques" />
              <StatCard label="Événements (7 jours)"  value={stats.events7d}           icon="⚠️" color="orange" subtitle="Derniers 7 jours" />
              <StatCard label="Événements (30 jours)" value={stats.totalEvents}        icon="📊" color="blue"   subtitle="Total enregistrés" />
              <StatCard label="Provinces touchées"    value={stats.affectedProvinces}  icon="🗺️" color="green"  subtitle="Sur 26 provinces" />
            </div>
          ) : null}
        </section>

        {/* Alertes actives */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">Alertes actives</h2>
            <a
              href="/public/feed.atom"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-sinaur-600 hover:text-sinaur-800 flex items-center gap-1"
            >
              📡 Flux Atom
            </a>
          </div>

          {loadingAlerts ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-32 bg-gray-200 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : alerts && alerts.length > 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {alerts.slice(0, 6).map(alert => (
                <AlertCard key={alert.identifier} alert={alert} />
              ))}
            </div>
          ) : (
            <AlertBannerEmpty />
          )}
        </section>

        {/* Types de risques */}
        {stats && stats.byHazardType.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Événements par type (30 derniers jours)</h2>
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
              {stats.byHazardType.map(({ hazardType, count }) => {
                const max = stats.byHazardType[0]?.count ?? 1;
                const pct = Math.round((count / max) * 100);
                return (
                  <div key={hazardType} className="flex items-center gap-3">
                    <div className="w-32 text-sm text-gray-600 shrink-0">{HAZARD_FR[hazardType] ?? hazardType}</div>
                    <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                      <div
                        className="h-full bg-sinaur-600 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="w-8 text-sm font-medium text-right text-gray-700">{count}</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Accès sans smartphone */}
        <section className="bg-gray-800 text-white rounded-xl p-6">
          <h2 className="font-semibold text-lg mb-2">📱 Accès sans smartphone — USSD</h2>
          <p className="text-gray-300 text-sm mb-3">
            Les citoyens sans accès à Internet peuvent utiliser le service USSD en composant :
          </p>
          <code className="block bg-gray-900 text-green-400 font-mono text-lg px-4 py-3 rounded-lg">
            *777*SINAUR#
          </code>
          <p className="text-gray-400 text-xs mt-3">
            Disponible en français, lingala, kiswahili, kikongo et tshiluba.
            Compatible Airtel, Orange, Vodacom RDC.
          </p>
        </section>

      </div>
    </div>
  );
}
