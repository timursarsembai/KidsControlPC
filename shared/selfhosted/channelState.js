// Turns the stream of snapshot and patch frames back into the thing callers
// actually want: the current contents of a channel, as an array.
//
// This is what makes subscribeToRules(uid, deviceId, cb) keep its old shape —
// onSnapshot handed over the whole collection on every change, and every
// caller was written against that. Kept free of sockets so it can be tested
// directly.

export function emptyState() {
  return { items: new Map(), ready: false }
}

/**
 * Applies one server frame. Returns true when the caller should be notified.
 *
 * Frames for other channels are the caller's problem to filter; this function
 * assumes it is given frames for its own channel.
 */
export function applyFrame(state, frame) {
  if (!frame || typeof frame !== 'object') return false

  if (frame.t === 'snap') {
    state.items = new Map()
    for (const item of frame.data ?? []) {
      if (item?.id) state.items.set(item.id, item)
    }
    state.ready = true
    return true
  }

  if (frame.t === 'patch') {
    // A patch arriving before the first snapshot would produce a collection
    // built out of one row — a caller rendering that would show a single
    // device where there are four. The snapshot is coming; drop this.
    if (!state.ready) return false

    if (frame.op === 'remove') {
      if (!frame.data?.id) return false
      return state.items.delete(frame.data.id)
    }
    if (frame.op === 'upsert') {
      if (!frame.data?.id) return false
      state.items.set(frame.data.id, frame.data)
      return true
    }
    return false
  }

  return false
}

// Array, not the Map: callers iterate and render, and several of them sort the
// result themselves.
export function toArray(state) {
  return [...state.items.values()]
}
