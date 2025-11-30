import OpenAI from 'openai';
import { MakerLLMProvider } from '@memorylayer/memory-extraction';

export class OpenAIMakerProvider implements MakerLLMProvider {
    private openai: OpenAI;
    private model: string;

    constructor(apiKey: string, baseURL?: string, model: string = 'gpt-4o-mini') {
        this.openai = new OpenAI({
            apiKey,
            baseURL,
        });
        this.model = model;
    }

    async call(prompt: string, options?: { temperature?: number; timeout?: number }): Promise<string> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), options?.timeout || 10000);

        try {
            const completion = await this.openai.chat.completions.create({
                model: this.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: options?.temperature || 0.4,
            }, { signal: controller.signal });

            clearTimeout(timeoutId);
            return completion.choices[0].message.content || '';
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
}
