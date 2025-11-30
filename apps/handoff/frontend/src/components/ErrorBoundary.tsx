import { Component, ReactNode, ErrorInfo } from 'react'

interface Props {
    children: ReactNode
    fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
    hasError: boolean
    error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo)
    }

    resetError = () => {
        this.setState({ hasError: false, error: null })
    }

    render() {
        if (this.state.hasError && this.state.error) {
            if (this.props.fallback) {
                return this.props.fallback(this.state.error, this.resetError)
            }

            return (
                <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
                    <div className="max-w-md w-full">
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
                            <div className="text-center">
                                <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
                                    <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                </div>

                                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                                    Something went wrong
                                </h2>

                                <p className="text-gray-600 mb-6">
                                    {this.state.error.message || 'An unexpected error occurred'}
                                </p>

                                <div className="space-y-3">
                                    <button
                                        onClick={this.resetError}
                                        className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                                    >
                                        Try again
                                    </button>

                                    <button
                                        onClick={() => window.location.href = '/'}
                                        className="w-full bg-white text-gray-700 py-2 px-4 rounded-md border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                                    >
                                        Go to home
                                    </button>
                                </div>

                                {process.env.NODE_ENV === 'development' && (
                                    <details className="mt-6 text-left">
                                        <summary className="text-sm text-gray-500 cursor-pointer">
                                            Error details
                                        </summary>
                                        <pre className="mt-2 text-xs text-gray-600 bg-gray-50 p-3 rounded overflow-auto max-h-48">
                                            {this.state.error.stack}
                                        </pre>
                                    </details>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}
