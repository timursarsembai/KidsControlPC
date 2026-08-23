// One error shape for the whole API: { error: { code, message } }.
//
// The panel and the agent both branch on `code`, never on the message text —
// messages are for humans and get translated; codes are the contract.

export class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

export const badRequest = (code, message) => new ApiError(400, code, message)
export const unauthorized = (code, message) => new ApiError(401, code, message)
export const forbidden = (code, message) => new ApiError(403, code, message)
export const notFound = (code, message) => new ApiError(404, code, message)
export const conflict = (code, message) => new ApiError(409, code, message)

// Fastify's default handler leaks validation internals and stack traces. This
// one keeps unexpected failures opaque to the caller while still logging them.
export function errorHandler(error, request, reply) {
  if (error instanceof ApiError) {
    return reply.code(error.statusCode).send({
      error: { code: error.code, message: error.message }
    })
  }

  if (error.validation) {
    return reply.code(400).send({
      error: { code: 'invalid_request', message: error.message }
    })
  }

  // The rate limiter raises an error rather than sending a body, so its
  // response is shaped here. Retry-After is already on the reply; repeating
  // the wait in the message saves the panel from parsing the header.
  if (error.statusCode === 429) {
    const retryAfter = Number(reply.getHeader('retry-after')) || null
    return reply.code(429).send({
      error: {
        code: 'too_many_requests',
        message: retryAfter
          ? `Слишком много запросов. Попробуйте через ${retryAfter} с.`
          : 'Слишком много запросов. Попробуйте позже.'
      }
    })
  }

  // Other plugins raise plain 4xx errors.
  if (error.statusCode && error.statusCode < 500) {
    return reply.code(error.statusCode).send({
      error: { code: error.code || 'request_rejected', message: error.message }
    })
  }

  request.log.error(error)
  return reply.code(500).send({
    error: { code: 'internal_error', message: 'Internal error' }
  })
}
