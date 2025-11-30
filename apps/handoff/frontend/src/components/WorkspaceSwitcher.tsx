import { useState, useRef, useEffect } from 'react'
import { useWorkspace } from '../contexts/WorkspaceContext'
import CreateWorkspaceModal from './CreateWorkspaceModal'

export default function WorkspaceSwitcher() {
  const { workspaces, currentWorkspace, switchWorkspace, isSwitching } = useWorkspace()
  const [isOpen, setIsOpen] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const getWorkspaceIcon = (type: 'personal' | 'team') => {
    if (type === 'personal') {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      )
    }
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    )
  }

  const handleWorkspaceSelect = (workspaceId: string) => {
    switchWorkspace(workspaceId)
    setIsOpen(false)
  }

  const handleCreateWorkspace = () => {
    setIsOpen(false)
    setShowCreateModal(true)
  }

  if (!currentWorkspace) {
    return null
  }

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={isSwitching}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSwitching ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          ) : (
            <span className="text-gray-600">
              {getWorkspaceIcon(currentWorkspace.type)}
            </span>
          )}
          <span className="text-gray-900 font-medium">{currentWorkspace.name}</span>
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
            <div className="py-1">
              <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">
                Your Workspaces
              </div>
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => handleWorkspaceSelect(workspace.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${
                    workspace.id === currentWorkspace.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <span className={workspace.id === currentWorkspace.id ? 'text-blue-600' : 'text-gray-600'}>
                    {getWorkspaceIcon(workspace.type)}
                  </span>
                  <div className="flex-1 text-left">
                    <div className={`font-medium ${workspace.id === currentWorkspace.id ? 'text-blue-900' : 'text-gray-900'}`}>
                      {workspace.name}
                    </div>
                    <div className="text-xs text-gray-500 capitalize">
                      {workspace.type}
                    </div>
                  </div>
                  {workspace.id === currentWorkspace.id && (
                    <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
            <div className="border-t border-gray-200">
              <button
                type="button"
                onClick={handleCreateWorkspace}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="font-medium">Create Workspace</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateWorkspaceModal onClose={() => setShowCreateModal(false)} />
      )}
    </>
  )
}
