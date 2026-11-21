# CKB Lechon

Mobile-first ordering for CK Bless Lechon House, built with Next.js, Firebase, and a warm clay-inspired orange and blush palette.

## Run locally

1. Copy `.env.example` to `.env.local`. The Firebase web app values are already filled in.
2. In Firebase Console, enable **Authentication > Email/Password**, create a Firestore database, and add your local site to the authorized domains.
3. Add the current menu items from the admin page.
4. Run `npm install` and `npm run dev`.

Customers register and sign in with email and password; their mobile number is saved as a contact detail. The Firebase web config is public by design; Firestore rules protect the data.

## Admin access

Admin access is enforced by the `admin: true` Firebase Authentication custom claim and a server-managed `users/{uid}.role == "admin"` field. In a trusted environment authenticated with Google Application Default Credentials for the `ck-lechon` project, run `npm run set:admin -- <firebase-auth-uid>` for a staff account, then sign out and back in to refresh the ID token. Never expose a service-account key in this static website. Firestore rules are deployed to `ck-lechon`.

Before using email/password sign-in in production, enable the Email/Password provider and add `ckb-lechon.github.io` to **Authentication > Settings > Authorized domains**.

## Product image uploads (no Blaze plan)

Product images use UploadThing through a Cloudflare Worker, following the upload pattern from the PS project. Firebase Storage and Firebase Functions are not used. Create an UploadThing app, then deploy the Worker:

```bash
cd uploadthing-worker
npm install
npx wrangler login
npx wrangler secret put UPLOADTHING_TOKEN
npx wrangler secret put FIREBASE_API_KEY
npm run deploy
```

The app URL and UploadThing token are different settings. For local development, set `NEXT_PUBLIC_UPLOADTHING_URL=http://localhost:8787/api/uploadthing` in the project-root `.env.local`. Put `UPLOADTHING_TOKEN` and `FIREBASE_API_KEY` in `uploadthing-worker/.dev.vars` (copy `uploadthing-worker/.dev.vars.example`), then run `npm run dev` in `uploadthing-worker` alongside the Next.js app. Never put the UploadThing token in a `NEXT_PUBLIC_` variable.

For production, deploy the Worker, then set `NEXT_PUBLIC_UPLOADTHING_URL` as a GitHub Actions repository variable to `https://<worker>.<your-workers-subdomain>.workers.dev/api/uploadthing`. Set `UPLOADTHING_TOKEN` and `FIREBASE_API_KEY` as Cloudflare Worker secrets. Rebuild/redeploy the site after setting the URL. The Worker validates the Firebase ID token, checks the server-managed admin profile, and accepts JPEG, PNG, or WebP images up to 8 MB.

## GitHub Pages

This project uses Next.js static export (`out/`), which is compatible with GitHub Pages. In repository settings, enable **Pages > GitHub Actions** and add the Worker URL as the `NEXT_PUBLIC_UPLOADTHING_URL` Actions variable. The workflow loads public Firebase web configuration from `.env.example`; pushing `main` deploys at `https://ckb-lechon.github.io`.

## Cloudflare Workers

The root `wrangler.toml` serves the static export in `out/` as Worker static assets. In Cloudflare Workers Builds, use `npm run build` as the build command and `npx wrangler deploy` as the deploy command. Keep the Cloudflare Worker name set to `ckb-lechon-github-io`. This config prevents Wrangler from trying to migrate the static export to the OpenNext server adapter.

To enable product image uploads on this site, set `NEXT_PUBLIC_UPLOADTHING_URL` as a Cloudflare Worker build variable to the separate upload Worker endpoint ending in `/api/uploadthing`. Keep `UPLOADTHING_TOKEN` and `FIREBASE_API_KEY` as secrets on the upload Worker, not the site Worker.

If deploying through **Cloudflare Pages** instead, choose the **Next.js (Static HTML Export)** preset, use `npm run build`, and set the build output directory to `out`; leave the deploy command unset.

## Firebase data

- `products`: active menu items, image URL, regular or promotional price, and promo dates.
- `users`: name, address, phone, and a non-privileged profile role.
- `orders`: product snapshot, pickup slot, buyer details, payment status, and delivery status.

Firebase Authentication email/password accounts should use a valid customer email address. Configure password policy and authorized domains in Firebase Console.
