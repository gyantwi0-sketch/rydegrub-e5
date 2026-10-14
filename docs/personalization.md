# Consented meal suggestions (#50)

The home page uses server-side, explainable preference matching. It does not claim AI inference, learn browsing behaviour, or use PNRs, contact details, order history or inferred health traits. There is no external model/provider request and no recommendation history table. Current catalog metadata remains the application's sample menu; catalog publication, real stock and food-label verification remain separate work. Suggestions never authorize checkout or guarantee availability or allergy safety.

## Account choice

Personalization defaults off. In Profile, a verified account may explicitly opt in and select Vegetarian, High-protein and/or Mild spice. Saving changes only those preferences and the personalization consent; name, phone and marketing choice are preserved. Turning off or resetting clears saved preferences and revokes consent atomically. Consent evidence and generic security audit events are retained under the existing audit policy; their payloads do not include food preferences. Legacy browser preferences are ignored and removed from the next browser snapshot, not silently imported as consent.

Each recommendation request takes a server database snapshot of the account's current consent. Without consent it does not read the preference column. With selected preferences, every selected tag must match; no match returns an empty result instead of relaxing dietary choices. Toddler-food products and explicitly inactive products are excluded. Each returned ID includes an explanation. This is simple rule-based matching, not a dietary recommendation or an allergy filter.

## Routes and controls

All routes reuse the verified profile identity guard, private/no-store responses, same-origin mutation checks, strict bounded JSON, shared Redis rate limits and privacy-safe metrics. No owner ID, consent override, profile text or catalog is accepted from a request. Query parameters are rejected.

- GET `/api/profile/personalization`: `{settings:{granted,preferences}}`.
- PATCH same path: exactly `{granted:boolean,preferences:string[]}`. No duplicate/unknown preferences. An off choice requires an empty array.
- DELETE same path: exactly `{}`. Clears preferences and opts out atomically.
- GET `/api/profile/recommendations`: `{mode,explanation,items:[{id,reasons}]}`, at most three items.

Missing authentication, unverified accounts or unavailable dependencies never cause personalized output. The UI falls back to general sample-menu suggestions. It clears personalized results and re-fetches on focus, visibility return, page restoration and settings changes, and cancels obsolete requests. Account settings never live in browser storage. A request already in flight may finish using the consent snapshot taken at its start; subsequent requests use the revoked state. Users can always browse the entire menu themselves.

## Verification

Tests cover unauthorized reads, query spoofing, cross-account isolation, consent default/off/on/revocation, unchanged contact/marketing settings, strict fields, reset, audit-trigger rollback and no relaxation of selected preferences. Configuration is the existing profile/account configuration plus production shared-rate-limit configuration; no new provider credentials are required.
