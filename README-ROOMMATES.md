# Ocupant Find Roommates upgrade

This backend adds a profile-based roommate discovery and connection workflow to the existing PostgreSQL backend.

## Features
- Premium-only API access enforced server-side.
- Roommate profile with preferred location, budget in naira, accommodation type, move-in date, lifestyle preferences, and short bio.
- Discover other active profiles with location and budget filtering. User email/contact details are not exposed in discovery results.
- Send connection requests; recipients can accept or decline.
- Private text messages are available only after a connection is accepted.
- Existing property-specific roommate interest requests remain supported.

## Deploy
1. Replace the backend source in the existing backend repository with the contents of this backend folder.
2. Keep the current Render environment variables, especially `DATABASE_URL`, `JWT_SECRET`, and payment credentials.
3. Deploy using the existing `npm start` command.
4. On startup, `initDb()` creates the new `roommate_profiles`, `roommate_connections`, and `roommate_messages` tables. No manual SQL migration is needed.
5. Replace the frontend's deployed `index.html` with the supplied updated frontend HTML (renamed to `index.html`).

## How to test
Use two separate Premium user accounts:
1. Sign in with account A and open a property's **Find Roommate** section.
2. Complete and save A's profile, then repeat with account B in the same or a similar location.
3. From A, open **Discover people** and send a connection request to B.
4. From B, open **Requests & connections**, then accept the request.
5. Both accounts should now see a **Message** button and can exchange messages.

The profile, discovery, connection, and messaging endpoints all require a valid login and active Premium status.
