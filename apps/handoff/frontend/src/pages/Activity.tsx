import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useWorkspace } from '../contexts/WorkspaceContext'
import Layout from '../components/layout/Layout'
import { PageHeader } from '../components/PageHeader'
import ActivityFeed from '../components/ActivityFeed'

export default function Activity() {
  const { currentWorkspace, isLoading: workspaceLoading } = useWorkspace()
  const [selectedUserId, setSelectedUserId] = useState<string>('')

  // Redirect if not a team workspace
  if (!workspaceLoading && currentWorkspace?.type !== 'team') {
    return <Navigate to="/briefs" replace />
  }

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          kicker="Workspace feed"
          title="Team activity"
          subtitle="A gentle feed of imports, extractions and hand‑offs across your workspace."
          dense
        />

        {/* Filter by team member */}
        <div className="rounded-2xl border border-gray-200 bg-white/80 p-4 shadow-sm">
          <label htmlFor="user-filter" className="block text-sm font-medium text-gray-700 mb-2">
            Filter by team member
          </label>
          <select
            id="user-filter"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="w-full md:w-64 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All team members</option>
            {/* Team members would be populated here if we had the API endpoint */}
          </select>
          {selectedUserId && (
            <button
              type="button"
              onClick={() => setSelectedUserId('')}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800"
            >
              Clear filter
            </button>
          )}
        </div>

        {/* Activity feed */}
        {currentWorkspace && (
          <ActivityFeed
            workspaceId={currentWorkspace.id}
            userId={selectedUserId || undefined}
          />
        )}
      </div>
    </Layout>
  )
}
