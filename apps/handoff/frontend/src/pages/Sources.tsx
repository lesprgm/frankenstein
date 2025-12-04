import { useState, useEffect } from 'react'
import { useWorkspace } from '../contexts/WorkspaceContext'
import Layout from '../components/layout/Layout'
import { PageHeader } from '../components/PageHeader'
import FileUpload from '../components/FileUpload'
import ImportProgress from '../components/ImportProgress'
import ProcessingLoader from '../components/ProcessingLoader'
import { api, ImportJob } from '../lib/api'

export default function Sources() {
  const { currentWorkspace } = useWorkspace()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [importJob, setImportJob] = useState<ImportJob | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Poll for import status
  useEffect(() => {
    if (!importJob || importJob.status !== 'processing') {
      return
    }

    const pollInterval = setInterval(async () => {
      try {
        const updatedJob = await api.getImportStatus(importJob.id)
        setImportJob(updatedJob)

        // Stop polling if job is complete or failed
        if (updatedJob.status === 'completed' || updatedJob.status === 'failed') {
          clearInterval(pollInterval)
          setIsImporting(false)
        }
      } catch (err) {
        console.error('Failed to poll import status:', err)
        clearInterval(pollInterval)
        setError('Failed to check import status')
        setIsImporting(false)
      }
    }, 2000) // Poll every 2 seconds

    return () => clearInterval(pollInterval)
  }, [importJob])

  const handleFileSelect = (file: File) => {
    setSelectedFile(file)
    setImportJob(null)
    setError(null)
  }

  const handleImport = async () => {
    if (!selectedFile || !currentWorkspace) {
      return
    }

    setIsImporting(true)
    setError(null)

    try {
      const result = await api.importFile(selectedFile, currentWorkspace.id)

      // Since processing is now synchronous, result contains final status
      if (result.status === 'completed') {
        setImportJob({
          id: result.jobId,
          workspace_id: currentWorkspace.id,
          user_id: '',
          status: 'completed',
          progress: {
            conversationsProcessed: result.result?.conversations || 0,
            totalConversations: result.result?.conversations || 0,
            memoriesExtracted: result.result?.memories || 0
          },
          result: result.result,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      } else if (result.status === 'failed') {
        setError(result.error || 'Import failed')
      }
      setIsImporting(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      setError(message)
      setIsImporting(false)
    }
  }

  const handleReset = () => {
    setSelectedFile(null)
    setImportJob(null)
    setError(null)
    setIsImporting(false)
  }

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          kicker="Start here"
          title="Import conversations"
          subtitle="Drop in exports from ChatGPT, Claude, or others. Handoff will extract memories and decisions for you."
          meta={
            currentWorkspace && (
              <div className="text-right text-sm text-blue-900">
                <p className="font-medium">{currentWorkspace.name}</p>
                <p className="text-xs text-blue-700 capitalize">{currentWorkspace.type} workspace</p>
              </div>
            )
          }
        />

        <div className="bg-white rounded-2xl border border-gray-200 p-8 relative shadow-sm overflow-hidden">
          {isImporting && !importJob && (
            <ProcessingLoader fileName={selectedFile?.name} />
          )}

          {!importJob && !isImporting && (
            <>
              <FileUpload
                onFileSelect={handleFileSelect}
                disabled={!currentWorkspace || isImporting}
              />

              {selectedFile && (
                <div className="mt-6">
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{selectedFile.name}</p>
                        <p className="text-xs text-gray-500">
                          {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedFile(null)}
                      className="text-gray-400 hover:text-gray-600"
                      aria-label="Remove file"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleImport}
                    disabled={!currentWorkspace}
                    className="mt-4 w-full rounded-xl bg-gray-900 py-2 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Start import
                  </button>
                </div>
              )}

              {error && (
                <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}
            </>
          )}

          {importJob && (
            <div>
              <ImportProgress
                status={importJob.status}
                progress={importJob.progress}
                result={importJob.result}
                error={importJob.error}
              />

              {(importJob.status === 'completed' || importJob.status === 'failed') && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="mt-6 w-full rounded-xl bg-gray-100 py-2 px-4 text-sm font-semibold text-gray-800 transition hover:bg-gray-200"
                >
                  Import another file
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
