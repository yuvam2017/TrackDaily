# Ghar Tracker

A simple, mobile-friendly web app for tracking recurring household items — milk, newspaper, water cans, eggs, or anything else you get regularly. Track daily quantities, adjust for one-off days, handle rate changes over time, and see your monthly bill.

No backend server, no build step. Just static files + Firebase (Auth + Firestore).

## Features

- Email/password login (Firebase Auth), synced across devices
- Add, edit, delete items — each with a name, unit, default quantity, and rate
- Default quantity carries forward automatically every day until changed
- Change the default quantity or rate from a specific date onward — past days keep their old values
- Override a single day without touching the default (e.g. "0 L, no delivery today")
- Automatic monthly quantity and bill calculation
- Daily history per item, expandable by month
- Export any month to CSV
- Clean, responsive UI — built mobile-first with a bottom nav

## Files

```
index.html          Page structure and login screen
style.css            All styling
index.js             App logic (auth, data, rendering) — ES module
firebase-config.js   Your Firebase project keys + setup instructions
```

## Setup

1. **Create a Firebase project** at [console.firebase.google.com](https://console.firebase.google.com) (the free Spark plan is enough).
2. **Enable Email/Password sign-in**: Build → Authentication → Sign-in method → enable "Email/Password".
3. **Create a Firestore database**: Build → Firestore Database → Create database → start in production mode.
4. **Get your web app config**: Project settings (gear icon) → General → "Your apps" → Add app → Web (`</>`). Copy the config object.
5. **Paste your config** into `firebase-config.js`, replacing the placeholder values.
6. **Set Firestore security rules** so users can only access their own data. In Firestore → Rules, paste:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/items/{itemId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

   Click **Publish**.
7. **Open `index.html`** — either directly in a browser, or host the folder on any static host (Firebase Hosting, Netlify, GitHub Pages, etc). On first run, tap "Sign up" to create your account.

## How it works

### Adding an item
Go to the **Items** tab → "+ Add new item". Set its name, unit (L, kg, piece, packet...), default quantity, and rate. This becomes today's starting point.

### Daily use
The **Today** tab shows one card per item with today's quantity already filled in from the default.
- Tap the round **✓/✕** button to mark it taken or skipped for today.
- Tap **✎** to set a custom quantity just for today (e.g. half a packet), without changing the default.

### Changing the default going forward
In the **Items** tab, use "Change quantity" or "Change rate" and pick an effective date. Everything before that date still calculates with the old value — only the new date onward uses the new one.

### History and export
The **History** tab shows month totals per item, expandable into a daily breakdown, plus a button to export the month as CSV.

## Data model

Each item is its own Firestore document under `users/{uid}/items/{itemId}`:

```
{
  name: "Milk",
  unit: "L",
  icon: "🥛",
  createdAt: "2026-08-01",
  qtyHistory:  [ { from: "2026-08-01", val: 1 }, { from: "2026-08-15", val: 1.5 } ],
  rateHistory: [ { from: "2026-08-01", val: 60 } ],
  overrides:   { "2026-08-10": 0 }
}
```

Only *changes* are stored — a new quantity or rate adds one entry to its history array, and a one-off day adds one key to `overrides`. There's no daily record created for every single day, which keeps each document small no matter how long you use the app. Every edit in the UI updates only the relevant field, not the whole document.

## Adding new item types

No code changes needed — "item type" isn't hardcoded anywhere. Any name, unit, and rate can be entered through "+ Add new item" in the Items tab, so newspapers, water cans, eggs, or anything new all work the same way.

## Notes

- This app doesn't use browser storage restrictions or offline caching — an internet connection is needed for data to load and save (Firestore does have optional offline persistence if you want to add it later).
- Passwords are handled entirely by Firebase Auth — this app never sees or stores your password itself.
