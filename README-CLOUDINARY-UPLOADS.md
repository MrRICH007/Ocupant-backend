# Ocupant Cloudinary property image uploads

## What this changes
- Admins can select a property image directly from a phone or computer.
- The backend validates image type and size, requires admin authentication, and streams the image to Cloudinary.
- The existing `houses.image` field continues to store the secure Cloudinary image URL, so existing listings and public frontend compatibility are preserved.
- Supported: JPG/JPEG, PNG, WebP; maximum 8 MB per image. This version supports one primary image per property, matching the current database/UI schema.

## Setup
1. Create/sign into a Cloudinary account and open the Dashboard.
2. In Render, open the Ocupant backend service → Environment. Add these exact keys using the values from Cloudinary Dashboard:
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
3. Keep `CLOUDINARY_API_SECRET` only in Render backend environment variables. Never add it to HTML, Git, or frontend environment variables.
4. Deploy this backend and replace the deployed admin HTML with `Admin-registration-details-cloudinary.html`.
5. Test an upload while logged in as admin, then create/edit a listing and confirm the photo appears on the public site.

## Storage
Actual image files are stored in Cloudinary under `ocupant/properties`. PostgreSQL continues to store only the image URL in the existing `houses.image` column. No database migration is required. Existing image URLs remain valid.

## Important
The account and credentials are not created by this code. Uploads will return a setup message until all three Render environment variables are set. No live Cloudinary upload can be verified until you configure your own account credentials.
