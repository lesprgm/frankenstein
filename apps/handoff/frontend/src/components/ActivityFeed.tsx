import { useState, useEffect, useCallback } from 'react'
import { api, Activity } from '../lib/api'
import ActivityItem from './ActivityItem'
import { useInfiniteScroll } from '../hooks/useInfiniteScroll'
import LoadingSkeleton from './LoadingSkeleton'

interface ActivityFeedProps {
  workspaceId: string
  userId?: string
}

export default function ActivityFeed({ workspaceId, userId }: ActivityFeedProps) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const limit = 20

  const fetchActivities = useCallback(async (reset = false) => {
    const currentPage = reset ? 0 : page
    const isInitialLoad = currentPage === 0

    if (isInitialLoad) {
      setIsLoading(true)
    } else {
      setIsLoadingMore(true)
    }
    setError(null)

    try {
      const result = await api.getActivities({
        workspaceId,
        userId,
        limit,
        offset: currentPage * limit
      })

      if (reset || isInitialLoad) {
        setActivities(result.activities)
      } else {
        setActivities(prev => [...prev, ...result.activities])
      }

      setHasMore(result.activities.length === limit)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch activities'
      setError(message)
    } finally {
      setIsLoading(false)
      setIsLoadingMore(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, userId, limit])

  // Initial load and filter changes
  useEffect(() => {
    setPage(0)
    setActivities([])
    fetchActivities(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, userId])

  // Load more for infinite scroll
  const loadMore = useCallback(() => {
    if (!isLoading && !isLoadingMore && hasMore) {
      setPage(prev => prev + 1)
    }
  }, [isLoading, isLoadingMore, hasMore])

  // Trigger fetch when page changes
  useEffect(() => {
    if (page > 0) {
      fetchActivities()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  // Infinite scroll
  const { containerRef } = useInfiniteScroll(loadMore, {
    enabled: hasMore && !isLoading && !isLoadingMore,
  })

  if (isLoading && activities.length === 0) {
    return (
      <div className="space-y-3">
        <LoadingSkeleton type="list" count={5} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-sm text-red-800">{error}</p>
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="mt-4 text-lg font-medium text-gray-900">No activity yet</h3>
        <p className="mt-2 text-sm text-gray-600">
          Team activity will appear here as members import conversations and use the workspace.
        </p>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ maxHeight: 'calc(100vh - 16rem)', overflowY: 'auto' }}>
      <div className="space-y-3">
        {activities.map((activity) => (
          <ActivityItem key={activity.id} activity={activity} />
        ))}
      </div>

      {/* Loading more indicator */}
      {isLoadingMore && (
        <div className="mt-4 p-4 text-center">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-sm text-gray-600">Loading more activities...</p>
        </div>
      )}

      {/* End of list indicator */}
      {!isLoading && !isLoadingMore && activities.length > 0 && !hasMore && (
        <div className="mt-4 text-center py-4">
          <p className="text-sm text-gray-500">You've reached the end of the activity feed</p>
        </div>
      )}
    </div>
  )
}
