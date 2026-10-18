// Requests never import a browser snapshot. Server versions and account context
// prevent stale tabs or an account switch from overwriting another cart.
export class CartClient {
  /** @param {{fetcher?: typeof fetch, onChange?: (state: any) => void}} options */
  constructor({ fetcher = fetch, onChange = () => {} } = {}) {
    this.fetcher = fetcher; this.onChange = onChange; this.epoch = 0;
    this.state = { mode: 'loading', cart: {}, lines: [], version: 0, context: '',
      guest: null, available: [], busy: false, error: '' };
  }
  emit(change) { this.state = { ...this.state, ...change }; this.onChange(this.state); }
  async request(path, method = 'GET', body, context = '') {
    const r = await this.fetcher(path, { method, cache: 'no-store', credentials: 'same-origin',
      signal: AbortSignal.timeout(10000), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(context ? { 'X-Ryde-Cart-Context': context } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await r.json();
    if (!r.ok) throw Object.assign(new Error(data.error || 'Cart request failed.'), { status: r.status });
    return data;
  }
  accept(cart) {
    return { cart: Object.fromEntries(cart.items.map(i => [i.sku, i.quantity])), lines: cart.items, version: cart.version };
  }
  async load() {
    const epoch = ++this.epoch;
    this.emit({ mode: 'loading', busy: true, cart: {}, lines: [], guest: null, context: '', error: '' });
    try {
      const catalog = await this.request('/api/commerce/catalog');
      if (epoch !== this.epoch) return;
      if (catalog.mode === 'demo') { this.emit({ mode: 'demo', busy: false, available: [] }); return; }
      if (catalog.mode !== 'server' || !Array.isArray(catalog.items)) throw new Error('Cart configuration unavailable.');
      let account = null;
      try { account = (await this.request('/api/v1/auth/session')).account; } catch (e) { if (e.status !== 401) throw e; }
      if (epoch !== this.epoch) return;
      let guest = null;
      try { guest = (await this.request('/api/guest/cart')).cart; } catch (e) { if (e.status !== 401) throw e; }
      if (epoch !== this.epoch) return;
      if (account?.verified) {
        const result = await this.request('/api/cart');
        if (epoch !== this.epoch) return;
        this.emit({ ...this.accept(result.cart), context: result.context, mode: 'account', guest,
          available: catalog.items, busy: false });
      } else {
        if (!guest) guest = (await this.request('/api/guest/cart', 'POST', {})).cart;
        if (epoch !== this.epoch) return;
        this.emit({ ...this.accept(guest), mode: 'guest', available: catalog.items, busy: false });
      }
    } catch (error) {
      if (epoch === this.epoch) this.emit({ mode: 'unavailable', busy: false, cart: {}, lines: [], error: error.message });
    }
  }
  async replace(cart) {
    if (this.state.busy || !['account','guest'].includes(this.state.mode)) throw new Error('Wait for your cart to finish loading.');
    const epoch = this.epoch, mode = this.state.mode;
    this.emit({ busy: true, error: '' });
    try {
      const result = await this.request(mode === 'account' ? '/api/cart' : '/api/guest/cart', 'PUT', {
        expectedVersion: this.state.version, items: Object.entries(cart).map(([sku, quantity]) => ({ sku, quantity })),
      }, this.state.context);
      if (epoch !== this.epoch) return false;
      this.emit({ ...this.accept(result.cart), busy: false });
      return true;
    } catch (error) {
      if (epoch === this.epoch) {
        if ([401,403,409].includes(error.status)) await this.load();
        this.emit({ busy: false, error: error.message });
      }
      throw error;
    }
  }
  async merge(mode) {
    if (this.state.busy || this.state.mode !== 'account' || !this.state.guest) throw new Error('Reload before merging carts.');
    const epoch = this.epoch;
    this.emit({ busy: true, error: '' });
    try {
      const result = await this.request('/api/cart/merge', 'POST', { expectedVersion: this.state.version,
        guestVersion: this.state.guest.version, mode }, this.state.context);
      if (epoch !== this.epoch) return;
      this.emit({ ...this.accept(result.cart), guest: null, busy: false });
    } catch (error) {
      if (epoch === this.epoch) { await this.load(); this.emit({ busy: false, error: error.message }); }
      throw error;
    }
  }
  dispose() { this.epoch++; this.onChange = () => {}; }
}
