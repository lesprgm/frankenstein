import { Fragment, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'

interface CreateMemoryModalProps {
    isOpen: boolean
    onClose: () => void
    onCreate: (content: string, type: string) => Promise<void>
}

export default function CreateMemoryModal({ isOpen, onClose, onCreate }: CreateMemoryModalProps) {
    const [content, setContent] = useState('')
    const [type, setType] = useState('fact')
    const [isSubmitting, setIsSubmitting] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!content.trim()) return

        setIsSubmitting(true)
        try {
            await onCreate(content, type)
            setContent('')
            setType('fact')
            onClose()
        } catch (error) {
            console.error('Failed to create memory', error)
        } finally {
            setIsSubmitting(false)
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
                            <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white shadow-2xl transition-all">
                                <div className="border-b border-gray-200 px-6 py-4">
                                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                                        New Memory
                                    </Dialog.Title>
                                </div>

                                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Type
                                        </label>
                                        <div className="flex gap-2">
                                            {['fact', 'entity', 'decision'].map((t) => (
                                                <button
                                                    key={t}
                                                    type="button"
                                                    onClick={() => setType(t)}
                                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${type === t
                                                            ? 'bg-blue-100 text-blue-700 border border-blue-200'
                                                            : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
                                                        }`}
                                                >
                                                    {t.charAt(0).toUpperCase() + t.slice(1)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Content
                                        </label>
                                        <textarea
                                            value={content}
                                            onChange={(e) => setContent(e.target.value)}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none min-h-[120px]"
                                            placeholder="Enter the memory content..."
                                            required
                                        />
                                    </div>

                                    <div className="flex justify-end gap-3 pt-2">
                                        <button
                                            type="button"
                                            onClick={onClose}
                                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={isSubmitting || !content.trim()}
                                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isSubmitting ? 'Creating...' : 'Create Memory'}
                                        </button>
                                    </div>
                                </form>
                            </Dialog.Panel>
                        </Transition.Child>
                    </div>
                </div>
            </Dialog>
        </Transition>
    )
}
