const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { claimTicket } = require('../decart-proxy');

const ticket = '00000000-0000-4000-8000-000000000000.' + 'a'.repeat(64);
const stamp = ms => ({ toMillis: () => ms });
function fixture(overrides = {}) {
  const data = { transport: 'proxy-v1', status: 'active',
    ticketHash: createHash('sha256').update(ticket).digest('hex'),
    ticketExpiresAt: stamp(Date.now() + 90_000), deadlineAt: stamp(Date.now() + 300_000),
    allowedOrigin: 'https://example.com', providerToken: 'test', reservedSeconds: 300,
    ...overrides };
  let update;
  const db = { collection: () => ({ doc: () => ({}) }),
    runTransaction: fn => fn({ get: async () => ({ data: () => data }),
      update: (_, value) => { update = value; } }) };
  return { db, data, update: () => update };
}

test('reconnect preserves initial claim and original paid deadline', async () => {
  const claimedAt = stamp(Date.now() - 100_000);
  const f = fixture({ claimedAt });
  await claimTicket(f.db, ticket, 'https://example.com');
  assert.equal(f.update().claimedAt, claimedAt);
  assert.equal(f.update().ticketExpiresAt.getTime(), f.data.deadlineAt.toMillis());
});

test('expired or missing deadlines cannot authorize another connection', async () => {
  for (const deadlineAt of [stamp(Date.now() - 1), undefined]) {
    const f = fixture({ deadlineAt });
    await assert.rejects(claimTicket(f.db, ticket, 'https://example.com'), /Ticket unavailable/);
    assert.equal(f.update(), undefined);
  }
});

test('wrong origin and expired ticket are rejected', async () => {
  await assert.rejects(claimTicket(fixture().db, ticket, 'https://other.com'));
  await assert.rejects(claimTicket(fixture({ ticketExpiresAt: stamp(0) }).db, ticket, 'https://example.com'));
});
