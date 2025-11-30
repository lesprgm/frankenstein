import { useState, useCallback, useEffect, useRef } from 'react'

interface UseAsyncState<T> {
  data: T | null
  error: Error | null
  isLoading: boolean
  isSuccess: boolean
  isError: boolean
}

interface UseAsyncReturn<T> extends UseAsyncState<T> {
  execute: (...args: unknown[]) => Promise<T | null>
  reset: () => void
}

/**
 * Hook for managing async operations with loading, error, and success states
 * @param asyncFunction - The async function to execute
 * @param immediate - Whether to execute immediately on mount
 * @returns State and control functions
 */
export function useAsync<T>(
  asyncFunction: (...args: unknown[]) => Promise<T>,
  immediate = false
): UseAsyncReturn<T> {
  const [state, setState] = useState<UseAsyncState<T>>({
    data: null,
    error: null,
    isLoading: immediate,
    isSuccess: false,
    isError: false,
  })

  const isMountedRef = useRef(true)

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const execute = useCallback(
    async (...args: unknown[]): Promise<T | null> => {
      setState({
        data: null,
        error: null,
        isLoading: true,
        isSuccess: false,
        isError: false,
      })

      try {
        const response = await asyncFunction(...args)

        if (isMountedRef.current) {
          setState({
            data: response,
            error: null,
            isLoading: false,
            isSuccess: true,
            isError: false,
          })
        }

        return response
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Unknown error')

        if (isMountedRef.current) {
          setState({
            data: null,
            error: err,
            isLoading: false,
            isSuccess: false,
            isError: true,
          })
        }

        return null
      }
    },
    [asyncFunction]
  )

  const reset = useCallback(() => {
    setState({
      data: null,
      error: null,
      isLoading: false,
      isSuccess: false,
      isError: false,
    })
  }, [])

  useEffect(() => {
    if (immediate) {
      execute()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate])

  return {
    ...state,
    execute,
    reset,
  }
}
