/**
 * Chat Capture - Main entry point
 * Requirements: 1.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.6, 5.7, 7.3, 7.4
 */

import { ParserRegistry } from './registry.js';
import { ConversationParser } from './parsers/base.js';
import { OpenAIParser } from './parsers/openai.js';
import { AnthropicParser } from './parsers/anthropic.js';
import { ConversationValidator } from './validator.js';
import { StreamingConversationBuilder } from './streaming.js';
import {
  NormalizedConversation,
  ChatCaptureConfig,
  ParseOptions,
  Logger,
} from './types.js';
import { CaptureError, Result, ok, err } from './errors.js';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<Omit<ChatCaptureConfig, 'logger'>> = {
  maxFileSize: 50 * 1024 * 1024, // 50MB
  maxConversationsPerFile: 1000,
  enableAutoDetection: true,
};

/**
 * Console logger implementation
 */
class ConsoleLogger implements Logger {
  error(message: string, context?: Record<string, any>): void {
    console.error(message, context || '');
  }

  warn(message: string, context?: Record<string, any>): void {
    console.warn(message, context || '');
  }

  info(message: string, context?: Record<string, any>): void {
    console.info(message, context || '');
  }

  debug(message: string, context?: Record<string, any>): void {
    console.debug(message, context || '');
  }
}

/**
 * Main ChatCapture class for ingesting and normalizing chat conversations
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */
export class ChatCapture {
  private registry: ParserRegistry;
  private validator: ConversationValidator;
  private config: Required<ChatCaptureConfig>;

  /**
   * Create a new ChatCapture instance
   * Requirements: 4.1, 4.2
   * @param config - Configuration options
   */
  constructor(config: ChatCaptureConfig = {}) {
    // Initialize configuration with defaults
    this.config = {
      maxFileSize: config.maxFileSize ?? DEFAULT_CONFIG.maxFileSize,
      maxConversationsPerFile:
        config.maxConversationsPerFile ?? DEFAULT_CONFIG.maxConversationsPerFile,
      enableAutoDetection:
        config.enableAutoDetection ?? DEFAULT_CONFIG.enableAutoDetection,
      logger: config.logger ?? new ConsoleLogger(),
    };

    // Initialize parser registry
    this.registry = new ParserRegistry();

    // Register default parsers (OpenAI, Anthropic)
    // Requirements: 4.2
    this.registry.register('openai', new OpenAIParser());
    this.registry.register('anthropic', new AnthropicParser());

    // Initialize validator
    this.validator = new ConversationValidator();
  }

  /**
   * Parse a file with an explicit provider
   * Requirements: 4.3, 5.7, 7.3, 7.4
   * @param file - File content as Buffer or JSON string
   * @param provider - Provider identifier (e.g., 'openai', 'anthropic')
   * @param options - Parse options
   * @returns Result containing normalized conversations or error
   */
  async parseFile(
    file: Buffer | string,
    provider: string,
    options: ParseOptions = {}
  ): Promise<Result<NormalizedConversation[], CaptureError>> {
    try {
      // Validate file size
      // Requirement 5.7: Enforce configurable limits on file size
      const sizeCheck = this.validateFileSize(file);
      if (!sizeCheck.ok) {
        return sizeCheck;
      }

      // Parse JSON (with HTML fallback)
      let data: unknown;
      const parseResult = this.parseJSON(file);
      if (parseResult.ok) {
        data = parseResult.value;
      } else {
        const htmlJson = this.extractJsonFromHtml(file);
        if (!htmlJson.ok) {
          return parseResult;
        }
        const htmlParse = this.parseJSON(htmlJson.value);
        if (!htmlParse.ok) {
          return htmlParse;
        }
        data = htmlParse.value;
        this.config.logger.info('Parsed HTML export by extracting embedded JSON', { providerHint: provider });
      }

      // Get parser for provider
      // Requirement 4.3: Select appropriate parser based on explicit provider identifier
      const parser = this.registry.get(provider);
      if (!parser) {
        // Requirement 4.5: Return clear error when provider not registered
        this.config.logger.error('Provider not found', { provider });
        return err({
          type: 'provider_not_found',
          provider,
        });
      }

      // Parse conversations
      let conversations: NormalizedConversation[];
      try {
        conversations = await parser.parse(data);
        this.config.logger.info('Conversations parsed successfully', {
          provider,
          count: conversations.length,
        });
      } catch (parseError) {
        // Requirement 7.2: Log parsing errors with provider and error context
        // Requirement 7.3: Include provider and error location
        // Requirement 7.5: Log parsing errors with sufficient context for debugging
        this.config.logger.error('Parser failed to process data', {
          provider,
          error: parseError instanceof Error ? parseError.message : String(parseError),
          stack: parseError instanceof Error ? parseError.stack : undefined,
        });
        return err({
          type: 'parse_error',
          provider,
          message: parseError instanceof Error ? parseError.message : 'Unknown parse error',
          cause: parseError,
        });
      }

      // Validate conversation count
      // Requirement 5.7: Enforce configurable limits on number of conversations per import
      const countCheck = this.validateConversationCount(conversations);
      if (!countCheck.ok) {
        return countCheck;
      }

      // Validate conversations
      // Requirement 5.6: Integrate validator for all parsed conversations
      return this.validateAndFilter(conversations, options, provider);
    } catch (error) {
      // Requirement 7.4: Handle corrupted JSON gracefully without crashing
      // Requirement 7.5: Log parsing errors with sufficient context for debugging
      this.config.logger.error('Unexpected error during file parsing', {
        provider,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return err({
        type: 'parse_error',
        provider,
        message: error instanceof Error ? error.message : 'Unknown parse error',
        cause: error,
      });
    }
  }

  /**
   * Parse a file with automatic provider detection
   * Requirements: 4.4, 4.5, 5.7, 7.3, 7.4
   * @param file - File content as Buffer or JSON string
   * @param options - Parse options
   * @returns Result containing normalized conversations or error
   */
  async parseFileAuto(
    file: Buffer | string,
    options: ParseOptions = {}
  ): Promise<Result<NormalizedConversation[], CaptureError>> {
    try {
      // Check if auto-detection is enabled
      if (!this.config.enableAutoDetection) {
        return err({
          type: 'detection_failed',
          message: 'Auto-detection is disabled in configuration',
        });
      }

      // Validate file size
      // Requirement 5.7: Enforce configurable limits on file size
      const sizeCheck = this.validateFileSize(file);
      if (!sizeCheck.ok) {
        return sizeCheck;
      }

      // Parse JSON; if it fails, try to extract embedded JSON from HTML exports
      let data: unknown;
      const parseResult = this.parseJSON(file);
      if (parseResult.ok) {
        data = parseResult.value;
      } else {
        const htmlJson = this.extractJsonFromHtml(file);
        if (!htmlJson.ok) {
          // Prefer the HTML-specific error to help the user diagnose
          return htmlJson;
        }
        const htmlParse = this.parseJSON(htmlJson.value);
        if (!htmlParse.ok) {
          return htmlParse;
        }
        data = htmlParse.value;
        this.config.logger.info('Parsed HTML export by extracting embedded JSON', { providerHint: 'openai' });
      }

      // Auto-detect provider
      // Requirement 4.4: Support automatic provider detection
      const parser = this.registry.detect(data);
      if (!parser) {
        // Requirement 4.5: Return clear error when provider cannot be detected
        this.config.logger.error('Provider detection failed', {
          availableProviders: this.registry.listProviders(),
        });
        return err({
          type: 'detection_failed',
          message: `Could not detect provider. Available providers: ${this.registry.listProviders().join(', ')}`,
        });
      }

      this.config.logger.info('Provider detected', { provider: parser.provider });

      // Parse conversations
      let conversations: NormalizedConversation[];
      try {
        conversations = await parser.parse(data);
        this.config.logger.info('Conversations parsed successfully', {
          provider: parser.provider,
          count: conversations.length,
        });
      } catch (parseError) {
        // Requirement 7.2: Log parsing errors with provider and error context
        // Requirement 7.3: Include provider and error location
        // Requirement 7.5: Log parsing errors with sufficient context for debugging
        this.config.logger.error('Parser failed to process data', {
          provider: parser.provider,
          error: parseError instanceof Error ? parseError.message : String(parseError),
          stack: parseError instanceof Error ? parseError.stack : undefined,
        });
        return err({
          type: 'parse_error',
          provider: parser.provider,
          message: parseError instanceof Error ? parseError.message : 'Unknown parse error',
          cause: parseError,
        });
      }

      // Validate conversation count
      // Requirement 5.7: Enforce configurable limits on number of conversations per import
      const countCheck = this.validateConversationCount(conversations);
      if (!countCheck.ok) {
        return countCheck;
      }

      // Validate conversations
      // Requirement 5.6: Integrate validator for all parsed conversations
      return this.validateAndFilter(conversations, options, parser.provider);
    } catch (error) {
      // Requirement 7.4: Handle corrupted JSON gracefully without crashing
      // Requirement 7.5: Log parsing errors with sufficient context for debugging
      this.config.logger.error('Unexpected error during auto-detection', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return err({
        type: 'parse_error',
        provider: 'unknown',
        message: error instanceof Error ? error.message : 'Unknown parse error',
        cause: error,
      });
    }
  }

  /**
   * Register a custom parser
   * Requirements: 4.2, 4.6
   * @param provider - Provider identifier
   * @param parser - Parser instance
   */
  registerParser(provider: string, parser: ConversationParser): void {
    this.registry.register(provider, parser);
    this.config.logger.info('Parser registered', { provider });
  }

  /**
   * Get list of registered providers
   * @returns Array of provider identifiers
   */
  listProviders(): string[] {
    return this.registry.listProviders();
  }

  /**
   * Create a streaming builder for real-time conversation capture
   * Requirements: 6.1, 6.2, 4.5
   * @param provider - Provider identifier (e.g., 'openai', 'anthropic')
   * @param conversationId - Unique conversation identifier
   * @returns Result containing StreamingConversationBuilder or error
   */
  createStreamingBuilder(
    provider: string,
    conversationId: string
  ): Result<StreamingConversationBuilder, CaptureError> {
    // Validate provider is registered
    // Requirement 4.5: Return clear error when provider not registered
    const parser = this.registry.get(provider);
    if (!parser) {
      this.config.logger.error('Provider not found for streaming builder', { provider });
      return err({
        type: 'provider_not_found',
        provider,
      });
    }

    // Create and return StreamingConversationBuilder instance
    // Requirements: 6.1, 6.2
    const builder = new StreamingConversationBuilder(
      provider,
      conversationId,
      parser
    );

    this.config.logger.info('Streaming builder created', {
      provider,
      conversationId,
    });

    return ok(builder);
  }

  /**
   * Validate file size
   * Requirement 5.7: Enforce configurable limits on file size
   */
  private validateFileSize(
    file: Buffer | string
  ): Result<void, CaptureError> {
    const size = Buffer.isBuffer(file) ? file.length : Buffer.byteLength(file);

    if (size > this.config.maxFileSize) {
      this.config.logger.error('File too large', {
        size,
        limit: this.config.maxFileSize,
      });
      return err({
        type: 'file_too_large',
        size,
        limit: this.config.maxFileSize,
      });
    }

    return ok(undefined);
  }

  /**
   * Validate conversation count
   * Requirement 5.7: Enforce configurable limits on number of conversations per import
   */
  private validateConversationCount(
    conversations: NormalizedConversation[]
  ): Result<void, CaptureError> {
    if (conversations.length > this.config.maxConversationsPerFile) {
      this.config.logger.error('Too many conversations', {
        count: conversations.length,
        limit: this.config.maxConversationsPerFile,
      });
      return err({
        type: 'too_many_conversations',
        count: conversations.length,
        limit: this.config.maxConversationsPerFile,
      });
    }

    return ok(undefined);
  }

  /**
   * Parse JSON from Buffer or string
   * Requirement 7.4: Handle corrupted JSON gracefully
   * Requirement 7.5: Add context to all error messages
   */
  private parseJSON(file: Buffer | string): Result<unknown, CaptureError> {
    try {
      const content = Buffer.isBuffer(file) ? file.toString('utf-8') : file;
      const data = JSON.parse(content);
      return ok(data);
    } catch (error) {
      // Requirement 7.2: Log parsing errors with context
      // Requirement 7.5: Add context to all error messages
      const errorMessage = error instanceof Error ? error.message : String(error);
      const fileSize = Buffer.isBuffer(file) ? file.length : Buffer.byteLength(file);
      
      this.config.logger.error('Failed to parse JSON', {
        error: errorMessage,
        fileSize,
        encoding: 'utf-8',
      });
      
      return err({
        type: 'parse_error',
        provider: 'unknown',
        message: `Invalid JSON format: ${errorMessage}`,
        cause: error,
      });
    }
  }

  /**
   * Extract embedded JSON from an HTML export (e.g., ChatGPT HTML download)
   */
  private extractJsonFromHtml(file: Buffer | string): Result<string, CaptureError> {
    const content = Buffer.isBuffer(file) ? file.toString('utf-8') : file;
    const lower = content.trim().toLowerCase();

    if (!lower.includes('<html') || !lower.includes('jsondata')) {
      return err({
        type: 'parse_error',
        provider: 'unknown',
        message: 'Invalid JSON format: Unable to parse file',
      });
    }

    // Try to capture jsonData up to the next var/const/let assetsJson (common ChatGPT export pattern)
    const assetsDelimited = content.match(/jsonData\s*=\s*(\[[\s\S]*?]);\s*(?:var|const|let)\s+assetsJson/i);
    if (assetsDelimited?.[1]) {
      return ok(assetsDelimited[1]);
    }

    // Grab jsonData assignments (var/let/const) with flexible whitespace and multiline arrays
    const match =
      content.match(/jsonData\s*=\s*(\[\s*[\s\S]*?\]);/i) ||
      content.match(/jsonData\s*=\s*(\[\s*[\s\S]*\])/i);

    if (match && match[1]) {
      return ok(match[1]);
    }

    // Fallback: capture between jsonData = and </script>, attempting bracket-balance
    const scriptSplit = content.split(/jsonData\s*=/i);
    if (scriptSplit.length > 1) {
      const after = scriptSplit[1];
      const endIdx = after.indexOf('</script>');
      const slice = endIdx !== -1 ? after.slice(0, endIdx) : after;
      const start = slice.indexOf('[');
      if (start !== -1) {
        let depth = 0;
        let inString: string | null = null;
        let escape = false;
        for (let i = start; i < slice.length; i++) {
          const ch = slice[i];
          if (escape) {
            escape = false;
            continue;
          }
          if (ch === '\\') {
            escape = true;
            continue;
          }
          if (inString) {
            if (ch === inString) {
              inString = null;
            }
            continue;
          }
          if (ch === '"' || ch === "'") {
            inString = ch;
            continue;
          }
          if (ch === '[') depth++;
          if (ch === ']') depth--;
          if (depth === 0) {
            return ok(slice.slice(start, i + 1));
          }
        }
      }
    }

    return err({
      type: 'parse_error',
      provider: 'unknown',
      message: 'Unable to extract conversations from HTML export',
    });
  }

  /**
   * Validate conversations and filter based on options
   * Requirements: 5.6, 5.7
   * @param conversations - Parsed conversations
   * @param options - Parse options
   * @param provider - Provider identifier for logging
   * @returns Result containing valid conversations or error
   */
  private validateAndFilter(
    conversations: NormalizedConversation[],
    options: ParseOptions,
    provider: string
  ): Result<NormalizedConversation[], CaptureError> {
    // Validate all conversations
    // Requirement 5.6: Integrate validator for all parsed conversations
    const batchResult = this.validator.validateBatch(conversations);

    // Log validation results
    // Requirement 7.2: Log validation errors with conversation identifiers
    // Requirement 7.5: Add context to all error messages
    if (batchResult.invalidConversations.length > 0) {
      this.config.logger.warn('Validation errors found', {
        provider,
        invalidCount: batchResult.invalidConversations.length,
        validCount: batchResult.validConversations.length,
        totalCount: conversations.length,
      });

      // Log details for each invalid conversation
      for (const { conversation, errors } of batchResult.invalidConversations) {
        this.config.logger.debug('Invalid conversation details', {
          provider,
          conversationId: conversation.id,
          externalId: conversation.external_id,
          title: conversation.title,
          messageCount: conversation.messages?.length || 0,
          errorCount: errors.length,
          errors: errors.map((e) => ({
            field: e.field,
            message: e.message,
            conversationId: e.conversationId,
            messageId: e.messageId,
          })),
        });
      }
    } else {
      this.config.logger.info('All conversations validated successfully', {
        provider,
        count: conversations.length,
      });
    }

    // Handle based on options
    if (options.strict && batchResult.invalidConversations.length > 0) {
      // Strict mode: fail on first validation error
      const allErrors = batchResult.invalidConversations.flatMap(
        (item) => item.errors
      );
      return err({
        type: 'validation_error',
        errors: allErrors,
      });
    }

    if (options.skipInvalid) {
      // Skip invalid mode: return only valid conversations
      // Requirement 5.7: Handle skipInvalid option for partial failure scenarios
      if (batchResult.validConversations.length === 0) {
        // All conversations are invalid
        const allErrors = batchResult.invalidConversations.flatMap(
          (item) => item.errors
        );
        return err({
          type: 'validation_error',
          errors: allErrors,
        });
      }

      this.config.logger.info('Returning valid conversations', {
        validCount: batchResult.validConversations.length,
        skippedCount: batchResult.invalidConversations.length,
      });

      return ok(batchResult.validConversations);
    }

    // Default: fail if any validation errors
    if (batchResult.invalidConversations.length > 0) {
      const allErrors = batchResult.invalidConversations.flatMap(
        (item) => item.errors
      );
      return err({
        type: 'validation_error',
        errors: allErrors,
      });
    }

    return ok(batchResult.validConversations);
  }
}

// Export all types and classes
export * from './types.js';
export * from './errors.js';
export * from './parsers/base.js';
export * from './registry.js';
export * from './validator.js';
export * from './streaming.js';
