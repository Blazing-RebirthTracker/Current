# Blazing:Rebirth Current Tracker (GitHub version)

This folder is the whole site: characters, Team Builder, Stages, pictures and card art.
It runs on GitHub Pages (free hosting) and uses Firebase (free Spark plan) for sign-in and for saving edits.

- **Anyone** with the link can view everything.
- **Editors** sign in with Google (top right of the page) and can change results, notes, stages and pictures.
- **Admins** can also add and remove editors (the **Editors** button after signing in).

The site works even before Firebase is set up. It just shows the bundled data read-only until then.

---

## Part 1: Put the site on GitHub (about 10 minutes)

1. Unzip **all** the zips into one folder, so it contains `index.html`, `site.js`, `firebase-config.js`, `firestore.rules`, and the folders `data`, `img`, `ev` and `art`.
2. Create a free GitHub account if you don't have one. The account name becomes part of the web address, for example `blazingrevival.github.io`.
3. Create a new **public** repository, for example `tracker`.
4. Upload the folder. The site has about 2,100 files, and GitHub's website only takes 100 files at a time, so the easiest way is **GitHub Desktop** (desktop.github.com):
   - File → Clone repository → pick your new repo → choose where to put it.
   - Copy everything from the unzipped folder into that repo folder.
   - Back in GitHub Desktop: type a summary like "First upload" → **Commit to main** → **Push origin**.
5. On github.com, open the repo → **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → Save.
6. After a minute or two, the site is live at `https://YOUR-NAME.github.io/tracker/`.

## Part 2: Turn on sign-in and saving with Firebase (about 10 minutes)

1. Go to console.firebase.google.com → **Add project** → give it a name → you can turn Google Analytics off → Create.
2. **Add a web app**: on the project overview, click the `</>` (Web) icon → give it a nickname → Register (skip "Firebase Hosting").
   Firebase shows a `firebaseConfig = { apiKey: ..., authDomain: ..., projectId: ..., ... }` block.
3. Open `firebase-config.js` from this folder and paste those values in, replacing the `PASTE_API_KEY_HERE` and the empty `""` values. Save it.
   These values are safe to publish. The rules in step 6 are what stop other people from editing.
4. **Build → Authentication** → Get started → **Sign-in method** → **Google** → Enable → pick a support email → Save.
5. Still in Authentication → **Settings** → **Authorized domains** → **Add domain** → type `YOUR-NAME.github.io` → Add.
6. **Build → Firestore Database** → Create database → pick a location near you → **Start in production mode** → Create.
   Then open the **Rules** tab and delete what's there. Open `firestore.rules` from this folder, change `OWNER_EMAIL` to the Google address you'll sign in with (all lowercase, keep the quotes), paste the whole file in → **Publish**.
7. Commit and push the updated `firebase-config.js` with GitHub Desktop. There's no need to upload your edited `firestore.rules` if you'd rather keep your email private, since it lives in Firebase.

## Part 3: First sign-in

1. Open the site and click **Sign in** (top right). Use the owner Google account from the rules. You'll show up as **Admin**.
2. Click **Editors** → **Load starting data**. This copies all characters and stages into the database. Do this once.
3. To give someone edit access: **Editors** → type their Google (Gmail) address → Editor or Admin → **Add**. They sign in with that account and can edit right away.
   To take access away, click **Remove** next to their name.

## Good to know

- **Backups:** **Editors** → **Download backup** saves everything in the database to one file. The Claude version of the tracker stays as your private copy too.
- **Pictures added from the site** (card art, event images) are saved in the database as small WebP images, so no paid storage is needed. The pictures that came with the site live in the `img`, `art` and `ev` folders.
- **Free limits:** Firebase's free plan allows 50,000 reads a day. Each visit uses only about 6 reads, plus one per picture that was added from the site, so it covers thousands of visits a day.
- **Updates to the page design:** if you ask Claude for changes later, you'll get a new `index.html` to replace. Your data and editors stay in Firebase, untouched.
- **The report form link** still goes to your Google Form.
