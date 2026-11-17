# Thayyil Petroleum — Management & Accounts System (cloud-synced)

Your original `131102.html` app, now backed by MongoDB so every device (operators,
manager, accountant, admin) sees the same live data — instead of each phone/computer
having its own separate `localStorage`. Access to the data requires logging in; the
public internet can no longer read or write it just by finding the URL.

## What's inside
- `server.js` — Express API + static file server
- `public/index.html` — your original app, with 3 small edits (below) + one sync script
- `package.json` — dependencies
- `.env.example` — copy to `.env` for local testing; on Render, set these as real
  Environment Variables instead

## What changed in your HTML, and why
Only three existing functions were touched, plus one new `<script>` block added
right before `</body>`. No layouts, styles, calculations, or print logic were touched.

1. **`handleLogin`** now checks your username/password against the server first
   (real authentication), and only falls back to the old local-only check if the
   server can't be reached (so the app still works offline).
2. **`handleRegister`** now always creates new accounts as "pending approval" —
   including ones registered as "Admin". The original code auto-approved and
   auto-logged-in anyone who registered as Admin, which was a backdoor: anyone
   who found your login page could make themselves an Admin instantly. It also now
   sends the registration to the server so an Admin/Manager on a *different* device
   can see and approve it.
3. **`logout`** now also clears the server-side session, not just local storage.
4. The new script at the bottom mirrors your 8 data keys (`pump_users`,
   `pump_submissions`, etc.) to and from the server automatically — it hooks
   `localStorage.setItem`, so none of your other functions needed to change.

## How access control works now
- `/api/sync` (read and write) requires being logged in. Anonymous requests get
  a 401 and are ignored by the app.
- Operators can only write their own shift data (`pump_submissions`,
  `pump_last_readings`, `pump_whatsapp_queue`) — matching what their screen already
  lets them touch. Fuel rates, day book, credit bills, WhatsApp settings, and staff
  management require Admin/Manager/Accountant, enforced on the server now too, not
  just hidden in the UI.
- A brand-new deployment seeds 5 default accounts (same ones your file already had:
  `Ajil K James` / `admin123` as Admin, etc.) so you can log in immediately.
  **Change these passwords from the Security tab right after your first login.**

## Known limitations (unchanged from your original design)
- Passwords are stored as plain text in the database, same as they already were in
  `localStorage` (the Admin UI shows them in a "Password" column for account
  recovery). If you'd like these hashed instead, that's a separate follow-up —
  it would remove the "show password to Admin" feature in the Security tab.
- If two different devices are both offline and someone registers the same new
  username on each, the server will reject the second one it sees — the first
  device's registration wins.

## Deploy it

### 1. MongoDB Atlas (free database)
1. Go to [mongodb.com/atlas](https://mongodb.com/atlas) → create a free account →
   create a **Free Shared Cluster (M0)**.
2. **Database Access** → add a database user (username + password).
3. **Network Access** → **Allow Access from Anywhere** (`0.0.0.0/0`).
4. **Connect → Drivers** → copy the connection string (`mongodb+srv://...`).

### 2. Push this folder to GitHub
Create a **private** repository and upload `package.json`, `server.js`,
`.gitignore`, and the `public/` folder (not `.env` — that stays secret).

### 3. Render.com (free hosting)
1. Log in at [render.com](https://render.com) → **New → Web Service** → connect
   your GitHub repo.
2. Build Command: `npm install`  ·  Start Command: `node server.js`
3. **Environment** tab → add:
   - `MONGO_URI` → your Atlas connection string
   - `JWT_SECRET` → a long random string (generate one with
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `NODE_ENV` → `production`
4. Click **Deploy**. You'll get a link like `https://thayyil-petroleum.onrender.com`
   — open it on any phone or computer and log in.

### Testing locally first (optional)
```bash
npm install
cp .env.example .env   # then fill in MONGO_URI and JWT_SECRET
npm start
# open http://localhost:3000
```
