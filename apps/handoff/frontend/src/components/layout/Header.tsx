import { useAuth } from '../../contexts/AuthContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import WorkspaceSwitcher from '../WorkspaceSwitcher'
import { useNavigate } from 'react-router-dom'

export default function Header() {
  const { user, logout } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const getUserInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <header className="sticky top-0 z-50 glass-panel flex-none">
      <div className="px-6 py-4 md:px-10">
        <div className="flex items-center justify-between">
          {/* Logo and Workspace Switcher */}
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
              Handoff
            </h1>
            {currentWorkspace && <WorkspaceSwitcher />}
          </div>

          {/* User Avatar */}
          {user && (
            <div className="flex items-center gap-4">
              <button
                onClick={handleLogout}
                className="text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Sign out
              </button>
              <div className="w-9 h-9 rounded-full bg-[var(--color-accent-blue)] flex items-center justify-center text-white text-sm font-medium shadow-sm ring-2 ring-white ring-opacity-20">
                {getUserInitials(user.name)}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
