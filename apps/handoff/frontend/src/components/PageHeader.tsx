import { ReactNode } from 'react'

interface PageHeaderProps {
  kicker?: string
  title: string
  subtitle?: string
  meta?: ReactNode
  action?: ReactNode
  dense?: boolean
}

export function PageHeader({ kicker, title, subtitle, meta, action, dense = false }: PageHeaderProps) {
  return (
    <header
      style={{
        borderRadius: 'var(--radius-xl)',
        border: '1px solid rgba(0, 0, 0, 0.06)',
        background: 'var(--color-bg-primary)',
        boxShadow: 'var(--shadow-xs)',
        padding: dense ? 'var(--space-3)' : 'var(--space-4)'
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {kicker && (
            <p style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--font-semibold)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--color-text-tertiary)'
            }}>
              {kicker}
            </p>
          )}
          <h1 style={{
            fontSize: 'var(--text-2xl)',
            fontWeight: 'var(--font-semibold)',
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.02em'
          }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              maxWidth: '48rem',
              lineHeight: '1.5'
            }}>
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {meta && (
            <div style={{
              textAlign: 'right',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)'
            }}>
              {meta}
            </div>
          )}
          {action}
        </div>
      </div>
    </header>
  )
}
