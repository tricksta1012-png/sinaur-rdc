interface StatCardProps {
  label: string
  value: number | string
  icon: string
  color?: 'red' | 'orange' | 'blue' | 'green' | 'gray'
  subtitle?: string
}

const COLOR_MAP = {
  red:    'bg-red-50 border-red-200 text-red-700',
  orange: 'bg-orange-50 border-orange-200 text-orange-700',
  blue:   'bg-blue-50 border-blue-200 text-blue-700',
  green:  'bg-green-50 border-green-200 text-green-700',
  gray:   'bg-gray-50 border-gray-200 text-gray-700',
};

const VALUE_COLOR_MAP = {
  red:    'text-red-800',
  orange: 'text-orange-800',
  blue:   'text-blue-800',
  green:  'text-green-800',
  gray:   'text-gray-800',
};

export function StatCard({ label, value, icon, color = 'gray', subtitle }: StatCardProps) {
  return (
    <div className={`border rounded-xl p-5 ${COLOR_MAP[color]}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide opacity-70 mb-1">{label}</div>
          <div className={`text-3xl font-bold ${VALUE_COLOR_MAP[color]}`}>{value}</div>
          {subtitle && <div className="text-xs mt-1 opacity-70">{subtitle}</div>}
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
    </div>
  );
}
