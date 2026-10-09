# Ocupant PostgreSQL backend

This version replaces the Render-local SQLite database with PostgreSQL. The Render web service can remain on the Free plan because the database is external to the service filesystem.

## Required Render environment variables

DATABASE_URL=postgresql://...
JWT_SECRET=...
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
FLUTTERWAVE_SECRET_KEY=...
FLUTTERWAVE_WEBHOOK_HASH=...
FRONTEND_URL=https://...
BACKEND_URL=https://ocupant-backend.onrender.com
PREMIUM_PRICE=10000
PAYMENT_CURRENCY=NGN

Optional:
PG_POOL_MAX=5
PGSSL_DISABLE=false

Do not set DB_FILE anymore. This backend does not use SQLite.

## Deploy

1. Replace the backend source with this release.
2. On Render, add DATABASE_URL containing your PostgreSQL connection string.
3. Keep the existing JWT, admin, Flutterwave, frontend and backend variables.
4. Remove DB_FILE and any Persistent Disk configuration if you are not using a disk.
5. Deploy with `npm start`.

On first startup the server creates the PostgreSQL tables and ensures the configured admin account exists.
