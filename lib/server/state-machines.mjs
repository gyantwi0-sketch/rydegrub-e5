// Finite-state business rules. Call only from trusted server adapters after
// verifying the account, payment provider signature and fulfilment authority.
export class TransitionError extends Error {
  constructor(message = 'Invalid state transition.') { super(message); this.status = 409; }
}
const order = Object.freeze({
  draft: { pending_payment: ['checkout'], cancelled: ['account', 'operations'] },
  pending_payment: { confirmed: ['gateway'], cancelled: ['account', 'operations'] },
  confirmed: { delivered: ['fulfilment'], cancelled: ['operations'] },
  delivered: {},
  cancelled: {},
});
const payment = Object.freeze({
  created: { authorized: ['gateway'], failed: ['gateway'] },
  authorized: { captured: ['gateway'], failed: ['gateway'] },
  captured: { refunded: ['gateway'] },
  failed: {},
  refunded: {},
});
const fulfilment = Object.freeze({
  confirmed: 0, preparing: 1, packed: 2, arriving: 3,
  delivered: 4, cancelled: 5,
});
const check = (state, states, version, updatedAt, now) => {
  if (typeof state !== 'string' || !Object.hasOwn(states, state) ||
      !Number.isSafeInteger(version) || version < 1 ||
      !Number.isSafeInteger(updatedAt) || updatedAt < 0 ||
      !Number.isSafeInteger(now) || now < updatedAt) throw new TransitionError();
};
const next = (record, state, at) => ({
  state, version: record.version + 1, updatedAt: at,
});

export function transitionOrder(record, target, actor, context, now = Date.now()) {
  check(record?.state, order, record?.version, record?.updatedAt, now);
  if (!order[record.state][target]?.includes(actor)) throw new TransitionError();
  const paid = context?.paymentState;
  if (target === 'confirmed' && paid !== 'captured') throw new TransitionError();
  if (target === 'delivered' && context?.fulfilmentState !== 'delivered') throw new TransitionError();
  if (target === 'cancelled') {
    if (record.state === 'confirmed' && paid !== 'refunded') throw new TransitionError();
    if (record.state === 'pending_payment' && !['created', 'failed'].includes(paid))
      throw new TransitionError();
  }
  return next(record, target, now);
}
export function transitionPayment(record, target, actor, now = Date.now()) {
  check(record?.state, payment, record?.version, record?.updatedAt, now);
  if (!payment[record.state][target]?.includes(actor)) throw new TransitionError();
  return next(record, target, now);
}
export function transitionFulfilment(record, target, actor, context, now = Date.now()) {
  check(record?.state, fulfilment, record?.version, record?.updatedAt, now);
  if (actor !== 'fulfilment' || !Object.hasOwn(fulfilment, target) ||
      ['delivered', 'cancelled'].includes(record.state)) throw new TransitionError();
  if (target === 'cancelled') {
    if (context?.orderState !== 'cancelled') throw new TransitionError();
  } else if (fulfilment[target] <= fulfilment[record.state] ||
      context?.orderState !== 'confirmed' || context?.paymentState !== 'captured')
    throw new TransitionError();
  return next(record, target, now);
}
export const ORDER_STATES = Object.freeze(Object.keys(order));
export const PAYMENT_STATES = Object.freeze(Object.keys(payment));
export const FULFILMENT_STATES = Object.freeze(Object.keys(fulfilment));
