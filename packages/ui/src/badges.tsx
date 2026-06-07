import React from 'react'

type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown'
type HazardType = 'flood' | 'conflict' | 'health_epidemic' | 'mass_displacement' | 'drought' | 'other' | string
type StatusKind = 'active' | 'monitoring' | 'closed' | 'pending' | 'todo' | 'in_progress' | 'blocked' | 'done' | string

const SEVERITY_STYLES: Record<SeverityLevel, string> = {
  Extreme:  'bg-red-100    text-red-800    border border-red-300',
  Severe:   'bg-orange-100 text-orange-800 border border-orange-300',
  Moderate: 'bg-yellow-100 text-yellow-800 border border-yellow-300',
  Minor:    'bg-blue-100   text-blue-800   border border-blue-300',
  Unknown:  'bg-gray-100   text-gray-600   border border-gray-300',
}

const HAZARD_LABELS: Record<string, string> = {
  flood:             'Inondation',
  conflict:          'Conflit',
  health_epidemic:   'Épidémie',
  mass_displacement: 'Déplacement',
  drought:           'Sécheresse',
  other:             'Autre',
}

const STATUS_STYLES: Record<string, string> = {
  active:      'bg-green-100  text-green-800  border border-green-300',
  monitoring:  'bg-blue-100   text-blue-800   border border-blue-300',
  closed:      'bg-gray-100   text-gray-500   border border-gray-300',
  pending:     'bg-yellow-100 text-yellow-800 border border-yellow-300',
  todo:        'bg-gray-100   text-gray-600   border border-gray-300',
  in_progress: 'bg-blue-100   text-blue-700   border border-blue-300',
  blocked:     'bg-red-100    text-red-700    border border-red-300',
  done:        'bg-green-100  text-green-700  border border-green-300',
}

const BASE = 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium'

export function SeverityBadge({ level }: { level: SeverityLevel | string }) {
  const cls = SEVERITY_STYLES[level as SeverityLevel] ?? SEVERITY_STYLES.Unknown
  return <span className={`${BASE} ${cls}`}>{level}</span>
}

export function HazardBadge({ type }: { type: HazardType }) {
  return (
    <span className={`${BASE} bg-purple-100 text-purple-800 border border-purple-300`}>
      {HAZARD_LABELS[type] ?? type}
    </span>
  )
}

export function StatusBadge({ status }: { status: StatusKind }) {
  const cls = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600 border border-gray-300'
  return <span className={`${BASE} ${cls}`}>{status}</span>
}
