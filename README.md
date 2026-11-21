# CKB Lechon

Mobile-first ordering for CK Bless Lechon House, built with Next.js, Firebase, and a warm clay-inspired orange and blush palette.

## Run locally

1. Copy `.env.example` to `.env.local`. The Firebase web app values are already filled in.
2. In Firebase Console, enable **Authentication > Phone** and **Email/Password**, create a Firestore database, enable Storage, and add your local site to the authorized domains.
3. Run `npm install` and `npm run dev`.

Phone signup verifies the number with Firebase SMS, then links password sign-in to that verified account. The Firebase web config is public by design; Firestore and Storage rules protect the data.

## Admin access

Admin access is enforced by the `admin: true` Firebase Authentication custom claim, not by a client-editable profile field. In a trusted environment authenticated with Google Application Default Credentials for the `ck-lechon` project, run `npm run set:admin -- <firebase-auth-uid>` for a verified staff account, then sign out and back in to refresh the ID token. Never expose a service-account key in this static website. Deploy `firestore.rules` and `storage.rules` before opening ordering to customers.

## GitHub Pages

This project uses Next.js static export (`out/`), which is compatible with GitHub Pages but keeps Firebase operations client-side. In repository settings, enable **Pages > GitHub Actions**. The workflow loads the public Firebase web configuration from `.env.example`; pushing `main` deploys at `https://ckb-lechon.github.io`.

## Firebase data

- `products`: active menu items, image URL, regular or promotional price, and promo dates.
- `users`: name, address, phone, and a non-privileged profile role.
- `orders`: product snapshot, pickup slot, buyer details, payment status, and delivery status.

Phone authentication requires a real SMS verification code before password-based login is enabled. Configure Firebase phone sign-in quotas, SMS regions, billing, and reCAPTCHA as required by the Firebase project.