import { useState, useEffect, useCallback, useRef } from 'react'

interface UseInfiniteScrollOptions {
  threshold?: number // Distance from bottom to trigger load (in pixels)
  enabled?: boolean // Whether infinite scroll is enabled
}

interface UseInfiniteScrollReturn {
  containerRef: React.RefObject<HTMLDivElement>
  isNearBottom: boolean
}

/**
 * Hook for implementing infinite scroll functionality
 * @param onLoadMore - Callback to load more items
 * @param options - Configuration options
 * @returns Container ref and near-bottom state
 */
export function useInfiniteScroll(
  onLoadMore: () => void,
  options: UseInfiniteScrollOptions = {}
): UseInfiniteScrollReturn {
  const { threshold = 200, enabled = true } = options
  const [isNearBottom, setIsNearBottom] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)

  const handleScroll = useCallback(() => {
    if (!enabled || loadingRef.current) return

    const container = containerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight)

    const nearBottom = distanceFromBottom < threshold
    setIsNearBottom(nearBottom)

    if (nearBottom && !loadingRef.current) {
      loadingRef.current = true
      onLoadMore()
      // Reset loading flag after a short delay
      setTimeout(() => {
        loadingRef.current = false
      }, 500)
    }
  }, [enabled, threshold, onLoadMore])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !enabled) return

    container.addEventListener('scroll', handleScroll)
    // Check initial state
    handleScroll()

    return () => {
      container.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll, enabled])

  return { containerRef, isNearBottom }
}
