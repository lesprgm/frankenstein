import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode } from 'react'

// Create a client
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 5 * 60 * 1000, // 5 minutes
            gcTime: 10 * 60 * 1000, // 10 minutes (garbage collection time)
            retry: (failureCount, error: any) => {
                // Don't retry on 4xx errors (except 429 rate limit)
                if (error?.statusCode >= 400 && error?.statusCode < 500 && error?.statusCode !== 429) {
                    return false
                }
                return failureCount < 3
            },
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
        },
        mutations: {
            retry: false, // Don't retry mutations by default
        },
    },
})

export function QueryProvider({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    )
}

export { queryClient }
