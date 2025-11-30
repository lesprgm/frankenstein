import { useState, FormEvent } from 'react'
import { useWorkspace } from '../contexts/WorkspaceContext'

interface CreateWorkspaceModalProps {
  onClose: () => void
}

export default function CreateWorkspaceModal({ onClose }: CreateWorkspaceModalProps) {
  const { createWorkspace } = useWorkspace()
  const [name, setName] = useState('')
  const [type, setType] = useState<'personal' | 'team'>('personal')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    
    if (!name.trim()) {
      setError('Workspace name is required')
      return
    }

    try {
      setIsSubmitting(true)
      setError('')
      await createWorkspace(name.trim(), type)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Create Workspace</h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="workspace-name" className="block text-sm font-medium text-gray-700 mb-2">
              Workspace Name
            </label>
            <input
              id="workspace-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Team Workspace"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Workspace Type
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="radio"
                  name="workspace-type"
                  value="personal"
                  checked={type === 'personal'}
                  onChange={(e) => setType(e.target.value as 'personal')}
                  className="mt-1"
                  disabled={isSubmitting}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="font-medium text-gray-900">Personal</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    For your private conversations and memories
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="radio"
                  name="workspace-type"
                  value="team"
                  checked={type === 'team'}
                  onChange={(e) => setType(e.target.value as 'team')}
                  className="mt-1"
                  disabled={isSubmitting}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span className="font-medium text-gray-900">Team</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    Share conversations and memories with your team
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
