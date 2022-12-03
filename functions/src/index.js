import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
// import * as crypto from 'crypto';
admin.initializeApp();
const firestore = admin.firestore();
export const authOnCreate = functions.auth.user().onCreate(async (user) => {
    console.log(`Creating document for user ${user.uid}`);
    const { uid } = user;
    await firestore.collection('users').doc(uid).set({
        username: "User_" + uid,
    });
    await firestore.collection('users').doc(uid).collection('private').doc('account').set({
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await firestore.collection('users').doc(uid).collection('private').doc('info').set({
        birthday: admin.firestore.FieldValue.serverTimestamp(),
    });
    await firestore.collection('users').doc(uid).collection('public').doc('profile').set({
        display_name: "User_" + uid,
        status: "",
        bio: "",
        website: "",
    });
});
export const authOnDelete = functions.auth.user().onDelete(async (user) => {
    console.log(`Deleting document for user ${user.uid}`);
    await firestore.collection('users').doc(user.uid).delete();
});
