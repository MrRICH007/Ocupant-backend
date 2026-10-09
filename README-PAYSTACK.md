# Ocupant — Paystack payment migration

This release uses the existing PostgreSQL database and changes new Premium checkouts from Flutterwave to Paystack. It does not delete users, listings, existing payment rows, or edit existing `users.premium_until` values during startup.

## What changed

- Frontend Premium checkout calls `POST /api/payments/paystack/initialize` and redirects to Paystack Checkout.
- Backend initializes each payment using `PAYSTACK_SECRET_KEY`; the secret is never sent to the browser.
- Premium is granted only after server-side Paystack verification confirms `success`, the exact expected amount in kobo, currency, and reference.
- Signed `charge.success` webhooks are validated against the raw request body using HMAC-SHA512 and timing-safe comparison.
- Callback/webhook duplicate delivery is idempotent: a payment can grant Premium only once. A new paid 30-day period extends from a future existing expiry date, otherwise from now.
- `payments` gets additive `provider` and `paystack_transaction_id` columns. Existing rows are retained and their provider defaults to `flutterwave`.
- The old direct `/api/subscription/upgrade` endpoint no longer grants Premium without payment.

## Render environment variables

Keep existing values for the database and authentication:

- `DATABASE_URL` — existing Render PostgreSQL connection string.
- `JWT_SECRET` — existing production JWT secret; do not rotate during this migration unless planned.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` — keep the currently intended admin credentials.
- `FRONTEND_URL` — the full origin of the deployed frontend, e.g. `https://your-frontend-host.example`; no trailing slash and no `/api` path.
- `BACKEND_URL` — `https://ocupant-backend.onrender.com` (no trailing slash).
- `PAYSTACK_SECRET_KEY` — Paystack **test** secret key while testing, then replace it with the **live** secret key only when ready for live payments. Store this only in Render backend environment variables.
- `PREMIUM_PRICE` — `10000` (price in naira, not kobo).
- `PAYMENT_CURRENCY` — `NGN`.

Optional existing settings may remain: `PG_POOL_MAX=5`, `PGSSL_DISABLE=false`. Do not set `DB_FILE`.

`PAYSTACK_PUBLIC_KEY` is not required by this release because the browser is redirected to the authorization URL returned by the backend. Never put `PAYSTACK_SECRET_KEY` in frontend HTML or JavaScript.

## Paystack dashboard setup

1. Sign in to the Paystack Dashboard and select **Test Mode** first.
2. In the developer/webhook settings, set the webhook URL to:
   `https://ocupant-backend.onrender.com/api/payments/paystack/webhook`
3. Ensure the `charge.success` transaction event is enabled if the dashboard presents event selection.
4. Save the webhook URL in the appropriate mode. Configure it again in **Live Mode** when ready to go live; test and live settings/keys are separate.
5. Use the matching test secret key in Render to test. For live service, use the live secret key and live webhook configuration.

The checkout callback URL is sent by the backend at initialization as:
`https://ocupant-backend.onrender.com/api/payments/paystack/callback`

## Deployment sequence

1. Deploy the backend files from this release to the existing Render web service, preserving `DATABASE_URL` and all current database data.
2. Set the Render environment variables above, initially with Paystack test secret key.
3. Deploy the updated `frontend/index.html` to the current frontend host.
4. Test checkout with Paystack test mode, including a successful payment, cancellation/failure, callback return, and webhook delivery. Confirm Premium activates only once and an existing valid Premium expiry extends from its current expiry.
5. When ready to accept real payments, change `PAYSTACK_SECRET_KEY` to the live secret key and confirm the live webhook URL in the live dashboard.
6. After confirming no old frontend/backend deployment is still using Flutterwave, remove `FLUTTERWAVE_SECRET_KEY` and `FLUTTERWAVE_WEBHOOK_HASH` from Render. Existing Flutterwave payment rows remain in PostgreSQL for history.

## Verification limits

This source bundle can be syntax-checked locally, but a real transaction and webhook cannot be proven without access to your Paystack test credentials, deployed Render service, and dashboard. Do not treat deployment or code checks as proof of live payment success.


## Reconciling older pending Paystack payments

This release adds an admin-only endpoint: `POST /api/payments/paystack/reconcile/:reference`. Call it with the normal authenticated admin session/token and the exact Paystack reference. It verifies the transaction with Paystack and credits Premium only when the reference, successful status, NGN currency, and amount (at least the configured price) match. This allows older records where the customer-paid checkout fee made the captured amount higher than the listed Premium price. Underpayments are not credited. Repeating reconciliation is idempotent. Do not expose this endpoint publicly or manually edit payment statuses.

Example path (replace the reference): `/api/payments/paystack/reconcile/OCUPANT-...`
