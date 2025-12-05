import path from 'node:path';
import type { Action, LLMResponse, MemoryReference, FileOpenParams } from '../types.js';

const DEFAULT_MODEL = 'gemini-2.0-flash-exp';
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
    screenContext?: string,
    conversationalMode?: boolean
  ): Promise<LLMResponse> {
    if (!this.hasApi || !this.endpoint) {
      const fb = this.fallback(commandText, memories);
      const cleaned = this.chooseAssistantText(fb.assistant_text, fb.actions);
      return this.forceRecallAssistantText({ ...fb, assistant_text: cleaned });
    }

    // Special case: Reminder query with no memories
    const isReminderQuery = /what.*(working|bug|reminder|yesterday|task)/i.test(commandText);
    if (isReminderQuery && memories.length === 0) {
      return {
        assistant_text: "I don't see any reminders yet. Want me to create one?",
        actions: []
      };
    }

    try {
      const payload = this.buildGeminiPayload(commandText, context, memories, screenContext, conversationalMode);

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

    const model = process.env.MAKER_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
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
    screenContext?: string,
    conversationalMode?: boolean
  ) {
    const memoryText = memories
      .map(
        (m) =>
          `- [${m.type}] ${m.summary}${m.metadata?.path ? ` (path: ${m.metadata.path})` : ''
          }`
      )
      .join('\n');

    // Chat mode: warm personality with natural reactions
    const chatPersonality = [
      'You are Ghost, a warm and slightly witty AI assistant with personality.',
      '',
      'PERSONALITY (IMPORTANT):',
      '- Use natural filler sounds and reactions: "Hmm...", "Oh!", "Ah, I see...", "Interesting...", "Let me check..."',
      '- Ask follow-up questions when clarification would help',
      '- Express genuine curiosity and empathy: "Ooh, that sounds tricky", "Yeahhh, I see the issue"',
      '- Add light humor when appropriate',
      '- Sound human, not robotic - like talking to a helpful friend',
      '- You can still perform actions, but engage conversationally first',
      '',
      'CRITICAL INSTRUCTION FOR SUMMARIES:',
      '- If asked to summarize, YOU must write the summary in "assistant_text" using the "doc.chunk" memories provided.',
      '- Do NOT just say "I will summarize this" and emit an action. The user wants to HEAR the summary.',
      '- Do NOT use robotic prefixes like "Summary for..." or "Based on X memories". Just speak the summary naturally.',
      '- Do NOT mention dates like "1970-01-01" unless they are part of the document content.',
      '- IGNORE "fact" memories that describe user interactions (e.g. "User requested..."). Only summarize "doc.chunk" content.',
      '- If only "fact" memories are available and no "doc.chunk", say "I don\'t have the details of that file in my memory yet."',
      '- Only use "info.summarize" action if you are also providing the verbal summary in "assistant_text".',
      '',
      'RESPONSE FORMAT:',
      'Respond in strict JSON: { "assistant_text": string, "actions": Action[] }.',
      'Keep responses conversational but concise (2-3 sentences max).',
    ].join('\n');

    // Action mode: efficient, terse (original behavior)
    const actionPersonality = [
      'You are Ghost, an advanced AI operating system interface. You are helpful, precise, and slightly mysterious.',
      'Your goal is to be the ultimate efficient assistant. You do not chat; you act.',
    ].join('\n');

    const parts = [
      conversationalMode ? chatPersonality : actionPersonality,
      '',
      'RESPONSE FORMAT:',
      'Respond in strict JSON: { "assistant_text": string, "actions": Action[] }.',
      '',
      'AVAILABLE ACTIONS:',
      '- "file.open" { path }: Open a file or folder. Only use if user explicitly asks to "open", "show", or "launch".',
      '- "file.scroll" { direction: "up"|"down", amount? }: Scroll the active window.',
      '- "file.index" { path }: Index a directory for search.',
      '- "info.recall" { summary }: State a fact or summary you found in memories.',
      '- "info.summarize" { topic, sources: string[], format: "brief"|"detailed"|"timeline" }: Summarize multiple memories/files.',
      '- "reminder.create" { title, notes?, dueDate? }: Create a reminder.',
      '- "search.query" { query }: Search if you have no relevant memories.',
      '',
      'CORE RULES:',
      '1. DIRECT ANSWERS: If you have memories that answer the question, answer it directly in "assistant_text". Do NOT say "I found this in..." or "Based on...". Just state the fact.',
      '2. STRICT FIRST PERSON: You are Ghost. Always speak as "I". Say "I opened the file", "I found the email". NEVER use third person like "The user asked" or "The assistant responded".',
      '3. NO META-COMMENTARY: NEVER describe the conversation. NEVER say "The user was inquiring about..." or "The assistant responded by...". Just ANSWER THE QUESTION DIRECTLY.',
      '4. NO METADATA LEAKAGE: Never mention file paths, memory IDs, or "context" in your spoken response unless explicitly asked.',
      '5. CONCISENESS: Keep "assistant_text" to 1-2 short, punchy sentences. You are a voice assistant; long text is bad.',
      '6. ACTION PRIORITY: If the user wants an action (like "remind me"), prioritize the action over chatting.',
      '7. CONTEXT AWARENESS: If "Screen Context" is provided, use it to answer questions about "this" or "what I\'m looking at".',
      '8. IGNORE CHATTER: Ignore "fact.command" and "fact.response" (past queries). Focus on "doc.chunk", "entity.file", "fact", or "doc" memories - these contain actual document content.',
      '9. DOCUMENT CONTENT: "doc.chunk" memories contain ACTUAL TEXT from documents. Use this text to answer questions directly. The filename prefix tells you which document it came from.',
      '10. SCROLL TO CONTEXT: If the user asks to "scroll to" or "show me" a specific part, use "file.open" with the "search" parameter. The "search" value MUST be a unique 5-10 word EXACT QUOTE from the "doc.chunk" memory text.',
      '11. FILE OPEN PRIORITY: If the user says open/show/launch and any memory has a file path, MUST emit "file.open" with that path before other actions. Use "info.recall" only if no actionable file path exists.',
      '12. DO NOT mention file names or paths in assistant_text. Keep it generic: "I just opened the file" or summarize without naming files.',
      '',
      'EXAMPLE:',
      'User: "What did Sarah say about the API redesign?"',
      'Memories: [doc.chunk] API_Redesign_Meeting_Notes_2024-03-10.txt: Sarah expressed general support but flagged a timeline concern. The iOS revamp is scheduled for Q2 release (April 15). We need these endpoints stable by April 1st.',
      'WRONG: "The user was inquiring about an API redesign discussion."',
      'WRONG: "I found information about Sarah and the API redesign."',
      'CORRECT: { "assistant_text": "Sarah expressed general support but flagged a timeline concern. She needs the API endpoints stable by April 1st for the iOS Q2 release.", "actions": [{ "type": "info.recall", "params": { "summary": "Sarah expressed general support but flagged a timeline concern. She needs the API endpoints stable by April 1st for the iOS Q2 release." }}] }',
      '',
      'User: "Show me where she said that"',
      'CORRECT: { "assistant_text": "Opening the meeting notes to that section.", "actions": [{ "type": "file.open", "params": { "path": "API_Redesign_Meeting_Notes_2024-03-10.txt", "search": "flagged a timeline concern" }}] }',
      '',
      'User command:',
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
    const cleaned = this.scrubFilenames(this.cleanAssistantText(text || ''));
    const recallSummary = this.getRecallSummary(actions);

    if (recallSummary) {
      const scrubbedRecall = this.scrubFilenames(recallSummary);
      const hasSummaryInText = cleaned.toLowerCase().includes(scrubbedRecall.toLowerCase());
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
    // Detect responses that describe the interaction instead of answering directly
    return /(user asked|user was|user inquir|previously attempted|search now|no memories found|the assistant|assistant responded|did not provide|based on.*memor)/i.test(text);
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
      'IMPORTANT: If memories are provided, answer the user\'s question directly using them.',
      'RULES:',
      '1. Do NOT mention "Based on X memories" or file paths in assistant_text. Just give the answer.',
      '2. Do NOT use "file.open" for summary requests. Use "info.summarize" instead.',
      '3. Keep assistant_text concise (1-2 sentences).',
      '4. Ignore "fact.command" and "fact.response" memories (conversation history) for the answer content.',
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
    // Tokens for overlap scoring
    const tokens = lower
      .split(/\s+/)
      .filter((t) => t.length > 2 && !['open', 'the', 'a', 'an', 'folder', 'file', 'please', 'in', 'my'].includes(t));

    const overlapScore = (mem: MemoryReference): number => {
      const haystack = `${mem.summary || ''} ${JSON.stringify(mem.metadata || {})}`.toLowerCase();
      return tokens.reduce((acc, t) => (haystack.includes(t) ? acc + 1 : acc), 0);
    };

    // Prefer any non-file memory (facts, docs, persons, etc.) with overlap and score, ignore screen/context/fact.session
    const infoMemory = [...memories]
      .filter(
        (mem) =>
          !mem.type.startsWith('entity.file') &&
          !mem.type.startsWith('context.screen') &&
          !mem.type.startsWith('fact.session')
      )
      .map((mem) => {
        const base = mem.score || 0;
        const ov = overlapScore(mem);
        const typeBoost = mem.type.startsWith('doc.chunk') ? 2 : mem.type.startsWith('fact') ? 1 : 0;
        return { mem, rank: base + ov * 1.5 + typeBoost };
      })
      .sort((a, b) => b.rank - a.rank)[0]?.mem;

    // Helper to pick random memory
    const pickRandom = (list: MemoryReference[]): MemoryReference | undefined => {
      if (list.length === 0) return undefined;
      const idx = Math.floor(Math.random() * list.length);
      return list[idx];
    };

    // Detect reminder intent - expanded patterns
    const reminderPatterns = [
      /remind me/i,                           // "remind me to..."
      /set a reminder/i,                      // "set a reminder"
      /\breminder\b/i,                        // "create a reminder"
      /don'?t (let me )?forget/i,             // "don't let me forget"
      /\bnote that\b/i,                       // "note that I need to..."
      /\bremember (this|that|to)\b/i,         // "remember to fix this"
      /\bsave (this|that) for later\b/i,      // "save this for later"
      /\bput (this|that) on my (list|todo)\b/i, // "put this on my list"
      /\bi need to\b.*\blater\b/i,            // "I need to do this later"
      /\bcome back to this\b/i,               // "come back to this"
      /\bmake (a )?note\b/i,                  // "make a note"
    ];
    const wantsReminder = reminderPatterns.some(p => p.test(lower));
    if (wantsReminder) {
      // Extract title: everything after "remind me to" or "remind me"
      let title = commandText.replace(/.*remind me (to )?/i, '').trim();
      if (!title) title = 'Reminder';

      actions.push({
        type: 'reminder.create',
        params: { title }
      });
      assistant_text = `Setting a reminder: ${title}`;
      return { assistant_text, actions };
    }

    // Detect summarization intent - expanded patterns
    const summaryPatterns = [
      /summarize/i,                           // "summarize this"
      /\bsummary\b/i,                         // "give me a summary"
      /\brecap\b/i,                           // "recap"
      /\boverview\b/i,                        // "overview"
      /everything about/i,                    // "tell me everything about"
      /\bwhat do (i|we) know about\b/i,       // "what do we know about"
      /\bcatch me up\b/i,                     // "catch me up on"
      /\bfill me in\b/i,                      // "fill me in on"
      /\bwhat('?s| is) the (status|state)\b/i, // "what's the status"
      /\btell me about\b/i,                   // "tell me about"
      /\bbrief me\b/i,                        // "brief me on"
      /\bbreak (it|this) down\b/i,            // "break it down"
      /\bkey (points|takeaways)\b/i,          // "key points"
      /\bhighlights?\b/i,                     // "highlights"
      /\btl;?dr\b/i,                          // "tldr" or "tl;dr"
    ];
    const wantsSummary = summaryPatterns.some(p => p.test(lower));
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

    // Detect scroll intent - expanded patterns
    const scrollPatterns = [
      /(scroll|move|go) (up|down)/i,          // "scroll up/down"
      /\b(page|screen) (up|down)\b/i,         // "page up/down"
      /\bshow me (more|less)\b/i,             // "show me more"
      /\b(keep|continue) (scrolling|going)\b/i, // "keep scrolling"
      /\bnext (page|section)\b/i,             // "next page"
      /\bprevious (page|section)\b/i,         // "previous page"
      /\b(go|jump) to (top|bottom)\b/i,       // "go to top"
    ];
    const wantsScroll = scrollPatterns.some(p => p.test(lower));
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
    // Downloads patterns - expanded
    const downloadsPatterns = [
      /download(s)?/i,                        // "downloads"
      /\bfrom (the )?downloads\b/i,           // "from downloads"
      /\b(in|from) my downloads\b/i,          // "in my downloads"
    ];
    const wantsDownloads = downloadsPatterns.some(p => p.test(lower));

    // Random patterns - expanded
    const randomPatterns = [
      /\brandom\b/i,                          // "random"
      /\bany\b/i,                             // "any file"
      /\bsurprise me\b/i,                     // "surprise me"
      /\bpick (one|something)\b/i,            // "pick one"
    ];
    const wantsRandom = randomPatterns.some(p => p.test(lower));

    // Recent patterns - expanded
    const recentPatterns = [
      /(latest|recent|new)/i,                 // "latest", "recent", "new"
      /\bjust (added|created|modified)\b/i,   // "just added"
      /\blast (one|file)\b/i,                 // "last one"
      /\btoday'?s\b/i,                        // "today's"
      /\bthis (week|month)\b/i,               // "this week"
      /\bmost recent\b/i,                     // "most recent"
    ];
    const wantsRecent = recentPatterns.some(p => p.test(lower));

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

    // If the user explicitly wants to open/show and we have file memories but no chosen file yet, pick the top file.
    const explicitOpenIntent = /(open|show|launch|start)/i.test(commandText);
    if (explicitOpenIntent && !chosenFile && fileMemories.length > 0) {
      chosenFile = sortedFiles[0] || fileMemories[0];
    }

    // Build enriched file.open action if we have a file
    if (chosenFile && explicitOpenIntent) {
      const params: FileOpenParams = {
        path: chosenFile.metadata?.path ?? '',
      };
      if (chosenFile.metadata?.page) params.page = chosenFile.metadata.page;
      if (chosenFile.metadata?.section) params.section = chosenFile.metadata.section;
      if (chosenFile.metadata?.lineNumber) params.lineNumber = chosenFile.metadata.lineNumber;

      actions.push({ type: 'file.open', params });

      let hint = '';
      if (params.page) hint = ` on page ${params.page}`;
      else if (params.section) hint = `, jumping to the section`;
      else if (params.lineNumber) hint = ` at the specified line`;
      // Keep assistant_text generic to avoid leaking file names
      assistant_text = `I just opened the file${hint}.`;
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

  /**
   * Strip file names/paths from assistant_text to avoid leaking them.
   */
  private scrubFilenames(text: string): string {
    if (!text) return '';
    // Remove simple file paths and filenames (handles / and \ separators)
    const withoutPaths = text
      .replace(/[A-Za-z]:?[\/\\][\w\s.\-_/\\]+/g, '') // strip paths like C:\foo\bar or /foo/bar
      .replace(/\b[\w.-]+\.[A-Za-z0-9]{2,5}\b/g, '');    // strip filename.ext patterns
    return withoutPaths.replace(/\s{2,}/g, ' ').trim();
  }

  /**
   * Summarize screen context (OCR text) using Gemini Flash.
   * 
   * Used when creating reminders to generate an intelligent summary
   * of what the user was looking at (code, documents, etc.)
   * 
   * @param ocrText - The OCR-extracted text from the screenshot
   * @returns A concise 1-2 sentence summary, or null if summarization fails
   */
  async summarizeScreenContext(ocrText: string): Promise<string | null> {
    if (!ocrText || ocrText.trim().length < 20) {
      return null;
    }

    const prompt = `You are an AI assistant helping a user remember what they were working on when they set a reminder.

Given the following text extracted from a screenshot of their screen, provide a VERY CONCISE summary (8-12 words MAX) of the issue or task they were looking at.

IMPORTANT RULES:
- Maximum 8-12 words
- Focus on the PROBLEM or TASK, not the file structure
- Be specific: mention function names, error types, or key concepts
- No filler words like "The user was looking at..."
- Write as if completing: "You were working on..."

EXAMPLES:
- "fixing authentication token validation bug in login"
- "React useEffect missing dependency causing infinite loop"
- "API endpoint returning 500 error on user creation"
- "implementing pagination for search results"

OCR Text:
${ocrText.slice(0, 2000)}

Respond with ONLY the concise summary (8-12 words), nothing else.`;

    try {
      const response = await this.callGeminiFlash({
        prompt,
        temperature: 0.2,  // Lower temperature for more consistent, concise output
        timeout: 5000,
      });
      const summary = response.trim();
      // Validate the summary is reasonable (8-12 words = roughly 40-100 chars)
      if (summary && summary.length > 15 && summary.length < 150) {
        return summary;
      }
      return null;
    } catch (error) {
      console.warn('[LLMCoordinator] Failed to summarize screen context:', error instanceof Error ? error.message : error);
      return null;
    }
  }
}

export const llmCoordinator = new LLMCoordinator();
