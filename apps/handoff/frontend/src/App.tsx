import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { WorkspaceProvider } from './contexts/WorkspaceContext'
import { ToastProvider } from './contexts/ToastContext'
import { QueryProvider } from './lib/query'
import { ErrorBoundary } from './components/ErrorBoundary'
import ProtectedRoute from './components/ProtectedRoute'

// Eager load auth pages (needed immediately)
import Login from './pages/Login'
import Signup from './pages/Signup'

// Lazy load other pages
const Sources = lazy(() => import('./pages/Sources'))
const Context = lazy(() => import('./pages/Context'))
const Chats = lazy(() => import('./pages/Chats'))
const Activity = lazy(() => import('./pages/Activity'))
const Settings = lazy(() => import('./pages/Settings'))
const Ask = lazy(() => import('./pages/Ask'))

const EntityView = lazy(() => import('./pages/EntityView'))

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <QueryProvider>
          <ToastProvider>
            <AuthProvider>
              <WorkspaceProvider>
                <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="loading-spinner"></div></div>}>
                  <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />

                    <Route
                      path="/sources"
                      element={
                        <ProtectedRoute>
                          <Sources />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/context"
                      element={
                        <ProtectedRoute>
                          <Context />
                        </ProtectedRoute>
                      }
                    />

                    <Route
                      path="/ask"
                      element={
                        <ProtectedRoute>
                          <Ask />
                        </ProtectedRoute>
                      }
                    />

                    <Route
                      path="/chats"
                      element={
                        <ProtectedRoute>
                          <Chats />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/project/:id"
                      element={
                        <ProtectedRoute>
                          <EntityView />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/person/:id"
                      element={
                        <ProtectedRoute>
                          <EntityView />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/activity"
                      element={
                        <ProtectedRoute>
                          <Activity />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/settings"
                      element={
                        <ProtectedRoute>
                          <Settings />
                        </ProtectedRoute>
                      }
                    />
                    <Route path="/" element={<Navigate to="/chats" replace />} />
                  </Routes>
                </Suspense>
              </WorkspaceProvider>
            </AuthProvider>
          </ToastProvider>
        </QueryProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
