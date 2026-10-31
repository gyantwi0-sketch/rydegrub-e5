# RydeGrub: Firebase to Supabase Auth cutover

Status: **migration PR only**. Do not merge/deploy this branch until an existing Supabase project is configured and manual browser tests succeed. This is not an automatic user migration.

## What the app changes

- Browser sign-in and sign-up use Supabase Auth via @supabase/supabase-js; Google OAuth is a full-page redirect (not a popup).
- Login UI and profile show "Signed in"/"Verified email", not Firebase-branded labels.
- Password reset goes through Supabase Auth with a browser recovery link.
- When Supabase environment variables are missing, sign-in/signup controls are disabled; the guest demo remains accessible.
- A Firebase account is **not** a Supabase account. Existing Firebase passwords/UIDs/sessions are not imported. Users will have to create a new account or be migrated through a separately reviewed admin process.

## Connect the correct Supabase project

1. In an **existing** Supabase project, go to Project Settings → API / Connect and copy the Project URL (HTTPS origin) and publishable key (or legacy anon key). Never use the service_role or secret key in a NEXT_PUBLIC variable.
2. On Vercel, create:
   - `NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` (preferred)
   The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported as a fallback.
   Scope to Production and intended Preview environments; redeploy after setting variables. Do not delete old Firebase values until this cutover is verified.
3. In Supabase → Authentication → URL Configuration, set **Site URL** to `https://rydegrub-three.vercel.app`. Add `https://rydegrub-three.vercel.app/**` and the specific preview URL(s) to Redirect URLs.
4. In Supabase → Authentication → Providers, enable **Email** and **Google**. Google requires an OAuth client ID and secret issued through Google Cloud Console and a Supabase callback URI `https://<project-ref>.supabase.co/auth/v1/callback` registered in Google's OAuth client's Authorized Redirect URIs. Do not substitute the Vercel site domain for the Supabase callback URI.
5. Test signup → confirmation email → sign-in, Google redirect login, refresh persistence, logout, recovery email, and reset password, on Production with a test account. Check any extra email rate limits and SMTP delivery requirements.
6. Merge only after CI passes and real provider validation is complete. After the production cutover and user migration plan, the obsolete Vercel `NEXT_PUBLIC_FIREBASE_*` settings can be removed.

## Security and backend integration

- The published Supabase key is client-safe **only with** server-side permissions / RLS correctly enforced. Never put a service role or secret in browser JS.
- Supabase Auth authenticates the *browser*. The pre-existing server-owned native /api/v1/auth and commerce endpoints currently use a **different** session identity. A Supabase browser JWT does **not** implicitly authorize those endpoints. A future backend integration must validate access tokens server-side, map their subject IDs to account records securely, and decide migration of existing account/cart/order ownership.
- Demo orders and payment/PNR integrations remain demo/unavailable. A signed-in browser profile is not proof of operational checkout.
- The package's old Firebase code and client dependency are removed by this PR; the private Supabase project and Google client secrets are managed only in Supabase/Vercel consoles.
