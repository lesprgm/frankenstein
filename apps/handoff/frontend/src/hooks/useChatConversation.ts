import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useToast } from '../contexts/ToastContext'

export function useChatConversations(workspaceId: string | null) {
    return useQuery({
        queryKey: ['chatConversations', workspaceId],
        queryFn: () => api.listChatConversations(workspaceId!),
        enabled: !!workspaceId
    })
}

export function useChatConversation(conversationId: string | null, workspaceId: string | null) {
    return useQuery({
        queryKey: ['chatConversation', conversationId, workspaceId],
        queryFn: () => api.getChatConversation(conversationId!, workspaceId!),
        enabled: !!conversationId && !!workspaceId
    })
}

export function useCreateChatConversation() {
    const queryClient = useQueryClient()
    const { showToast } = useToast()

    return useMutation({
        mutationFn: ({ workspaceId, title }: { workspaceId: string; title?: string }) =>
            api.createChatConversation(workspaceId, title),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ['chatConversations', variables.workspaceId] })
            showToast('Conversation created', 'success')
        },
        onError: (error: Error) => {
            showToast(error.message || 'Failed to create conversation', 'error')
        }
    })
}

export function useUpdateChatConversation() {
    const queryClient = useQueryClient()
    const { showToast } = useToast()

    return useMutation({
        mutationFn: ({ conversationId, workspaceId, title }: { conversationId: string; workspaceId: string; title: string }) =>
            api.updateChatConversation(conversationId, workspaceId, title),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ['chatConversation', variables.conversationId] })
            queryClient.invalidateQueries({ queryKey: ['chatConversations', variables.workspaceId] })
            showToast('Conversation updated', 'success')
        },
        onError: (error: Error) => {
            showToast(error.message || 'Failed to update conversation', 'error')
        }
    })
}

export function useDeleteChatConversation() {
    const queryClient = useQueryClient()
    const { showToast } = useToast()

    return useMutation({
        mutationFn: ({ conversationId, workspaceId }: { conversationId: string; workspaceId: string }) =>
            api.deleteChatConversation(conversationId, workspaceId),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ['chatConversations', variables.workspaceId] })
            showToast('Conversation deleted', 'success')
        },
        onError: (error: Error) => {
            showToast(error.message || 'Failed to delete conversation', 'error')
        }
    })
}
