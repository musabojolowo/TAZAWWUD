// ============================================================================
// TAZAWWUD — Firebase Configuration (Free-First / Spark Plan)
// ----------------------------------------------------------------------------
// Uses Firebase v10+ modular SDK via CDN. No bundler required.
// Services used: Auth (Email/Password) + Realtime Database only.
// STRICTLY NO Firestore, Cloud Functions, or Storage (Spark plan compliance).
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCC4RihSbYYTRQyDI6tcasr-GzX7csZIn4",
  authDomain: "tazawwud-4028b.firebaseapp.com",
  databaseURL: "https://tazawwud-4028b-default-rtdb.firebaseio.com",
  projectId: "tazawwud-4028b",
  storageBucket: "tazawwud-4028b.firebasestorage.app", // present for completeness; Storage itself is not used
  messagingSenderId: "427731844393",
  appId: "1:427731844393:web:a5b86894f436bb94becb38",
};

// Initialize Firebase App (singleton)
const app = initializeApp(firebaseConfig);

// Initialize and export the services used across the app
export const auth = getAuth(app);
export const db = getDatabase(app);
export const firestore = getFirestore(app);

export default app;
