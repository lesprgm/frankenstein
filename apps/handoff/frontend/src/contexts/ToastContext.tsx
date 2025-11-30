import { createContext, useContext, useState, ReactNode, useCallback } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
    id: string
    type: ToastType
    message: string
    duration?: number
}

interface ToastContextValue {
    toasts: Toast[]
    showToast: (message: string, type?: ToastType, duration?: number) => void
    hideToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])

    const hideToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id))
    }, [])

    const showToast = useCallback((
        message: string,
        type: ToastType = 'info',
        duration: number = 5000
    ) => {
        const id = `toast-${Date.now()}-${Math.random()}`
        const toast: Toast = { id, message, type, duration }

        setToasts(prev => [...prev, toast])

        if (duration > 0) {
            setTimeout(() => hideToast(id), duration)
        }
    }, [hideToast])

    return (
        <ToastContext.Provider value={{ toasts, showToast, hideToast }}>
            {children}
            <ToastContainer toasts={toasts} onClose={hideToast} />
        </ToastContext.Provider>
    )
}

export function useToast() {
    const context = useContext(ToastContext)
    if (!context) {
        throw new Error('useToast must be used within ToastProvider')
    }
    return context
}

// Toast container component
function ToastContainer({ toasts, onClose }: { toasts: Toast[]; onClose: (id: string) => void }) {
    if (toasts.length === 0) return null

    return (
        <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
            {toasts.map(toast => (
                <ToastItem key={toast.id} toast={toast} onClose={onClose} />
            ))}
        </div>
    )
}

// Individual toast component
function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: string) => void }) {
    const bgColor = {
        success: 'bg-green-50 border-green-200',
        error: 'bg-red-50 border-red-200',
        warning: 'bg-yellow-50 border-yellow-200',
        info: 'bg-blue-50 border-blue-200'
    }[toast.type]

    const textColor = {
        success: 'text-green-800',
        error: 'text-red-800',
        warning: 'text-yellow-800',
        info: 'text-blue-800'
    }[toast.type]

    const icon = {
        success: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
        error: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
        warning: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        ),
        info: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        )
    }[toast.type]

    return (
        <div
            className={`${bgColor} border rounded-lg shadow-lg p-4 flex items-start gap-3 animate-slide-in-right`}
            role="alert"
        >
            <div className={textColor}>{icon}</div>
            <p className={`${textColor} text-sm flex-1`}>{toast.message}</p>
            <button
                onClick={() => onClose(toast.id)}
                className={`${textColor} hover:opacity-75`}
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    )
}
