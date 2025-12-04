interface ImportProgressProps {
  status: 'processing' | 'completed' | 'failed'
  progress: {
    conversationsProcessed: number
    totalConversations: number
    memoriesExtracted: number
  }
  result?: {
    conversations: number
    memories: number
    errors?: string[]
  }
  error?: string
}

export default function ImportProgress({ status, progress, result, error }: ImportProgressProps) {
  const percentage = progress.totalConversations > 0
    ? Math.round((progress.conversationsProcessed / progress.totalConversations) * 100)
    : 0

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {status === 'processing' && (
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-white/30 animate-spin" />
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
          )}

          {status === 'completed' && (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-green-200">
              <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          )}

          {status === 'failed' && (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center shadow-lg shadow-red-200">
              <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
          )}

          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {status === 'processing' && 'Importing...'}
              {status === 'completed' && 'Import Complete! 🎉'}
              {status === 'failed' && 'Import Failed'}
            </h3>
            {status === 'processing' && (
              <p className="text-sm text-gray-500">{percentage}% complete</p>
            )}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      {status === 'processing' && (
        <div className="space-y-3">
          <div className="relative w-full bg-gray-100 rounded-full h-3 overflow-hidden">
            {/* Shimmer effect on background */}
            <div className="absolute inset-0 animate-shimmer opacity-50" />
            
            {/* Actual progress */}
            <div
              className="relative h-3 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-500 ease-out overflow-hidden"
              style={{ width: `${percentage}%` }}
              role="progressbar"
              aria-label={`Import progress: ${percentage}%`}
            >
              {/* Shine effect on progress bar */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
            </div>
          </div>
          
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-lg">💬</span>
                <span className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">{progress.conversationsProcessed}</span>
                  <span className="text-gray-400"> / {progress.totalConversations}</span> conversations
                </span>
              </div>
              {progress.memoriesExtracted > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-lg">🧠</span>
                  <span className="text-sm text-gray-600">
                    <span className="font-medium text-gray-900">{progress.memoriesExtracted}</span> memories
                  </span>
                </div>
              )}
            </div>
            
            {progress.totalConversations > 0 && (
              <p className="text-xs text-gray-400 font-medium">
                ~{Math.ceil((progress.totalConversations - progress.conversationsProcessed) * 0.5)}s remaining
              </p>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {status === 'completed' && result && (
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-white/60 rounded-lg">
              <div className="text-3xl mb-1">💬</div>
              <div className="text-2xl font-bold text-gray-900">{result.conversations}</div>
              <div className="text-xs text-gray-500 font-medium">Conversations</div>
            </div>
            {result.memories > 0 && (
              <div className="text-center p-3 bg-white/60 rounded-lg">
                <div className="text-3xl mb-1">🧠</div>
                <div className="text-2xl font-bold text-gray-900">{result.memories}</div>
                <div className="text-xs text-gray-500 font-medium">Memories Extracted</div>
              </div>
            )}
          </div>

          {!!result.errors && result.errors.length > 0 && (
            <div className="mt-4 pt-4 border-t border-green-200">
              <p className="text-sm font-medium text-amber-700 mb-2 flex items-center gap-1.5">
                <span>⚠️</span>
                {result.errors.length} warning{result.errors.length > 1 ? 's' : ''}
              </p>
              <ul className="text-xs text-amber-600 space-y-1 max-h-32 overflow-y-auto">
                {result.errors.map((err, idx) => (
                  <li key={idx} className="truncate" title={err}>
                    • {err}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {status === 'failed' && (
        <div className="bg-gradient-to-br from-red-50 to-rose-50 border border-red-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl">😔</span>
            <div>
              <p className="text-sm text-red-900 font-semibold mb-1">Something went wrong</p>
              <p className="text-sm text-red-700">{error || 'An unknown error occurred. Please try again.'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
