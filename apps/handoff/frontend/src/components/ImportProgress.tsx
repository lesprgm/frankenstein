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
    <div className="space-y-4">
      {/* Status Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">
          {status === 'processing' && 'Importing...'}
          {status === 'completed' && 'Import Complete'}
          {status === 'failed' && 'Import Failed'}
        </h3>
        
        {status === 'processing' && (
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            <span className="text-sm text-gray-600">{percentage}%</span>
          </div>
        )}
        
        {status === 'completed' && (
          <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        
        {status === 'failed' && (
          <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>

      {/* Progress Bar */}
      {status === 'processing' && (
        <div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${percentage}%` }}
              role="progressbar"
              aria-label={`Import progress: ${percentage}%`}
            />
          </div>
          <p className="text-sm text-gray-600 mt-2">
            Processing {progress.conversationsProcessed} of {progress.totalConversations} conversations
          </p>
        </div>
      )}

      {/* Results */}
      {status === 'completed' && result && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-green-900 font-medium">Conversations imported:</span>
              <span className="text-green-700">{result.conversations}</span>
            </div>
            {result.memories > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-green-900 font-medium">Memories extracted:</span>
                <span className="text-green-700">{result.memories}</span>
              </div>
            )}
          </div>
          
          {!!result.errors && result.errors.length > 0 && (
            <div className="mt-4 pt-4 border-t border-green-300">
              <p className="text-sm font-medium text-green-900 mb-2">
                Warnings ({result.errors.length}):
              </p>
              <ul className="text-xs text-green-800 space-y-1 max-h-32 overflow-y-auto">
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
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-900 font-medium mb-1">Import failed</p>
          <p className="text-sm text-red-700">{error || 'An unknown error occurred'}</p>
        </div>
      )}
    </div>
  )
}
