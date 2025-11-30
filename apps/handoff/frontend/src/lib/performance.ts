/**
 * Performance monitoring utilities
 */

interface PerformanceMetric {
  name: string
  duration: number
  timestamp: number
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = []
  private timers: Map<string, number> = new Map()

  /**
   * Start timing an operation
   */
  start(name: string): void {
    this.timers.set(name, performance.now())
  }

  /**
   * End timing an operation and record the metric
   */
  end(name: string): number | null {
    const startTime = this.timers.get(name)
    if (!startTime) {
      console.warn(`No start time found for metric: ${name}`)
      return null
    }

    const duration = performance.now() - startTime
    this.timers.delete(name)

    const metric: PerformanceMetric = {
      name,
      duration,
      timestamp: Date.now(),
    }

    this.metrics.push(metric)

    // Log slow operations (> 1 second)
    if (duration > 1000) {
      console.warn(`Slow operation detected: ${name} took ${duration.toFixed(2)}ms`)
    }

    return duration
  }

  /**
   * Get all recorded metrics
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.metrics]
  }

  /**
   * Get metrics for a specific operation
   */
  getMetricsByName(name: string): PerformanceMetric[] {
    return this.metrics.filter(m => m.name === name)
  }

  /**
   * Get average duration for an operation
   */
  getAverageDuration(name: string): number {
    const metrics = this.getMetricsByName(name)
    if (metrics.length === 0) return 0

    const total = metrics.reduce((sum, m) => sum + m.duration, 0)
    return total / metrics.length
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = []
    this.timers.clear()
  }

  /**
   * Log performance summary
   */
  logSummary(): void {
    const operations = new Set(this.metrics.map(m => m.name))
    
    console.group('Performance Summary')
    operations.forEach(name => {
      const avg = this.getAverageDuration(name)
      const count = this.getMetricsByName(name).length
      console.log(`${name}: ${avg.toFixed(2)}ms avg (${count} calls)`)
    })
    console.groupEnd()
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor()

/**
 * Hook-friendly wrapper for performance monitoring
 */
export function measurePerformance<T>(
  name: string,
  fn: () => T | Promise<T>
): T | Promise<T> {
  performanceMonitor.start(name)
  
  try {
    const result = fn()
    
    if (result instanceof Promise) {
      return result.finally(() => {
        performanceMonitor.end(name)
      }) as T
    }
    
    performanceMonitor.end(name)
    return result
  } catch (error) {
    performanceMonitor.end(name)
    throw error
  }
}
