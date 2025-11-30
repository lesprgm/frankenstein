import { Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'

interface Memory {
    id: string
    type: string
    content: string
    confidence: number
    metadata: Record<string, unknown>
    created_at: string
    conversation_id: string | null
}

interface MemoryDetailModalProps {
    memory: Memory | null
    isOpen: boolean
    onClose: () => void
    onNavigateToSource?: (conversationId: string) => void
}

export default function MemoryDetailModal({ memory, isOpen, onClose, onNavigateToSource }: MemoryDetailModalProps) {
    if (!memory) return null

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'entity': return 'text-blue-600 bg-blue-50'
            case 'fact': return 'text-green-600 bg-green-50'
            case 'decision': return 'text-purple-600 bg-purple-50'
            default: return 'text-gray-600 bg-gray-50'
        }
    }

    return (
        <Transition appear show={isOpen} as={Fragment}>
            <Dialog as="div" className="relative z-50" onClose={onClose}>
                <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
                </Transition.Child>

                <div className="fixed inset-0 overflow-y-auto">
                    <div className="flex min-h-full items-center justify-center p-4">
                        <Transition.Child
                            as={Fragment}
                            enter="ease-out duration-300"
                            enterFrom="opacity-0 scale-95"
                            enterTo="opacity-100 scale-100"
                            leave="ease-in duration-200"
                            leaveFrom="opacity-100 scale-100"
                            leaveTo="opacity-0 scale-95"
                        >
                            <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white shadow-2xl transition-all">
                                {/* Header */}
                                <div className="border-b border-gray-200 px-6 py-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <Dialog.Title className="text-xl font-semibold text-gray-900">
                                                Memory Details
                                            </Dialog.Title>
                                            <p className="mt-1 text-sm text-gray-600">
                                                {new Date(memory.created_at).toLocaleString()}
                                            </p>
                                        </div>
                                        <button
                                            onClick={onClose}
                                            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="px-6 py-6 space-y-6">
                                    {/* Type Badge */}
                                    <div>
                                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Type</label>
                                        <div className="mt-2">
                                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getTypeColor(memory.type)}`}>
                                                {memory.type}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Content */}
                                    <div>
                                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Content</label>
                                        <div className="mt-2 p-4 bg-gray-50 rounded-lg border border-gray-200">
                                            <p className="text-gray-900 leading-relaxed">{memory.content}</p>
                                        </div>
                                    </div>

                                    {/* Confidence */}
                                    <div>
                                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Confidence</label>
                                        <div className="mt-2 flex items-center gap-3">
                                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                                                <div
                                                    className="bg-blue-600 h-2 rounded-full transition-all"
                                                    style={{ width: `${memory.confidence * 100}%` }}
                                                />
                                            </div>
                                            <span className="text-sm font-medium text-gray-900">
                                                {(memory.confidence * 100).toFixed(0)}%
                                            </span>
                                        </div>
                                    </div>

                                    {/* Metadata */}
                                    {Object.keys(memory.metadata).length > 0 && (
                                        <div>
                                            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Metadata</label>
                                            <div className="mt-2 space-y-2">
                                                {Object.entries(memory.metadata)
                                                    .filter(([key]) => !['pinned', 'hidden', 'source_message_id'].includes(key))
                                                    .map(([key, value]) => (
                                                        <div key={key} className="flex items-start gap-2 text-sm">
                                                            <span className="font-medium text-gray-700 min-w-[100px]">{key}:</span>
                                                            <span className="text-gray-600 flex-1">
                                                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                                            </span>
                                                        </div>
                                                    ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Source Conversation */}
                                    {memory.conversation_id && (
                                        <div>
                                            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Source</label>
                                            <div className="mt-2">
                                                <button
                                                    onClick={() => onNavigateToSource?.(memory.conversation_id!)}
                                                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
                                                >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                                    </svg>
                                                    View Source Conversation
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* ID (for debugging/reference) */}
                                    <div>
                                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">ID</label>
                                        <div className="mt-2">
                                            <code className="text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded border border-gray-200">
                                                {memory.id}
                                            </code>
                                        </div>
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="border-t border-gray-200 px-6 py-4 bg-gray-50">
                                    <button
                                        onClick={onClose}
                                        className="w-full px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                                    >
                                        Close
                                    </button>
                                </div>
                            </Dialog.Panel>
                        </Transition.Child>
                    </div>
                </div>
            </Dialog>
        </Transition>
    )
}
