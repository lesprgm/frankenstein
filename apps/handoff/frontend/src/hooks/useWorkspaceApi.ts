import { useWorkspace } from '../contexts/WorkspaceContext'

/**
 * Hook that provides the current workspace ID for API calls
 * Throws an error if no workspace is selected
 */
export function useWorkspaceApi() {
  const { currentWorkspace } = useWorkspace()

  if (!currentWorkspace) {
    throw new Error('No workspace selected')
  }

  return {
    workspaceId: currentWorkspace.id,
    workspace: currentWorkspace,
  }
}
