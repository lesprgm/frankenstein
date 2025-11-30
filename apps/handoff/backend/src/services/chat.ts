import OpenAI from 'openai'
import { DatabaseClient } from '../lib/db'
import { MemoryService } from './memory'
import { EmbeddingService } from './embedding'

export class ChatService {
    private memoryService: MemoryService
    private embeddingService: EmbeddingService | null = null
    private openai: OpenAI
    private model: string
    private db: DatabaseClient

    constructor(
        db: DatabaseClient,
        openaiApiKey: string,
        baseURL?: string,
        model: string = 'gpt-4o',
        embeddingService?: EmbeddingService
    ) {
        this.db = db
        this.memoryService = new MemoryService(db, embeddingService)
        this.embeddingService = embeddingService || null
        this.openai = new OpenAI({
            apiKey: openaiApiKey,
            baseURL: baseURL,
        })
        this.model = model
    }

    async chat(
        query: string,
        workspaceId: string,
        history: { role: 'user' | 'assistant'; content: string }[] = []
    ): Promise<{ content: string; sources: any[] }> {
        let memories: any[] = []

        // Use vector similarity search if embedding service is available
        if (this.embeddingService) {
            try {
                // Generate embedding for the query
                const queryEmbedding = await this.embeddingService.generateEmbedding(query)

                // Perform vector similarity search
                const similarityQuery = `
                    SELECT m.*, 
                           1 - (m.embedding <=> $1::vector) as similarity
                    FROM memories m
                    WHERE m.workspace_id = $2
                      AND m.embedding IS NOT NULL
                    ORDER BY m.embedding <=> $1::vector
                    LIMIT 10
                `

                memories = await this.db.query(similarityQuery, [
                    JSON.stringify(queryEmbedding),
                    workspaceId
                ])
            } catch (error) {
                console.error('Vector search failed, falling back to keyword search:', error)
                // Fall back to keyword search
                const memoriesResult = await this.memoryService.getMemories({
                    workspaceId,
                    search: query,
                    limit: 10
                })
                memories = memoriesResult.memories
            }
        } else {
            // Fall back to keyword search if no embedding service
            const memoriesResult = await this.memoryService.getMemories({
                workspaceId,
                search: query,
                limit: 10
            })
            memories = memoriesResult.memories
        }

        // 2. Construct system prompt with context
        const contextText = memories.map(m => {
            const confidence = m.confidence || 0
            return `[${m.type.toUpperCase()}] (Confidence: ${(confidence * 100).toFixed(0)}%): ${m.content}`
        }).join('\n\n')

        const systemPrompt = `You are an AI assistant for the user's "external brain". 
You have access to the following memories extracted from the user's conversations:

${contextText}

Answer the user's question based PRIMARILY on these memories. 
If the answer is not in the memories, say you don't know based on the available context.
Do not make up facts.
Cite your sources implicitly by referring to the specific details.
`

        // 3. Call OpenAI
        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
            ...history.map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: query }
        ]

        const completion = await this.openai.chat.completions.create({
            model: this.model,
            messages,
            temperature: 0.5,
        })

        const answer = completion.choices[0].message.content || 'I could not generate a response.'

        return {
            content: answer,
            sources: memories
        }
    }
}
