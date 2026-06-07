import React from 'react'

interface PcodeDisplayProps {
  pcode: string
  name?: string
  level?: number
}

export function PcodeDisplay({ pcode, name, level }: PcodeDisplayProps) {
  const indent = level ? `pl-${Math.min(level * 2, 8)}` : ''
  return (
    <span className={`inline-flex items-center gap-1 ${indent}`}>
      {name && <span className="text-sm text-gray-900">{name}</span>}
      <code className="text-xs bg-gray-100 text-gray-500 px-1 rounded font-mono">{pcode}</code>
    </span>
  )
}

interface DateDisplayProps {
  iso: string
  format?: 'date' | 'datetime' | 'relative'
  locale?: string
}

export function DateDisplay({ iso, format = 'datetime', locale = 'fr-CD' }: DateDisplayProps) {
  const date = new Date(iso)

  if (format === 'relative') {
    const diffMs = Date.now() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1)  return <time dateTime={iso} title={iso}>à l'instant</time>
    if (diffMin < 60) return <time dateTime={iso} title={iso}>il y a {diffMin} min</time>
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24)   return <time dateTime={iso} title={iso}>il y a {diffH} h</time>
    const diffD = Math.floor(diffH / 24)
    return <time dateTime={iso} title={iso}>il y a {diffD} j</time>
  }

  const opts: Intl.DateTimeFormatOptions = format === 'date'
    ? { year: 'numeric', month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }

  const formatted = date.toLocaleString(locale, opts)
  return <time dateTime={iso}>{formatted}</time>
}
