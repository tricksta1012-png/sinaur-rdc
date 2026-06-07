const DATASETS = [
  {
    id: 'events-csv',
    title: 'Événements catastrophes (HXL CSV)',
    description: 'Événements anonymisés : type de risque, province, date, source. Format HXL conforme HDX/OCHA.',
    url: '/public/export/events.csv',
    filename: 'sinaur-rdc-events.csv',
    format: 'CSV + HXL',
    icon: '⚠️',
    license: 'CC BY 4.0',
    update: 'Temps réel',
  },
  {
    id: 'alerts-csv',
    title: 'Alertes CAP officielles (HXL CSV)',
    description: 'Alertes officielles au format CAP 1.2 exportées en HXL CSV. Sévérité, urgence, zone, catégorie.',
    url: '/public/export/alerts.csv',
    filename: 'sinaur-rdc-alerts.csv',
    format: 'CSV + HXL',
    icon: '🚨',
    license: 'CC BY 4.0',
    update: 'Temps réel',
  },
  {
    id: 'atom-feed',
    title: 'Flux Atom 1.0 — Alertes actives',
    description: 'Flux Atom standard pour agrégateurs RSS/news. Alertes actives de niveau Public.',
    url: '/public/feed.atom',
    filename: 'sinaur-rdc-alerts.atom',
    format: 'Atom XML',
    icon: '📡',
    license: 'CC BY 4.0',
    update: 'Temps réel',
  },
];

const API_ENDPOINTS = [
  {
    method: 'GET',
    path: '/public/alerts',
    description: 'Alertes CAP actives (JSON)',
    rateLimit: '200 req/min',
  },
  {
    method: 'GET',
    path: '/public/events?page=1&limit=20',
    description: 'Événements anonymisés paginés (JSON)',
    rateLimit: '60 req/min',
  },
  {
    method: 'GET',
    path: '/public/stats',
    description: 'Statistiques agrégées par province et type (JSON)',
    rateLimit: '200 req/min',
  },
  {
    method: 'GET',
    path: '/public/export/events.csv',
    description: 'Export HXL CSV — événements (jusqu\'à 5000 lignes)',
    rateLimit: '10 req/min',
  },
  {
    method: 'GET',
    path: '/public/export/alerts.csv',
    description: 'Export HXL CSV — alertes (jusqu\'à 1000 lignes)',
    rateLimit: '10 req/min',
  },
  {
    method: 'GET',
    path: '/public/feed.atom',
    description: 'Flux Atom 1.0 + CAP 1.2 (20 alertes récentes)',
    rateLimit: '30 req/min',
  },
];

export function DonneesPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-12">

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Données ouvertes</h1>
        <p className="text-gray-500 text-sm mt-1">
          Toutes les données sont strictement anonymisées — aucune information personnelle.
          Conformes aux standards <strong>HXL</strong>, <strong>CAP 1.2</strong> et <strong>P-codes OCHA COD-AB</strong>.
        </p>
      </div>

      {/* Datasets */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-4">Jeux de données disponibles</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {DATASETS.map(ds => (
            <div key={ds.id} className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{ds.icon}</span>
                <div>
                  <div className="font-semibold text-gray-800 text-sm">{ds.title}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{ds.format}</div>
                </div>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed flex-1">{ds.description}</p>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>🔄 {ds.update}</span>
                <span>⚖️ {ds.license}</span>
              </div>
              <a
                href={ds.url}
                download={ds.filename}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-sinaur-600 hover:bg-sinaur-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                📥 Télécharger
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* API REST */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-2">API REST publique</h2>
        <p className="text-sm text-gray-500 mb-4">
          Accès direct sans clé API. Aucune authentification requise pour les endpoints <code className="bg-gray-100 px-1 rounded">/public/*</code>.
          Base URL : <code className="bg-gray-100 px-1 rounded">https://api.sinaur-rdc.cd</code>
        </p>
        <div className="bg-gray-900 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-700">
              <tr>
                <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs uppercase w-16">Méthode</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs uppercase">Endpoint</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium text-xs uppercase hidden md:table-cell">Description</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium text-xs uppercase hidden lg:table-cell">Limite</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {API_ENDPOINTS.map(ep => (
                <tr key={ep.path} className="hover:bg-gray-800/50">
                  <td className="px-4 py-3">
                    <span className="text-xs font-bold text-green-400">{ep.method}</span>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-blue-300 text-xs">{ep.path}</code>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs hidden md:table-cell">{ep.description}</td>
                  <td className="px-4 py-3 text-right text-gray-500 text-xs hidden lg:table-cell">{ep.rateLimit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Standards */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-4">Standards et interopérabilité</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            { label: 'HXL (Humanitarian Exchange Language)', desc: 'Hashtags de métadonnées sur les en-têtes CSV pour l\'écosystème humanitaire (HDX, OCHA)', href: 'https://hxlstandard.org' },
            { label: 'CAP 1.2 (Common Alerting Protocol)', desc: 'ITU-T X.1303 — standard international pour les alertes officielles', href: 'https://docs.oasis-open.org/emergency/cap/v1.2' },
            { label: 'P-codes OCHA COD-AB RDC', desc: 'Codes géographiques officiels des divisions administratives de la RDC', href: 'https://data.humdata.org/dataset/cod-ab-cod' },
            { label: 'Atom 1.0 (RFC 4287)', desc: 'Flux de syndication standard compatible avec tous les agrégateurs de nouvelles', href: 'https://datatracker.ietf.org/doc/html/rfc4287' },
          ].map(s => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 bg-white border border-gray-200 rounded-xl p-4 hover:border-sinaur-300 hover:shadow-sm transition-all group"
            >
              <span className="text-sinaur-600 text-xl mt-0.5">📋</span>
              <div>
                <div className="font-medium text-sm text-gray-800 group-hover:text-sinaur-700">{s.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.desc}</div>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Licence */}
      <section className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-sm text-blue-800">
        <div className="font-semibold mb-1">⚖️ Licence et conditions d'utilisation</div>
        <p>
          Toutes les données publiées sur ce portail sont disponibles sous licence{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/deed.fr" target="_blank" rel="noopener noreferrer" className="underline font-medium">
            Creative Commons Attribution 4.0 International (CC BY 4.0)
          </a>.
          Citation requise : <em>SINAUR-RDC, Gouvernement de la République Démocratique du Congo</em>.
        </p>
        <p className="mt-2 text-blue-600">
          Les données ont été anonymisées. Aucune donnée personnelle n'est publiée.
          Conformité : RBAC §9 spec SINAUR-RDC, principes HDX/OCHA de protection des données.
        </p>
      </section>

    </div>
  );
}
