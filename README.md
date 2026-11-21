# CKB Lechon

Mobile-first ordering for CK Bless Lechon House, built with Next.js, Firebase, and a warm clay-inspired orange and blush palette.

## Run locally

1. Copy `.env.example` to `.env.local`. The Firebase web app values are already filled in.
2. In Firebase Console, enable **Authentication > Email/Password**, create a Firestore database, and add your local site to the authorized domains.
3. In an environment authenticated with Google Application Default Credentials for `ck-lechon`, run `npm run seed:products` once to publish the starter menu into Firestore.
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

Set `NEXT_PUBLIC_UPLOADTHING_URL` to `https://ckb-lechon-uploadthing.<your-workers-subdomain>.workers.dev/api/uploadthing` in `.env.local` and as a GitHub Actions repository variable, then rebuild/redeploy the site. The Worker validates the Firebase ID token, checks the server-managed admin profile, and accepts JPEG, PNG, or WebP images up to 8 MB. To use local uploads, copy `uploadthing-worker/.dev.vars.example` to `.dev.vars`, fill in those two values, and run `npm run dev` in that folder.

## GitHub Pages

This project uses Next.js static export (`out/`), which is compatible with GitHub Pages. In repository settings, enable **Pages > GitHub Actions** and add the Worker URL as the `NEXT_PUBLIC_UPLOADTHING_URL` Actions variable. The workflow loads public Firebase web configuration from `.env.example`; pushing `main` deploys at `https://ckb-lechon.github.io`.

## Firebase data

- `products`: active menu items, image URL, regular or promotional price, and promo dates.
- `users`: name, address, phone, and a non-privileged profile role.
- `orders`: product snapshot, pickup slot, buyer details, payment status, and delivery status.

Firebase Authentication email/password accounts should use a valid customer email address. Configure password policy and authorized domains in Firebase Console.