import path from 'node:path';
import type { Action, LLMResponse, MemoryReference, FileOpenParams } from '../types.js';

const DEFAULT_MODEL = 'gemini-1a';
const DEFAULT_ENDPOINT_FOR = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/**
 * LLM coordinator — Gemini-only configuration.
 *
 * NOTE: This project currently treats Gemini as the only supported LLM provider.
 * The actual Gemini client/SDK integration is not implemented yet. When a
 * `GEMINI_API_KEY` is present the coordinator will log a warning and fall back
 * to the deterministic local fallback behavior until a Gemini adapter is
 * implemented. This preserves deterministic behavior rather than silently
 * making network calls to an unsupported client.
 */
export class LLMCoordinator {
  private hasApi: boolean;
  private model: string;
  private endpoint?: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    this.model = process.env.GEMINI_LLM_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL;
    this.endpoint = process.env.GEMINI_LLM_ENDPOINT || DEFAULT_ENDPOINT_FOR(this.model);
    this.hasApi = Boolean(apiKey);
    if (this.hasApi) {
      console.info(`GEMINI_API_KEY detected. Using model ${this.model} at ${this.endpoint}`);
    }
  }

  async generateResponse(
    commandText: string,
    context: string,
    memories: MemoryReference[],
    screenContext?: string
  ): Promise<LLMResponse> {
    if (!this.hasApi || !this.endpoint) {
      const fb = this.fallback(commandText, memories);
      const cleaned = this.chooseAssistantText(fb.assistant_text, fb.actions);
      return this.forceRecallAssistantText({ ...fb, assistant_text: cleaned });
    }

    try {
      const payload = this.buildGeminiPayload(commandText, context, memories, screenContext);

      // If the API expects API key as query param (Google API key style), append it.
      const apiKey = process.env.GEMINI_API_KEY || '';
      const useQueryKey = apiKey.startsWith('AIza');
      const url = useQueryKey ? `${this.endpoint}?key=${encodeURIComponent(apiKey)}` : this.endpoint;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (!useQueryKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
      if (!resp.ok) {
        console.warn('LLM request failed', resp.status, await resp.text());
        return this.fallback(commandText, memories);
      }

      const data = await resp.json();
      const assistant_text = this.extractGeminiText(data);
      if (assistant_text) {
        try {
          const parsed = JSON.parse(assistant_text) as LLMResponse;
          const withFb = this.withFallbackActions(parsed, commandText, memories);
          return this.applyMemoryGuard(withFb, commandText, memories);
        } catch {
          const withFb = this.withFallbackActions({ assistant_text, actions: [] }, commandText, memories);
          return this.applyMemoryGuard(withFb, commandText, memories);
        }
      }

      const fb = this.fallback(commandText, memories);
      return this.applyMemoryGuard(fb, commandText, memories);
    } catch (err) {
      console.warn('LLM call failed, using fallback:', err instanceof Error ? err.message : err);
      return this.applyMemoryGuard(this.fallback(commandText, memories), commandText, memories);
    }
  }

  /**
   * Call Gemini Flash for MAKER microagent tasks
   * 
   * Lightweight API call specifically for MAKER microagents.
   * Uses Flash-8B model for speed and cost efficiency.
   * 
   * @param options - Prompt, temperature, and timeout configuration
   * @returns Extracted text from Gemini response
   */
  async callGeminiFlash(options: {
    prompt: string;
    temperature?: number;
    timeout?: number;
  }): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not set');
    }

    const model = process.env.MAKER_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-latest';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const useQueryKey = apiKey.startsWith('AIza');
    const url = useQueryKey ? `${endpoint}?key=${encodeURIComponent(apiKey)}` : endpoint;

    // Set up timeout with AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 10000);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (!useQueryKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: options.prompt }],
            },
          ],
          generationConfig: {
            temperature: options.temperature !== undefined ? options.temperature : 0.4,
            maxOutputTokens: 4096,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        const errorText = await resp.text();
        throw new Error(`Gemini API call failed (${resp.status}): ${errorText}`);
      }

      const data = await resp.json();
      const text = this.extractGeminiText(data);

      if (!text) {
        throw new Error('No text in Gemini response');
      }

      return text;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Gemini API call timed out');
      }
      throw error;
    }
  }


  private buildGeminiPayload(
    commandText: string,
    context: string,
    memories: MemoryReference[],
    screenContext?: string
  ) {
    const memoryText = memories
      .map(
        (m) =>
          `- [${m.type}] ${m.summary}${m.metadata?.path ? ` (path: ${m.metadata.path})` : ''
          }`
      )
      .join('\n');

    const parts = [
      'You are Ghost, an AI OS assistant.',
      'Respond in strict JSON: { "assistant_text": string, "actions": Action[] }.',
      'Actions supported: "file.open" { path }, "file.scroll" { direction, amount? }, "file.index" { path }, "info.recall" { summary }, "info.summarize" { topic, sources: string[], format: "brief"|"detailed"|"timeline" }, "reminder.create" { title, notes?, dueDate? }, "search.query" { query }.  ',
      '',
      'IMPORTANT: If memories are provided below, YOU MUST answer the user\'s question directly using the information from those memories. Do not defer to search or recall actions when you already have the answer in the memories.',
      'Ignore memories of type fact.command or fact.response (those are conversation logs). Prefer factual/doc/file memories.',
      'Do NOT echo the user question or say "User asked". Provide the direct answer in 1 short sentence. If you surface info.recall, assistant_text should state that recall summary.',
      'Keep assistant_text to a direct 1-2 sentence answer with no meta commentary or "searching" preamble. If you surface an "info.recall" action, assistant_text should restate that recall summary so the user immediately hears the answer.',
      '',
      'If the user asks for a summary/recap/overview of multiple topics, return an "info.summarize" action referencing relevant memory IDs.',
      '',
      'User command:',
      commandText,
      'Context:',
      context || 'None',
      'Memories:',
      memoryText || 'None',
    ];

    if (screenContext) {
      parts.push('Screen Context (what the user is looking at):');
      parts.push(screenContext);
    }

    const userPrompt = parts.join('\n');

    return {
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
    };
  }

  private extractGeminiText(data: any): string | null {
    const candidate = data?.candidates?.[0];
    const partWithText = candidate?.content?.parts?.find((p: any) => typeof p.text === 'string');
    if (partWithText?.text) return partWithText.text;
    if (candidate?.output_text) return candidate.output_text;
    if (typeof data?.text === 'string') return data.text;
    if (typeof data?.output === 'string') return data.output;
    return null;
  }

  private withFallbackActions(response: LLMResponse, commandText: string, memories: MemoryReference[]): LLMResponse {
    if (response.actions && response.actions.length > 0) {
      const cleaned = this.chooseAssistantText(response.assistant_text, response.actions);
      const hasRecall = response.actions.some((a) => a.type === 'info.recall');
      if (!hasRecall && this.isMetaChatter(cleaned)) {
        const fb = this.fallback(commandText, memories);
        return { ...fb, assistant_text: this.chooseAssistantText(fb.assistant_text, fb.actions) };
      }
      return { ...response, assistant_text: cleaned };
    }
    const fb = this.fallback(commandText, memories);
    return {
      assistant_text: this.chooseAssistantText(response.assistant_text || fb.assistant_text, fb.actions),
      actions: fb.actions,
    };
  }

  /**
   * Prefer a recalled summary over model chatter so the user hears the answer first.
   */
  private chooseAssistantText(text: string | undefined, actions: Action[]): string {
    const cleaned = this.cleanAssistantText(text || '');
    const recallSummary = this.getRecallSummary(actions);

    if (recallSummary) {
      const hasSummaryInText = cleaned.toLowerCase().includes(recallSummary.toLowerCase());
      if (!hasSummaryInText) return recallSummary;
    }

    if (this.isMetaChatter(cleaned)) {
      if (recallSummary) return recallSummary;
      // As a fallback, strip the meta chatter entirely
      const stripped = cleaned.replace(/user asked:?/gi, '').trim();
      if (stripped) return stripped;
    }

    return cleaned;
  }

  private getRecallSummary(actions: Action[]): string | null {
    const recall = actions.find((a) => a.type === 'info.recall');
    const summary = recall && (recall.params as any)?.summary;
    if (typeof summary === 'string' && summary.trim().length > 0) {
      return summary.trim();
    }
    return null;
  }

  private isMetaChatter(text: string): boolean {
    return /(user asked|previously attempted|search now|no memories found)/i.test(text);
  }

  /**
   * Build a concise snippet from a memory based on the user's query.
   */
  private buildRelevantSummary(memory: MemoryReference, commandText: string): string {
    const summary = memory.summary || '';
    const lowerCmd = commandText.toLowerCase();

    const allTokens = lowerCmd.split(/\W+/).filter((w) => w.length > 2);
    const stopwords = new Set([
      'what',
      'did',
      'say',
      'about',
      'the',
      'and',
      'for',
      'with',
      'that',
      'this',
      'are',
      'was',
      'were',
      'have',
      'has',
      'had',
      'but',
      'you',
      'your',
      'api',
      'redesign',
      'project',
      'alpha',
      'rest',
      'meeting',
      'notes',
      'doc',
      'document',
      'summary',
      'feedback',
      'question',
      'asked',
      'ask',
    ]);
    const focusTokens = allTokens.filter((t) => !stopwords.has(t));
    const sentences = summary.split(/(?<=[.!?])\s+/).filter(Boolean);

    const scoreSentence = (s: string) => {
      const lower = s.toLowerCase();
      let score = 0;
      allTokens.forEach((t) => {
        if (!t) return;
        const weight = focusTokens.includes(t) ? 3 : 1;
        if (lower.includes(t)) score += weight;
      });
      return score;
    };

    const scored = sentences
      .map((s) => ({ s: s.trim(), score: scoreSentence(s) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    const chosenSentences =
      scored.length > 0 ? scored.slice(0, 2).map((i) => i.s) : sentences.slice(0, 2);

    // Smart summarization:
    // 1. If short enough (< 350 chars), keep it all.
    // 2. If too long, take top 3 sentences but ensure we don't cut off mid-sentence.
    // 3. Hard cap at 500 chars to prevent rambling.

    const joined = chosenSentences.map((s) => s.replace(/\s+/g, ' ')).join(' ');
    const snippet = joined.trim() || summary;

    if (snippet.length <= 350) {
      return snippet;
    }

    // Take first 3 sentences or up to 450 chars, whichever is shorter but sentence-complete
    const sentencesToKeep = snippet.split(/(?<=[.!?])\s+/).filter(Boolean);
    let result = '';
    for (const s of sentencesToKeep) {
      if ((result + s).length > 450) break;
      result += s + ' ';
    }

    return result.trim() || snippet.slice(0, 350) + '...';
  }

  /**
   * Ensure assistant_text is the recall summary if one exists.
   */
  private forceRecallAssistantText(response: LLMResponse): LLMResponse {
    const recallSummary = this.getRecallSummary(response.actions);
    if (recallSummary) {
      return { ...response, assistant_text: recallSummary };
    }
    return response;
  }

  /**
   * If we have memories but the LLM returned nothing useful, fall back to deterministic recall.
   */
  private applyMemoryGuard(response: LLMResponse, commandText: string, memories: MemoryReference[]): LLMResponse {
    if (!memories || memories.length === 0) {
      return this.forceRecallAssistantText(response);
    }

    const recallSummary = this.getRecallSummary(response.actions);
    const hasUsefulRecall =
      recallSummary &&
      !/no memories found/i.test(recallSummary) &&
      !this.isMetaChatter(recallSummary);

    const hasActions = response.actions && response.actions.length > 0;

    if (!hasActions || !hasUsefulRecall) {
      const fb = this.fallback(commandText, memories);
      return this.forceRecallAssistantText(fb);
    }

    return this.forceRecallAssistantText(response);
  }

  private buildSystemPrompt(): string {
    return [
      'You are Ghost, an AI OS assistant.',
      'Respond in strict JSON with { "assistant_text": string, "actions": Action[] }.',
      'Actions supported: "file.open" { path }, "file.scroll" { direction, amount? }, "file.index" { path }, "info.recall" { summary }, "info.summarize" { topic, sources: string[], format: "brief"|"detailed"|"timeline" }, "reminder.create" { title, notes?, dueDate? }, "search.query" { query }.',
      'IMPORTANT: If memories are provided, answer the user\'s question directly using them. Do not defer to actions when you have the answer.',
      'Be concise and actionable.',
    ].join(' ');
  }

  /**
   * Deterministic fallback used when LLM is unavailable
   */
  private fallback(commandText: string, memories: MemoryReference[]): LLMResponse {
    const lower = commandText.toLowerCase();
    const actions: Action[] = [];
    let assistant_text = `On it.`;
    const downloadsPath = process.env.HOME ? path.join(process.env.HOME, 'Downloads') : null;

    // Separate file memories and other memories
    const fileMemories = memories.filter(
      (mem) => mem.type.startsWith('entity.file') && mem.metadata?.path
    );
    // Prefer any non-file memory (facts, docs, persons, etc.) with highest score, ignore screen/context
    const infoMemory = [...memories]
      .filter(
        (mem) => !mem.type.startsWith('entity.file') && !mem.type.startsWith('context.screen')
      )
      .sort((a, b) => (b.score || 0) - (a.score || 0))[0];

    // Helper to pick random memory
    const pickRandom = (list: MemoryReference[]): MemoryReference | undefined => {
      if (list.length === 0) return undefined;
      const idx = Math.floor(Math.random() * list.length);
      return list[idx];
    };

    // Detect summarization intent
    const wantsSummary = /(summarize|summary|recap|overview|everything about)/i.test(lower);
    if (wantsSummary) {
      const topic = this.extractTopic(commandText);
      const relevant = [...memories].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 8);
      const sources = relevant.map((m) => m.id);
      const fileCount = relevant.filter((m) => m.type.startsWith('entity.file')).length;
      const nonFileCount = relevant.length - fileCount;

      const timeline = [...relevant].sort((a, b) => {
        const aDate = this.getMemoryDate(a);
        const bDate = this.getMemoryDate(b);
        return bDate - aDate;
      });

      const topSnippets = timeline
        .slice(0, 3)
        .map((m) => {
          const date = this.getMemoryDate(m);
          const iso = isNaN(date) ? '' : new Date(date).toISOString().split('T')[0];
          return iso ? `${iso}: ${m.summary}` : m.summary;
        })
        .join(' • ');

      assistant_text = [
        `Summary for "${topic}":`,
        `Based on ${relevant.length} memories (${fileCount} files, ${nonFileCount} other).`,
        topSnippets ? topSnippets : 'No detailed timeline available.',
      ].join(' ');

      actions.push({
        type: 'info.summarize',
        params: {
          topic,
          sources,
          format: 'timeline',
        },
      });
      return { assistant_text, actions };
    }

    // Detect scroll intent
    const wantsScroll = /(scroll|move|go) (up|down)/i.test(lower);
    if (wantsScroll) {
      const directionMatch = lower.match(/(up|down)/i);
      const direction = directionMatch && directionMatch[1] === 'down' ? 'down' : 'up';
      // Extract optional amount (pages or lines)
      const amountMatch = lower.match(/(\d+)\s*(pages?|lines?)/i);
      const amount = amountMatch ? parseInt(amountMatch[1]) * (direction === 'down' ? 800 : -800) : undefined;
      actions.push({
        type: 'file.scroll',
        params: { direction, amount },
      });
      assistant_text = `Scrolling ${direction}`;
      return { assistant_text, actions };
    }

    // If there are no file memories, fall back to a generic info response
    if (fileMemories.length === 0 && !infoMemory) {
      assistant_text = "I don't have any relevant information for that request. Try indexing some files or ask about something else.";
      actions.push({
        type: 'info.recall',
        params: { summary: 'No memories found. Check the dashboard for indexed content.' },
      });
      return { assistant_text, actions };
    }

    // Heuristic scoring for file selection (similar to previous implementation)
    const wantsDownloads = /download(s)?/i.test(lower);
    const wantsRandom = /random/i.test(lower);
    const wantsRecent = /(latest|recent|new)/i.test(lower);

    const tokens = lower
      .split(/\s+/)
      .filter((t) => t.length > 2 && !['open', 'the', 'a', 'an', 'folder', 'file', 'please', 'in', 'my'].includes(t));

    const scoreFile = (mem: MemoryReference): number => {
      const name = (mem.metadata?.name || mem.summary || '').toLowerCase();
      let score = 0;
      tokens.forEach((t) => {
        if (name.includes(t)) score += 2;
      });
      if (wantsDownloads && mem.metadata?.path?.includes('Downloads')) score += 1;
      return score;
    };

    const sortedFiles = [...fileMemories].sort((a, b) => {
      if (wantsRecent) {
        const dateA = a.metadata?.modified ? new Date(a.metadata.modified).getTime() : 0;
        const dateB = b.metadata?.modified ? new Date(b.metadata.modified).getTime() : 0;
        // If dates are significantly different (e.g. > 1 min), prefer recent
        if (Math.abs(dateA - dateB) > 60000) return dateB - dateA;
      }
      return scoreFile(b) - scoreFile(a);
    });

    let chosenFile: MemoryReference | undefined;

    if (wantsDownloads) {
      const dlCandidates = fileMemories
        .filter((m) => m.metadata?.path?.includes('Downloads'))
        .sort((a, b) => {
          if (wantsRecent) {
            const dateA = a.metadata?.modified ? new Date(a.metadata.modified).getTime() : 0;
            const dateB = b.metadata?.modified ? new Date(b.metadata.modified).getTime() : 0;
            if (Math.abs(dateA - dateB) > 60000) return dateB - dateA;
          }
          return scoreFile(b) - scoreFile(a);
        });
      chosenFile = wantsRandom ? pickRandom(dlCandidates) : dlCandidates[0];
      if (!chosenFile && downloadsPath) {
        actions.push({ type: 'file.open', params: { path: downloadsPath } });
        assistant_text = 'Opening your Downloads folder.';
        return { assistant_text, actions };
      }
    }

    if (!chosenFile && sortedFiles.length > 0) {
      chosenFile = wantsRandom ? pickRandom(sortedFiles) : sortedFiles[0];
    }

    // Build enriched file.open action if we have a file
    if (chosenFile && /(open|show|launch|file|folder|document|downloads?)/i.test(commandText)) {
      const params: FileOpenParams = {
        path: chosenFile.metadata?.path ?? '',
      };
      if (chosenFile.metadata?.page) params.page = chosenFile.metadata.page;
      if (chosenFile.metadata?.section) params.section = chosenFile.metadata.section;
      if (chosenFile.metadata?.lineNumber) params.lineNumber = chosenFile.metadata.lineNumber;

      actions.push({ type: 'file.open', params });

      const friendlyName = path.basename(chosenFile.metadata?.path ?? '');
      let hint = '';
      if (params.page) hint = ` on page ${params.page}`;
      else if (params.section) hint = `, ${params.section}`;
      else if (params.lineNumber) hint = ` at line ${params.lineNumber}`;
      assistant_text = `Opening ${friendlyName}${hint}`;
    } else if (infoMemory) {
      const snippet = this.buildRelevantSummary(infoMemory, commandText);
      actions.push({ type: 'info.recall', params: { summary: snippet } });
      assistant_text = snippet;
    } else if (chosenFile) {
      // If we have a best-matching file but no explicit open intent, recall its summary.
      actions.push({
        type: 'info.recall',
        params: { summary: chosenFile.summary },
      });
      assistant_text = chosenFile.summary;
    }

    // Recent files fallback
    if (wantsRecent && fileMemories.length > 0 && actions.length === 0) {
      const recent = fileMemories
        .map((m) => ({
          mem: m,
          modified: m.metadata?.modified ? new Date(m.metadata.modified).getTime() : 0,
        }))
        .sort((a, b) => b.modified - a.modified)
        .slice(0, 3)
        .map((r) => (r.mem.metadata?.name ? r.mem.metadata.name : r.mem.summary))
        .filter(Boolean);
      if (recent.length > 0) {
        actions.push({
          type: 'info.recall',
          params: { summary: `Most recent files: ${recent.join(', ')}` },
        });
        assistant_text = `Here are the latest files: ${recent.join(', ')}`;
      }
    }

    // If no action was produced, try to recall the top non-file memory; otherwise fall back to no-memory message
    if (actions.length === 0) {
      if (infoMemory) {
        const snippet = this.buildRelevantSummary(infoMemory, commandText);
        actions.push({ type: 'info.recall', params: { summary: snippet } });
        assistant_text = snippet;
      } else {
        assistant_text = "I don't have any relevant information for that request. Try indexing some files or ask about something else.";
        actions.push({
          type: 'info.recall',
          params: { summary: 'No memories found. Check the dashboard for indexed content.' },
        });
      }
    }

    return { assistant_text, actions };
  }

  private extractTopic(commandText: string): string {
    const match = commandText.match(/summarize\s+(.*)/i) || commandText.match(/summary of\s+(.*)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    return commandText.trim();
  }

  private getMemoryDate(mem: MemoryReference): number {
    const metaDate =
      mem.metadata?.modified ||
      mem.metadata?.timestamp ||
      mem.metadata?.created_at ||
      mem.metadata?.createdAt;
    const parsed = metaDate ? new Date(metaDate).getTime() : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private cleanAssistantText(text: string): string {
    if (!text) return '';
    let t = text.trim();
    // Strip code fences if present
    if (t.startsWith('```')) {
      t = t.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
    }
    // If the model responded with JSON that includes assistant_text, extract it
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed.assistant_text === 'string') {
        return parsed.assistant_text;
      }
    } catch {
      // ignore parse errors
    }
    return t;
  }
}

export const llmCoordinator = new LLMCoordinator();
