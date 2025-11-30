// Error types for better error handling
export class AppError extends Error {
    constructor(
        message: string,
        public code: string,
        public statusCode?: number,
        public retryable: boolean = false
    ) {
        super(message)
        this.name = 'AppError'
    }
}

export class NetworkError extends AppError {
    constructor(message: string = 'Network request failed') {
        super(message, 'NETWORK_ERROR', undefined, true)
        this.name = 'NetworkError'
    }
}

export class AuthError extends AppError {
    constructor(message: string = 'Authentication failed') {
        super(message, 'AUTH_ERROR', 401, false)
        this.name = 'AuthError'
    }
}

export class RateLimitError extends AppError {
    constructor(
        message: string = 'Rate limit exceeded',
        public retryAfter?: number
    ) {
        super(message, 'RATE_LIMIT_ERROR', 429, true)
        this.name = 'RateLimitError'
    }
}

export class ValidationError extends AppError {
    constructor(message: string, public field?: string) {
        super(message, 'VALIDATION_ERROR', 400, false)
        this.name = 'ValidationError'
    }
}

export class NotFoundError extends AppError {
    constructor(message: string = 'Resource not found') {
        super(message, 'NOT_FOUND', 404, false)
        this.name = 'NotFoundError'
    }
}

export class ServerError extends AppError {
    constructor(message: string = 'Internal server error') {
        super(message, 'SERVER_ERROR', 500, true)
        this.name = 'ServerError'
    }
}

// Error parser - converts API errors to typed errors
export function parseError(error: unknown): AppError {
    if (error instanceof AppError) {
        return error
    }

    if (error instanceof Error) {
        // Check for fetch errors
        if (error.message.includes('Failed to fetch')) {
            return new NetworkError()
        }

        // Check for specific error patterns
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            return new AuthError()
        }

        if (error.message.includes('429') || error.message.includes('rate limit')) {
            return new RateLimitError()
        }

        if (error.message.includes('404') || error.message.includes('not found')) {
            return new NotFoundError()
        }

        // Generic server error
        return new ServerError(error.message)
    }

    // Unknown error
    return new ServerError('An unexpected error occurred')
}

// Retry utility with exponential backoff
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: {
        maxRetries?: number
        initialDelay?: number
        maxDelay?: number
        backoffMultiplier?: number
    } = {}
): Promise<T> {
    const {
        maxRetries = 3,
        initialDelay = 1000,
        maxDelay = 10000,
        backoffMultiplier = 2
    } = options

    let lastError: Error
    let delay = initialDelay

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn()
        } catch (error) {
            lastError = error instanceof Error ? error : new Error('Unknown error')

            const appError = parseError(error)

            // Don't retry non-retryable errors
            if (!appError.retryable) {
                throw appError
            }

            // Don't retry if this was the last attempt
            if (attempt === maxRetries) {
                throw appError
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay))

            // Exponential backoff
            delay = Math.min(delay * backoffMultiplier, maxDelay)
        }
    }

    throw lastError!
}
