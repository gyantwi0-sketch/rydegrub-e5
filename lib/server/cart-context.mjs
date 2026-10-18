import { createHash } from 'node:crypto';
export const cartContext = owner => createHash('sha256').update(`cart-context:${owner}`).digest('hex');
