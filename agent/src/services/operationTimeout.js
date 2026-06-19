export function withOperationTimeout(promise, timeoutMs, message, code = 'operation_timeout') {
  let timeoutId = null

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(message)
      err.code = code
      reject(err)
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise])
    .finally(() => {
      if (timeoutId) clearTimeout(timeoutId)
    })
}
