interface LoadingSkeletonProps {
  type?: 'card' | 'list' | 'text' | 'avatar'
  count?: number
  className?: string
}

export default function LoadingSkeleton({ 
  type = 'card', 
  count = 1,
  className = '' 
}: LoadingSkeletonProps) {
  const skeletons = Array.from({ length: count }, (_, i) => i)

  if (type === 'card') {
    return (
      <>
        {skeletons.map((i) => (
          <div 
            key={i} 
            className={`bg-white rounded-lg border border-gray-200 p-6 animate-pulse ${className}`}
          >
            <div className="space-y-3">
              <div className="h-5 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              <div className="flex gap-4">
                <div className="h-4 bg-gray-200 rounded w-20"></div>
                <div className="h-4 bg-gray-200 rounded w-20"></div>
                <div className="h-4 bg-gray-200 rounded w-20"></div>
              </div>
            </div>
          </div>
        ))}
      </>
    )
  }

  if (type === 'list') {
    return (
      <>
        {skeletons.map((i) => (
          <div 
            key={i} 
            className={`flex items-center gap-3 p-4 animate-pulse ${className}`}
          >
            <div className="h-10 w-10 bg-gray-200 rounded-full"></div>
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </>
    )
  }

  if (type === 'text') {
    return (
      <>
        {skeletons.map((i) => (
          <div key={i} className={`animate-pulse ${className}`}>
            <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
          </div>
        ))}
      </>
    )
  }

  if (type === 'avatar') {
    return (
      <div className={`h-10 w-10 bg-gray-200 rounded-full animate-pulse ${className}`}></div>
    )
  }

  return null
}
