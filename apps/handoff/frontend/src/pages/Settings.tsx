import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useWorkspace } from '../contexts/WorkspaceContext'
import Layout from '../components/layout/Layout'
import { PageHeader } from '../components/PageHeader'
import { api } from '../lib/api'

export default function Settings() {
  const { user } = useAuth()
  const { currentWorkspace, deleteWorkspace } = useWorkspace()
  const navigate = useNavigate()

  const [members, setMembers] = useState<Array<{
    id: string
    user_id: string
    name: string
    email: string
    role: string
    created_at: string
  }>>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load workspace members for team workspaces
  useEffect(() => {
    if (currentWorkspace?.type === 'team') {
      loadMembers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspace])

  const loadMembers = async () => {
    if (!currentWorkspace) return

    try {
      setLoadingMembers(true)
      setError(null)
      const { members: fetchedMembers } = await api.getWorkspaceMembers(currentWorkspace.id)
      setMembers(fetchedMembers)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members')
    } finally {
      setLoadingMembers(false)
    }
  }

  const handleExport = async () => {
    if (!currentWorkspace) return

    try {
      setExporting(true)
      setError(null)
      const result = await api.exportWorkspaceData(currentWorkspace.id)

      // Create a download link
      const link = document.createElement('a')
      link.href = result.downloadUrl
      link.download = result.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export data')
    } finally {
      setExporting(false)
    }
  }

  const handleDelete = async () => {
    if (!currentWorkspace) return
    if (deleteConfirmText !== currentWorkspace.name) {
      setError('Workspace name does not match')
      return
    }

    try {
      setDeleting(true)
      setError(null)
      await deleteWorkspace(currentWorkspace.id)

      // Navigate away
      navigate('/briefs')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workspace')
    } finally {
      setDeleting(false)
    }
  }

  const isOwner = currentWorkspace?.owner_id === user?.id

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          kicker="Workspace"
          title="Settings"
          subtitle="Manage your workspace, members, and data exports."
          dense
        />

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-900">{error}</p>
          </div>
        )}

        {/* Workspace Members (Team only) */}
        {currentWorkspace?.type === 'team' && (
          <div className="rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Team members</h3>

            {isOwner && (
              <div className="mb-4 space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Invite by email
                </label>
                <div className="flex gap-3 flex-col sm:flex-row">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@example.com"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={inviting}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!inviteEmail.trim() || !currentWorkspace) return
                      try {
                        setInviting(true)
                        setError(null)
                        await api.addWorkspaceMember(currentWorkspace.id, { email: inviteEmail.trim() })
                        setInviteEmail('')
                        await loadMembers()
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Failed to invite member')
                      } finally {
                        setInviting(false)
                      }
                    }}
                    disabled={inviting || !inviteEmail.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {inviting ? 'Inviting...' : 'Invite'}
                  </button>
                </div>
                <p className="text-xs text-gray-500">Only owners can invite. The user must already exist (signed up) to join.</p>
              </div>
            )}

            {loadingMembers ? (
              <p className="text-gray-600">Loading members...</p>
            ) : members.length === 0 ? (
              <p className="text-gray-600">No members found.</p>
            ) : (
              <div className="space-y-3">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{member.name}</p>
                      <p className="text-sm text-gray-600">{member.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1 text-xs font-medium rounded-full ${member.role === 'owner'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-800'
                        }`}>
                        {member.role}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Data Export */}
        <div className="rounded-2xl border border-gray-200 bg-white/80 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Export data</h3>
          <p className="text-gray-600 mb-4">
            Download all your conversations, memories, and relationships as JSON files.
          </p>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || !currentWorkspace}
            className="px-4 py-2 rounded-xl bg-gray-900 text-sm font-semibold text-white shadow-sm hover:bg-black disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {exporting ? 'Exporting...' : 'Export Workspace Data'}
          </button>
        </div>

        {/* Delete Workspace */}
        {isOwner && (
          <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-red-900 mb-2">Delete workspace</h3>
            <p className="text-gray-600 mb-4">
              Permanently delete this workspace and all its data. This action cannot be undone.
            </p>

            {!showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete Workspace
              </button>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-900 font-medium mb-2">
                    Warning: This will permanently delete:
                  </p>
                  <ul className="text-sm text-red-800 list-disc list-inside space-y-1">
                    <li>All conversations and messages</li>
                    <li>All extracted memories</li>
                    <li>All relationships</li>
                    <li>All activity history</li>
                    <li>All workspace members (for team workspaces)</li>
                  </ul>
                </div>

                <div>
                  <label htmlFor="confirm-delete" className="block text-sm font-medium text-gray-700 mb-2">
                    Type the workspace name <span className="font-bold">{currentWorkspace?.name}</span> to confirm:
                  </label>
                  <input
                    id="confirm-delete"
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="Enter workspace name"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting || deleteConfirmText !== currentWorkspace?.name}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {deleting ? 'Deleting...' : 'Confirm Delete'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteConfirm(false)
                      setDeleteConfirmText('')
                      setError(null)
                    }}
                    disabled={deleting}
                    className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!isOwner && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Workspace</h3>
            <p className="text-gray-600">
              Only the workspace owner can delete this workspace.
            </p>
          </div>
        )}
      </div>
    </Layout>
  )
}
