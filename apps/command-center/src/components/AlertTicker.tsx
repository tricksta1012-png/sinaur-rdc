import type { FeedEvent } from '../hooks/useRealtimeFeed.js';

const SEVERITY_BG: Record<string, string> = {
  Extreme:  'bg-red-700',
  Severe:   'bg-orange-700',
  Moderate: 'bg-yellow-700',
  Minor:    'bg-blue-800',
};

interface Props {
  alerts: (FeedEvent & { receivedAt: string })[];
}

export function AlertTicker({ alerts }: Props) {
  const alertItems = alerts.filter(e => e.type === 'NEW_ALERT') as
    (Extract<FeedEvent, { type: 'NEW_ALERT' }> & { receivedAt: string })[];

  if (alertItems.length === 0) return null;

  return (
    <div className="flex items-center bg-red-950 border-b border-red-800 shrink-0 overflow-hidden h-8">
      <div className="shrink-0 px-3 py-1 bg-red-700 text-white text-xs font-bold font-mono tracking-wider">
        ⚡ ALERTE
      </div>
      <div className="flex-1 overflow-hidden">
        <div
          className="flex gap-8 whitespace-nowrap"
          style={{
            animation: 'ticker 30s linear infinite',
          }}
        >
          {alertItems.map((a, i) => (
            <span key={i} className="text-xs text-red-200">
              <span className={`inline-block px-1.5 py-0.5 rounded text-xs mr-2 ${SEVERITY_BG[a.payload.severity] ?? 'bg-gray-700'}`}>
                {a.payload.severity}
              </span>
              {a.payload.headline}
              {a.payload.areaPcode && <span className="text-red-400 ml-1">— {a.payload.areaPcode}</span>}
            </span>
          ))}
          {/* duplicate for seamless loop */}
          {alertItems.map((a, i) => (
            <span key={`dup-${i}`} className="text-xs text-red-200">
              <span className={`inline-block px-1.5 py-0.5 rounded text-xs mr-2 ${SEVERITY_BG[a.payload.severity] ?? 'bg-gray-700'}`}>
                {a.payload.severity}
              </span>
              {a.payload.headline}
            </span>
          ))}
        </div>
      </div>
      <style>{`
        @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      `}</style>
    </div>
  );
}
