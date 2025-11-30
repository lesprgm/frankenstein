import { useState, useEffect } from 'react'
import { useParams, Link, useLocation } from 'react-router-dom'
import Layout from '../components/layout/Layout'
import { PageHeader } from '../components/PageHeader'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { api, type Memory } from '../lib/api'

type EntityType = 'project' | 'person'

export default function EntityView() {
    const { id } = useParams<{ id: string }>()
    const location = useLocation()
    const { currentWorkspace } = useWorkspace()
    const [entity, setEntity] = useState<Memory | null>(null)
    const [relatedMemories, setRelatedMemories] = useState<Memory[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Determine entity type from URL path
    const entityType: EntityType = location.pathname.startsWith('/person') ? 'person' : 'project'

    useEffect(() => {
        if (currentWorkspace && id) {
            loadEntity()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentWorkspace, id])

    const loadEntity = async () => {
        if (!currentWorkspace || !id) return
        setIsLoading(true)
        setError(null)
        try {
            const { memory: entityRes } = await api.getMemoryById(id, currentWorkspace.id)
            setEntity(entityRes)

            const { memories: relatedRes } = await api.getMemories({
                workspaceId: currentWorkspace.id,
                search: entityRes.content,
                limit: 20
            })
            setRelatedMemories(relatedRes.filter(m => m.id !== id))
        } catch (err) {
            setError(`Failed to load ${entityType} details`)
        } finally {
            setIsLoading(false)
        }
    }

    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map(part => part[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)
    }

    const config = {
        person: {
            kicker: 'Person',
            breadcrumb: 'People',
            activityTitle: 'Activity & Mentions',
            sidebarTitle: 'Profile Details',
            notFoundMessage: 'Person not found'
        },
        project: {
            kicker: 'Project',
            breadcrumb: 'Projects',
            activityTitle: 'Timeline & Activity',
            sidebarTitle: 'Project Details',
            notFoundMessage: 'Project not found'
        }
    }

    const c = config[entityType]

    if (isLoading) {
        return (
            <Layout>
                <div className="flex justify-center py-20">
                    <div className="spinner h-8 w-8"></div>
                </div>
            </Layout>
        )
    }

    if (error || !entity) {
        return (
            <Layout>
                <div className="text-center py-20">
                    <h3 className="text-lg font-medium text-[var(--color-text-primary)]">{c.notFoundMessage}</h3>
                    <Link to="/context" className="text-blue-600 hover:underline mt-2 inline-block">
                        Back to Context
                    </Link>
                </div>
            </Layout>
        )
    }

    return (
        <Layout>
            <div className="space-y-8">
                <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                    <Link to="/context" className="hover:text-[var(--color-text-primary)]">Context</Link>
                    <span>/</span>
                    <span>{c.breadcrumb}</span>
                </div>

                {entityType === 'person' ? (
                    <div className="flex items-start gap-6">
                        <div className="w-20 h-20 rounded-full bg-[var(--color-bg-tertiary)] flex items-center justify-center text-2xl font-semibold text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]">
                            {getInitials(entity.content)}
                        </div>
                        <div className="flex-1">
                            <PageHeader
                                kicker={c.kicker}
                                title={entity.content}
                                subtitle={`Tracked since ${new Date(entity.created_at).toLocaleDateString()}`}
                            />
                        </div>
                    </div>
                ) : (
                    <PageHeader
                        kicker={c.kicker}
                        title={entity.content}
                        subtitle={`Tracked since ${new Date(entity.created_at).toLocaleDateString()}`}
                    />
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content - Related Memories */}
                    <div className="lg:col-span-2 space-y-6">
                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{c.activityTitle}</h3>

                        {relatedMemories.length === 0 ? (
                            <div className="card-clean p-8 text-center text-[var(--color-text-secondary)]">
                                No related activity found yet.
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {relatedMemories.map(memory => (
                                    <div key={memory.id} className="card-clean group">
                                        <div className="flex items-start justify-between">
                                            <p className="text-[var(--color-text-primary)] leading-relaxed">
                                                {memory.content}
                                            </p>
                                            <span className={`badge ${memory.type} ml-3 flex-shrink-0`}>
                                                {memory.type}
                                            </span>
                                        </div>
                                        <div className="mt-3 flex items-center gap-3 text-xs text-[var(--color-text-tertiary)]">
                                            <span>{new Date(memory.created_at).toLocaleDateString()}</span>
                                            {memory.conversation_id && (
                                                <Link to={`/chats?id=${memory.conversation_id}`} className="hover:text-blue-600">
                                                    View Source &rarr;
                                                </Link>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Sidebar - Metadata */}
                    <div className="space-y-6">
                        <div className="card-clean space-y-4">
                            <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                                {c.sidebarTitle}
                            </h3>

                            <div className="space-y-3">
                                {entityType === 'project' && (
                                    <div>
                                        <label className="text-xs text-[var(--color-text-tertiary)]">Status</label>
                                        <div className="mt-1">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                Active
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {entityType === 'person' && (
                                    <div>
                                        <label className="text-xs text-[var(--color-text-tertiary)]">Role</label>
                                        <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                                            {(entity.metadata?.role as string) || 'Unknown Role'}
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className="text-xs text-[var(--color-text-tertiary)]">Confidence</label>
                                    <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                                        {(entity.confidence * 100).toFixed(0)}%
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs text-[var(--color-text-tertiary)]">
                                        {entityType === 'person' ? 'Last Interaction' : 'Last Updated'}
                                    </label>
                                    <div className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                                        {new Date(entity.created_at).toLocaleDateString()}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}
