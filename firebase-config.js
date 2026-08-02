// 1. Go to https://console.firebase.google.com → create a project (free tier is enough)
// 2. In the project: Build → Authentication → Sign-in method → enable "Email/Password"
// 3. In the project: Build → Firestore Database → Create database (start in production mode)
// 4. Project settings (gear icon) → General → "Your apps" → Add app → Web (</>) → copy the config below
// 5. Paste your values here, replacing the placeholders.

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 6. In Firestore → Rules tab, paste this and Publish (locks data to each signed-in user only):
//
// rules_version = '2';
// service cloud.firestore {
//   match /databases/{database}/documents {
//     match /users/{userId}/items/{itemId} {
//       allow read, write: if request.auth != null && request.auth.uid == userId;
//     }
//   }
// }
