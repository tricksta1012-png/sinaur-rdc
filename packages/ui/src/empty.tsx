import React from 'react'

interface EmptyStateProps {
  title: string
  description?: string
  icon?: React.ReactNode
  action?: React.ReactNode
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon && (
        <div className="text-gray-300 mb-4 text-5xl">{icon}</div>
      )}
      <h3 className="text-sm font-semibold text-gray-900 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 mb-4 max-w-sm">{description}</p>
      )}
      {action && <div>{action}</div>}
    </div>
  )
}

interface LoadingStateProps {
  message?: string
  rows?: number
}

export function LoadingState({ message = 'Chargement…', rows = 3 }: LoadingStateProps) {
  return (
    <div className="space-y-3 p-4" role="status" aria-label={message}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="animate-pulse flex space-x-3">
          <div className="rounded-full bg-gray-200 h-8 w-8 flex-shrink-0" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 bg-gray-200 rounded w-3/4" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
          </div>
        </div>
      ))}
      <span className="sr-only">{message}</span>
    </div>
  )
}
