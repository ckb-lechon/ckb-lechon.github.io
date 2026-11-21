import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const uid = process.argv[2];

if (!uid) {
  console.error("Usage: npm run set:admin -- <firebase-auth-uid>");
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });

const user = await getAuth().getUser(uid);
await getAuth().setCustomUserClaims(uid, { ...user.customClaims, admin: true });
await getFirestore().collection("users").doc(uid).set({ role: "admin" }, { merge: true });
console.log(`Granted admin access to ${user.email ?? user.uid}. Sign out and back in to refresh the ID token.`);
