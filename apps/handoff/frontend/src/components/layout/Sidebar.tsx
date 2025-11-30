import { NavLink } from 'react-router-dom'
import { useWorkspace } from '../../contexts/WorkspaceContext'

export default function Sidebar() {
  const { currentWorkspace, isLoading } = useWorkspace()

  const navItems = [
    {
      name: 'Context',
      path: '/context',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
      showForTeam: true,
      showForPersonal: true,
    },
    {
      name: 'Chats',
      path: '/chats',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      ),
      showForTeam: true,
      showForPersonal: true,
    },
    {
      name: 'Ask',
      path: '/ask',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 11c0-1.105.895-2 2-2s2 .895 2 2-.895 2-2 2h-1v1m-4-3c0-1.105.895-2 2-2s2 .895 2 2-.895 2-2 2H8v1m4 4a9 9 0 100-18 9 9 0 000 18z" />
        </svg>
      ),
      showForTeam: true,
      showForPersonal: true,
    },
    {
      name: 'Sources',
      path: '/sources',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      ),
      showForTeam: true,
      showForPersonal: true,
    },
    {
      name: 'Activity',
      path: '/activity',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      showForTeam: true,
      showForPersonal: false,
    },
    {
      name: 'Settings',
      path: '/settings',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      showForTeam: true,
      showForPersonal: true,
    },
  ]

  const visibleNavItems = navItems.filter(item => {
    if (isLoading && !currentWorkspace) return item.showForPersonal
    if (!currentWorkspace) return false
    if (currentWorkspace.type === 'team') return item.showForTeam
    return item.showForPersonal
  })

  return (
    <aside className="w-64 bg-[var(--color-bg-secondary)] border-r border-[var(--color-border-subtle)] overflow-y-auto flex-shrink-0 backdrop-blur-xl bg-opacity-80">
      <nav className="p-4 space-y-1">
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${isActive
                ? 'bg-[var(--color-bg-primary)] text-[var(--color-accent-blue)] shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
              }`
            }
          >
            {item.icon}
            <span>{item.name}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
