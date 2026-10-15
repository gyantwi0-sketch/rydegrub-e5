// Bounded, aggregate metrics only. No URLs, identities, request IDs or user input.
const OPERATIONS = {
  account: ['register','signin','session','logout','requestVerification','requestReset','verify','reset'],
  media: ['current','upload','read','remove'],
  profile: ['read','update','changeConsent','history','startPhone','confirmPhone','personalization','savePersonalization','resetPersonalization','recommendations'],
  tracking: ['list','read','readWithCode','issueCode','revokeCode'],
  catalog: ['list','search','create','update','remove'],
};
const BOUNDS = [0.005, 0.025, 0.1, 0.5, 1, 3, 10, 30];
const tags = values => Object.entries(values).map(([k,v]) => `${k}="${v}"`).join(',');
export class Metrics {
  constructor() { this.requests = new Map(); this.providers = new Map(); this.limits = new Map(); this.payments = new Map(); this.queues = new Map(); this.ready = 0; }
  request(service, operation, status, ms) {
    if (!OPERATIONS[service]?.includes(operation) || !Number.isInteger(status) || status < 100 || status > 599 || !Number.isFinite(ms) || ms < 0) return;
    const labels = { service, operation, status: `${Math.floor(status / 100)}xx` }, key = tags(labels);
    const row = this.requests.get(key) ?? { count: 0, sum: 0, buckets: BOUNDS.map(() => 0) };
    const seconds = Math.min(ms / 1000, 3600);
    row.count++; row.sum += seconds; BOUNDS.forEach((b,i) => { if (seconds <= b) row.buckets[i]++; });
    this.requests.set(key, row);
  }
  provider(provider, method, outcome, ms) {
    if (!['sms','pnr','payment','email','password-screening'].includes(provider) || !['GET','HEAD','POST'].includes(method) ||
      !['ok','circuit_open','unavailable'].includes(outcome) || !Number.isFinite(ms) || ms < 0) return;
    const key = tags({ provider, method, outcome }), row = this.providers.get(key) ?? { count: 0, sum: 0 };
    row.count++; row.sum += Math.min(ms / 1000, 600); this.providers.set(key, row);
  }
  limit(outcome) { if (['allowed','limited','unavailable'].includes(outcome)) this.limits.set(outcome, (this.limits.get(outcome) ?? 0) + 1); }
  payment(state) { if (['created','authorized','captured','failed','refunded'].includes(state)) this.payments.set(state, (this.payments.get(state) ?? 0) + 1); }
  queue(name, depth, oldestAgeSeconds) {
    if (!['notifications','fulfilment'].includes(name) || !Number.isSafeInteger(depth) || depth < 0 || !Number.isFinite(oldestAgeSeconds) || oldestAgeSeconds < 0) return;
    this.queues.set(name, { depth, oldestAgeSeconds });
  }
  render() {
    const out = ['# HELP ryde_http_requests_total Completed API requests.', '# TYPE ryde_http_requests_total counter'];
    for (const [key,row] of this.requests) out.push(`ryde_http_requests_total{${key}} ${row.count}`);
    out.push('# HELP ryde_http_duration_seconds API response latency.', '# TYPE ryde_http_duration_seconds histogram');
    for (const [key,row] of this.requests) {
      BOUNDS.forEach((b,i) => { out.push(`ryde_http_duration_seconds_bucket{${key},le="${b}"} ${row.buckets[i]}`); });
      out.push(`ryde_http_duration_seconds_bucket{${key},le="+Inf"} ${row.count}`, `ryde_http_duration_seconds_sum{${key}} ${row.sum}`, `ryde_http_duration_seconds_count{${key}} ${row.count}`);
    }
    out.push('# HELP ryde_provider_requests_total Provider requests by safe outcome.', '# TYPE ryde_provider_requests_total counter');
    for (const [key,row] of this.providers) out.push(`ryde_provider_requests_total{${key}} ${row.count}`);
    out.push('# HELP ryde_provider_duration_seconds_total Cumulative provider latency.', '# TYPE ryde_provider_duration_seconds_total counter');
    for (const [key,row] of this.providers) out.push(`ryde_provider_duration_seconds_total{${key}} ${row.sum}`);
    out.push('# HELP ryde_rate_limit_total Limiter decisions.', '# TYPE ryde_rate_limit_total counter');
    for (const [outcome,count] of this.limits) out.push(`ryde_rate_limit_total{outcome="${outcome}"} ${count}`);
    out.push('# HELP ryde_payment_transitions_total Committed payment state transitions.', '# TYPE ryde_payment_transitions_total counter');
    for (const [state,count] of this.payments) out.push(`ryde_payment_transitions_total{state="${state}"} ${count}`);
    out.push('# HELP ryde_queue_depth Pending jobs reported by an active worker.', '# TYPE ryde_queue_depth gauge');
    for (const [name,row] of this.queues) out.push(`ryde_queue_depth{queue="${name}"} ${row.depth}`);
    out.push('# HELP ryde_queue_oldest_seconds Age of oldest pending job.', '# TYPE ryde_queue_oldest_seconds gauge');
    for (const [name,row] of this.queues) out.push(`ryde_queue_oldest_seconds{queue="${name}"} ${row.oldestAgeSeconds}`);
    out.push('# HELP ryde_ready Last dependency readiness result.', '# TYPE ryde_ready gauge', `ryde_ready ${this.ready}`);
    return out.join('\n') + '\n';
  }
}
const key = Symbol.for('rydegrub.metrics');
globalThis[key] ??= new Metrics();
export const metrics = globalThis[key];
