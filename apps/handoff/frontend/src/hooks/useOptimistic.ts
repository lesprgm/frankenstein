import { useState, useCallback } from 'react'

/**
 * Hook for implementing optimistic UI updates
 * @param initialState - Initial state value
 * @returns Current state, optimistic update function, and rollback function
 */
export function useOptimistic<T>(initialState: T) {
  const [state, setState] = useState<T>(initialState)
  const [previousState, setPreviousState] = useState<T | null>(null)

  const updateOptimistically = useCallback(
    async (
      optimisticValue: T,
      asyncOperation: () => Promise<T>
    ): Promise<{ success: boolean; value: T }> => {
      // Save current state for potential rollback
      setPreviousState(state)
      
      // Apply optimistic update immediately
      setState(optimisticValue)

      try {
        // Perform async operation
        const result = await asyncOperation()
        
        // Update with actual result
        setState(result)
        setPreviousState(null)
        
        return { success: true, value: result }
      } catch (error) {
        // Rollback on error
        if (previousState !== null) {
          setState(previousState)
        } else {
          setState(state)
        }
        setPreviousState(null)
        
        return { success: false, value: state }
      }
    },
    [state, previousState]
  )

  const rollback = useCallback(() => {
    if (previousState !== null) {
      setState(previousState)
      setPreviousState(null)
    }
  }, [previousState])

  return {
    state,
    setState,
    updateOptimistically,
    rollback,
    isOptimistic: previousState !== null,
  }
}
