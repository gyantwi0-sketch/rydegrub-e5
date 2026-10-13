import { AccessError, identityKey } from './scoped-auth.mjs';

function fields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== allowed.length || Object.keys(input).some(key => !allowed.includes(key)))
    throw new AccessError(400, 'Invalid administrative request.');
}
// Local/trusted integration only. There is deliberately no web route to these operations.
export function applyTrackingEvent(store, issuer, operation, input) {
  switch (operation) {
    case 'create': {
      fields(input, ['subject', 'snapshot']);
      const row = store.create(identityKey(issuer, input.subject), input.snapshot);
      return { id: row.id, version: row.version };
    }
    case 'update': {
      fields(input, ['id', 'expectedVersion', 'snapshot']);
      const row = store.update(input.id, input.expectedVersion, input.snapshot);
      return { id: row.id, version: row.version };
    }
    case 'revoke-order':
      fields(input, ['id']); store.revokeOrder(input.id); return { revoked: true };
    case 'purge-account':
      fields(input, ['subject']);
      return { removed: store.purgeOwner(identityKey(issuer, input.subject)) };
    case 'cleanup':
      fields(input, []); return { removed: store.cleanup() };
    default: throw new AccessError(400, 'Unknown administrative operation.');
  }
}
