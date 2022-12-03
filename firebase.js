import * as dotenv from 'dotenv';
dotenv.config();
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
const app = initializeApp({
    credential: cert({
        projectId: "virtualolympiad",
        privateKey: process.env.FIREBASE_PRIVATE_KEY,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
});
const auth = getAuth(app);
const rtdb = getDatabase(app);
let db = getFirestore(app);
export { app, auth, rtdb, db };
