import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hub, channelFor } from './hub.js'

function subscriber(name = 's') {
  const received = []
  return { name, received, send: (message, channel) => received.push({ message, channel }) }
}

test('delivers only to subscribers of that channel', () => {
  const hub = new Hub()
  const a = subscriber('a')
  const b = subscriber('b')
  hub.add(a); hub.add(b)
  hub.subscribe(a, 'rules:1')
  hub.subscribe(b, 'rules:2')

  hub.broadcast('rules:1', { t: 'patch' })

  assert.equal(a.received.length, 1)
  assert.equal(b.received.length, 0)
})

// The subscriber names its channels the way it asked for them; the hub keys
// them internally. Broadcast has to pass the internal name along so the
// socket can translate it back.
test('passes the channel alongside the message', () => {
  const hub = new Hub()
  const a = subscriber()
  hub.add(a)
  hub.subscribe(a, 'rules:1')

  hub.broadcast('rules:1', { t: 'patch', op: 'upsert' })

  assert.deepEqual(a.received[0], {
    message: { t: 'patch', op: 'upsert' },
    channel: 'rules:1'
  })
})

test('a subscriber that throws does not block the others', () => {
  const hub = new Hub()
  const broken = { send: () => { throw new Error('socket closed') } }
  const fine = subscriber()
  hub.add(broken); hub.add(fine)
  hub.subscribe(broken, 'devices:1')
  hub.subscribe(fine, 'devices:1')

  const delivered = hub.broadcast('devices:1', { t: 'patch' })

  assert.equal(delivered, 1)
  assert.equal(fine.received.length, 1)
})

test('removing a subscriber clears every channel it held', () => {
  const hub = new Hub()
  const a = subscriber()
  hub.add(a)
  hub.subscribe(a, 'rules:1')
  hub.subscribe(a, 'devices:1')

  hub.remove(a)

  assert.equal(hub.size, 0)
  assert.equal(hub.hasSubscribers('rules:1'), false)
  assert.equal(hub.hasSubscribers('devices:1'), false)
})

// An empty Set left behind would make hasSubscribers answer yes, and the
// dispatcher would read the row from the database for nobody — on every
// heartbeat, for every device whose panel was once open.
test('an emptied channel disappears rather than lingering', () => {
  const hub = new Hub()
  const a = subscriber()
  hub.add(a)
  hub.subscribe(a, 'devices:1')
  assert.equal(hub.hasSubscribers('devices:1'), true)

  hub.unsubscribe(a, 'devices:1')

  assert.equal(hub.hasSubscribers('devices:1'), false)
  assert.equal(hub.channels.size, 0)
})

test('an unknown subscriber cannot subscribe', () => {
  const hub = new Hub()
  const stranger = subscriber()

  assert.equal(hub.subscribe(stranger, 'devices:1'), false)
  assert.equal(hub.hasSubscribers('devices:1'), false)
})

test('broadcasting to a channel nobody watches costs nothing', () => {
  const hub = new Hub()
  assert.equal(hub.broadcast('rules:nobody', { t: 'patch' }), 0)
})

test('channel names are built from ids, not from request text', () => {
  assert.equal(channelFor.devices('u1'), 'devices:u1')
  assert.equal(channelFor.device('d1'), 'device:d1')
  assert.equal(channelFor.rules('d1'), 'rules:d1')
})
