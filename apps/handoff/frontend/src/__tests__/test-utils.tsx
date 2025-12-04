import { ReactElement } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../contexts/AuthContext'
import { WorkspaceProvider } from '../contexts/WorkspaceContext'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Create a new QueryClient for each test to avoid state pollution
const createTestQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: 0, // Renamed from cacheTime in React Query v5
            },
            mutations: {
                retry: false,
            },
        },
    })

interface AllTheProvidersProps {
    children: React.ReactNode
}

function AllTheProviders({ children }: AllTheProvidersProps) {
    const queryClient = createTestQueryClient()

    return (
        <BrowserRouter>
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <WorkspaceProvider>{children}</WorkspaceProvider>
                </AuthProvider>
            </QueryClientProvider>
        </BrowserRouter>
    )
}

/**
 * Custom render function that wraps components with all required providers
 * Use this instead of @testing-library/react's render for components that need:
 * - Router context
 * - Auth context
 * - Workspace context
 * - React Query
 */
const renderWithProviders = (
    ui: ReactElement,
    options?: Omit<RenderOptions, 'wrapper'>
) => {
    return render(ui, { wrapper: AllTheProviders, ...options })
}

// Re-export everything from @testing-library/react
export * from '@testing-library/react'

// Override render with our custom version
export { renderWithProviders as render }
