import { ReactNode } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="flex flex-col h-screen bg-[var(--color-bg-secondary)] overflow-hidden">
      {/* Header is now sticky and translucent, handled in Header component */}
      <Header />

      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar />

        <main className="flex-1 overflow-y-auto relative z-0">
          <div className="max-w-5xl mx-auto p-6 md:p-10 lg:p-12 space-y-8 pb-20">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
