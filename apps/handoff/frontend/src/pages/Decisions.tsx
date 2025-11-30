import { useEffect, useMemo, useState } from 'react'
import Layout from '../components/layout/Layout'
import { PageHeader } from '../components/PageHeader'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { api, type Memory } from '../lib/api'

type Decision = Memory

function DecisionCard({
  decision,
  onCopy,
}: {
  decision: Decision
  onCopy: (decision: Decision) => void
}) {
  const tags = [
    decision.metadata?.project,
    decision.metadata?.owner,
    decision.metadata?.area,
  ].filter(Boolean) as string[]

  return (
    <div className="group relative overflow-hidden rounded-2xl bg-white/80 p-5 shadow-sm ring-1 ring-gray-100 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m4 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>Decision</span>
          </div>
          <p className="text-lg font-semibold text-gray-900 leading-snug">
            {decision.content}
          </p>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="text-right text-xs text-gray-500">
          {new Date(decision.created_at).toLocaleDateString()}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
        <span>Confidence {(decision.confidence * 100).toFixed(0)}%</span>
        <button
          onClick={() => onCopy(decision)}
          className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-black"
        >
          Copy context
        </button>
      </div>
    </div>
  )
}

export default function Decisions() {
  const { currentWorkspace } = useWorkspace()
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    if (!currentWorkspace) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspace])

  const load = async () => {
    if (!currentWorkspace) return
    setIsLoading(true)
    setError(null)
    try {
      const { memories } = await api.getMemories({
        workspaceId: currentWorkspace.id,
        type: 'decision',
        limit: 100,
      })
      setDecisions(memories)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load decisions')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopy = async (decision: Decision) => {
    const metadata = decision.metadata || {}
    const project = metadata.project ? `Project: ${metadata.project}` : ''
    const owner = metadata.owner ? `Owner: ${metadata.owner}` : ''
    const rationale = metadata.reason || metadata.rationale || metadata.notes

    const context = [
      'Decision Brief',
      decision.content,
      project,
      owner,
      rationale ? `Why: ${rationale}` : '',
      `Confidence: ${(decision.confidence * 100).toFixed(0)}%`,
      metadata.links ? `Sources: ${metadata.links}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    await navigator.clipboard.writeText(context)
    setCopiedId(decision.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const summary = useMemo(() => {
    if (decisions.length === 0) return null
    const latest = decisions.slice(0, 3)
    return latest.map((d) => `• ${d.content}`).join('\n')
  }, [decisions])

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          kicker="Memory Layer"
          title="Decisions"
          subtitle="The calls that matter, distilled to hand off to any model or teammate."
          meta={
            <div>
              <p className="text-xl font-semibold text-gray-900">{decisions.length}</p>
              <p className="text-xs text-gray-500">captured</p>
            </div>
          }
        />

        {summary && (
          <div className="rounded-2xl bg-white/80 p-5 shadow-sm ring-1 ring-gray-100">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
              Latest calls
            </p>
            <pre className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
              {summary}
            </pre>
          </div>
        )}

        {isLoading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-600">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
            Loading decisions...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
            {error}
            <button
              onClick={load}
              className="ml-3 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-red-700 shadow-sm hover:bg-white"
            >
              Retry
            </button>
          </div>
        ) : decisions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center">
            <p className="text-lg font-medium text-gray-900">No decisions yet</p>
            <p className="mt-2 text-gray-600">Import chats to capture decisive calls automatically.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {decisions.map((decision) => (
              <div key={decision.id} className="relative">
                <DecisionCard decision={decision} onCopy={handleCopy} />
                {copiedId === decision.id && (
                  <div className="absolute right-3 top-3 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 shadow">
                    Copied
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
