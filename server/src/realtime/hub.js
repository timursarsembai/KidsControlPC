// Who is subscribed to what. Deliberately knows nothing about sockets,
// Postgres or Fastify — it is a registry of channel names and send functions,
// which is what makes it testable without a server.

export class Hub {
  constructor() {
    this.channels = new Map()      // channel -> Set<subscriber>
    this.subscribers = new Set()
  }

  add(subscriber) {
    subscriber.channels = new Set()
    this.subscribers.add(subscriber)
  }

  remove(subscriber) {
    for (const channel of subscriber.channels ?? []) {
      const set = this.channels.get(channel)
      if (!set) continue
      set.delete(subscriber)
      // An empty Set left behind would make hasSubscribers() answer yes for a
      // channel nobody is on, and every change on it would then be read from
      // the database for nobody.
      if (set.size === 0) this.channels.delete(channel)
    }
    subscriber.channels = new Set()
    this.subscribers.delete(subscriber)
  }

  subscribe(subscriber, channel) {
    if (!this.subscribers.has(subscriber)) return false
    if (!this.channels.has(channel)) this.channels.set(channel, new Set())
    this.channels.get(channel).add(subscriber)
    subscriber.channels.add(channel)
    return true
  }

  unsubscribe(subscriber, channel) {
    subscriber.channels?.delete(channel)
    const set = this.channels.get(channel)
    if (!set) return
    set.delete(subscriber)
    if (set.size === 0) this.channels.delete(channel)
  }

  hasSubscribers(channel) {
    return this.channels.has(channel)
  }

  /**
   * Returns how many subscribers the message reached.
   *
   * `message` is an object, not a string, and the channel is passed alongside
   * it: a subscriber names its channels the way it asked for them ('rules'),
   * while the hub keys them internally ('rules:<uuid>'). Serialising once here
   * would send the internal name, which is not what the client subscribed to
   * and cannot be matched against its snapshot.
   *
   * A send that throws — a socket closed half a millisecond ago — must not
   * stop delivery to the rest.
   */
  broadcast(channel, message) {
    const set = this.channels.get(channel)
    if (!set) return 0

    let delivered = 0
    for (const subscriber of set) {
      try {
        subscriber.send(message, channel)
        delivered++
      } catch {
        // The socket's own close handler will remove it; nothing to do here.
      }
    }
    return delivered
  }

  get size() {
    return this.subscribers.size
  }
}

// Channel naming. Parents ask for 'devices' and get their own account's
// channel — the owner id is taken from the token, never from the request, so
// no subscription can be widened by asking nicely.
export const channelFor = {
  devices: (ownerId) => `devices:${ownerId}`,
  device: (deviceId) => `device:${deviceId}`,
  rules: (deviceId) => `rules:${deviceId}`,
  alerts: (ownerId) => `alerts:${ownerId}`,
  commands: (deviceId) => `commands:${deviceId}`,
  apps: (deviceId) => `apps:${deviceId}`
}
