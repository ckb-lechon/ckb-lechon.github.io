import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault() });

const products = [
  {
    id: "whole-lechon",
    name: "Whole Lechon",
    description: "Golden, crackling skin. Tender, slow-roasted goodness made for your whole table.",
    price: 12500,
    saleType: "promo",
    promoFrom: "2026-01-01",
    promoTo: "2026-12-31",
    imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1000&q=85",
    active: true,
  },
  {
    id: "lechon-belly",
    name: "Lechon Belly Roll",
    description: "All the lechon flavor, wrapped up with crispy skin and aromatic herbs.",
    price: 3200,
    saleType: "regular",
    imageUrl: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=1000&q=85",
    active: true,
  },
  {
    id: "crispy-sisig",
    name: "Lechon Sisig",
    description: "A sizzling, savory favorite with that unmistakable lechon crunch.",
    price: 480,
    saleType: "regular",
    imageUrl: "https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?auto=format&fit=crop&w=1000&q=85",
    active: true,
  },
];

const db = getFirestore();
const batch = db.batch();

for (const { id, ...product } of products) {
  batch.set(db.collection("products").doc(id), product, { merge: true });
}

await batch.commit();
console.log(`Seeded ${products.length} active menu items in Firestore.`);
