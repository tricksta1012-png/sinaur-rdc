import type { PublicAlert } from '../api.js';

const SEVERITY_COLORS: Record<string, string> = {
  Extreme:  'bg-red-700 text-white',
  Severe:   'bg-orange-600 text-white',
  Moderate: 'bg-yellow-500 text-gray-900',
  Minor:    'bg-blue-500 text-white',
  Unknown:  'bg-gray-500 text-white',
};

const URGENCY_LABELS: Record<string, string> = {
  Immediate: 'Immédiat',
  Expected:  'Prévu',
  Future:    'Futur',
  Past:      'Passé',
  Unknown:   '—',
};

export function AlertCard({ alert }: { alert: PublicAlert }) {
  const severityClass = SEVERITY_COLORS[alert.severity] ?? SEVERITY_COLORS.Unknown;
  const urgencyLabel  = URGENCY_LABELS[alert.urgency]   ?? alert.urgency;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      <div className={`px-4 py-2 flex items-center justify-between gap-2 ${severityClass}`}>
        <span className="font-semibold text-sm">{alert.severity}</span>
        <span className="text-xs opacity-80">{urgencyLabel}</span>
      </div>
      <div className="p-4">
        <div className="font-medium text-gray-900 text-sm leading-snug mb-2">{alert.headline}</div>
        <div className="flex flex-wrap gap-2 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span>📍</span>{alert.areaName || alert.areaPcode || '—'}
          </span>
          <span className="flex items-center gap-1">
            <span>🏷️</span>{alert.category || alert.event || '—'}
          </span>
          <span className="flex items-center gap-1">
            <span>🕐</span>{new Date(alert.sentAt).toLocaleDateString('fr-CD', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  );
}

export function AlertBannerEmpty() {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center text-green-700 text-sm">
      ✅ Aucune alerte active en ce moment
    </div>
  );
}
