# Ocupant PostgreSQL backend

This backend uses the existing PostgreSQL database. It does not use SQLite or a Render-local database file.

Required Render environment variables:
- `DATABASE_URL` — PostgreSQL connection string.
- `JWT_SECRET` — long, private production signing secret.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` — intended admin account credentials.
- `FRONTEND_URL` — deployed frontend origin, without a trailing slash.
- `BACKEND_URL=https://ocupant-backend.onrender.com` — public backend origin, without a trailing slash.
- `PAYSTACK_SECRET_KEY` — Paystack test or live secret key (backend only).
- `PREMIUM_PRICE=10000` — Premium price in naira.
- `PAYMENT_CURRENCY=NGN`.

Optional: `PG_POOL_MAX=5`, `PGSSL_DISABLE=false`.

See `README-PAYSTACK.md` for the payment migration, webhook configuration, deployment order, and testing steps. Existing PostgreSQL user/property/payment rows and Premium expiry dates are preserved by the migration.
