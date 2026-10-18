# Guest cart and account cart integration (#4, #6)

Domain schema 4 adds guest_carts. Back up domain.sqlite consistently before the
migration; rollback to schema-3 application code needs its matching backup.
Readiness checks schema 4. Existing account, order and catalog rows are preserved.

## Guest API

- POST /api/guest/cart with {} creates a cart if the cookie is absent/expired,
  otherwise returns the existing cart without resetting it or extending expiry.
- GET reads the current guest cart. Missing/expired credentials return 401.
- PUT accepts exactly {expectedVersion,items:[{sku,quantity}]}.
- DELETE with {} discards the guest cart and clears the cookie.

The __Host-ryde-guest cookie is 256 random bits, Secure, HttpOnly, SameSite=Strict,
Path=/, with a 24-hour absolute TTL. Only SHA-256 of the capability is stored;
neither raw capability nor hash enters audit payloads or response JSON. Expired
rows are cleaned during creation. Guests never become verified account records.
All writes require exact Origin and safe Fetch-Metadata, bounded JSON and shared
Redis admission. No raw PNR, passenger contact or client prices are accepted.

PUT rechecks active server products, vendors and stations, with 30-SKU, 99-unit
and ₹20,000 subtotal limits. Stale versions conflict. Unavailable items remain
visible for removal; they cannot be submitted for an order.

## Explicit merge

POST /api/cart/merge requires a verified native session, guest cookie,
X-Ryde-Cart-Context from GET /api/cart, and exactly
{expectedVersion,guestVersion,mode:"combine"|"replace"}.
The UI shows guest quantities/current prices before the user selects a mode.
Both versions and all item limits/prices are revalidated in one SQLite write
transaction. Successful merge consumes the guest capability and clears its
cookie. Any conflict, unavailable item, overflow or audit failure rolls everything
back. Lost responses can be reconciled by GET /api/cart; do not blindly recreate
and merge the old guest snapshot. A consumed cookie cannot merge twice.

## Browser behaviour

The browser never imports old localStorage cart snapshots. Unconfigured preview
carts are memory-only and cannot create server orders. Configured installations
fetch guest/account state and save mutations through their respective APIs.
Session changes and window focus refresh authoritative state; old async responses
are ignored. Login/logout/verification events notify other tabs. An account-bound
context header prevents an old tab with a changed session cookie from writing its
old cart into another account. Conflicts reload instead of silently overwriting.
Network/configuration failures never downgrade a server cart to a local demo.

Live checkout remains blocked until verified journeys, eligible stops, stock,
fees, payments and fulfilment are connected. Cart persistence alone does not
make a payable order. Guest checkout ownership/contact verification is separate
from guest cart persistence.

## Trusted catalog provisioning

POST /api/admin/commerce accepts a server-held CATALOG_ADMIN_TOKEN as Bearer auth.
It never accepts session-cookie authorization or query credentials. Bodies:

- {action:"station",record:{code,name}}
- {action:"vendor",record:{stationCode,name}} returns a vendor UUID
- {action:"product",record:{sku,vendorId,active}}

Product names/prices come from the existing managed catalog on the server (rupees
converted to integer paise). After an admin catalog price update, republish the
operational product mapping; the browser uses the operational price for saved
carts. Deactivate unavailable mappings explicitly. This is trusted provisioning,
not vendor self-service or a claim that food labels were verified.

GET /api/commerce/catalog returns enabled SKU prices/stations and server mode.
Only a completely absent DOMAIN_DATA_DIR yields demo mode. Broken configuration
fails closed. Configure real vendor data and verify restart persistence before
rollout; test data must not be presented as real vendors.
