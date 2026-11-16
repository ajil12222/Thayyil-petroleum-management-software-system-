require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy; needed for correct secure-cookie behaviour
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "15mb" }));

const isProd = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.JWT_SECRET) {
  console.warn(
    "⚠️  JWT_SECRET is not set in the environment. Using a random secret for THIS run only, " +
    "which means every restart logs everyone out. Set JWT_SECRET in Render's Environment " +
    "Variables before going live."
  );
}

// ---------------- MongoDB ----------------
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/thayyil_petroleum";
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err.message));

const StoreSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
});
const AppStore = mongoose.model("AppStore", StoreSchema);

// The 8 localStorage keys the frontend keeps everything in.
const SYNC_KEYS = [
  "pump_users",
  "pump_submissions",
  "pump_last_readings",
  "pump_fuel_rates",
  "pump_daybooks",
  "pump_credit_bills",
  "pump_whatsapp_config",
  "pump_whatsapp_queue"
];

// Defense in depth: the UI already hides fuel rates, day book, credit
// bills, WhatsApp settings and staff management from Operators. The
// backend now enforces the same boundary, so a logged-in Operator's
// session token can't be used to write those keys even by someone
// calling the API directly.
const OPERATOR_WRITE_KEYS = new Set(["pump_submissions", "pump_last_readings", "pump_whatsapp_queue"]);

const normalizeStr = (s) => String(s || "").trim().toLowerCase();

// Seeded once, only if the database has no staff list yet, so a brand
// new deployment always has a working Admin login. CHANGE THESE
// PASSWORDS after your first login (Security tab).
const DEFAULT_USERS = [
  { username: "Ajil K James", pass: "admin123", role: "Admin", mobile: "9876543210", gender: "Male", active: true, approved: true },
  { username: "Ajil", pass: "admin123", role: "Manager", mobile: "8590192367", gender: "Male", active: true, approved: true },
  { username: "Accountant", pass: "acc123", role: "Accountant", mobile: "9847000000", gender: "Male", active: true, approved: true },
  { username: "Dinu", pass: "1234", role: "Operator", mobile: "9876543212", gender: "Male", active: true, approved: true },
  { username: "Sanoy", pass: "1234", role: "Operator", mobile: "8590192367", gender: "Male", active: true, approved: true }
];

async function ensureSeedUsers() {
  try {
    const existing = await AppStore.findOne({ key: "pump_users" });
    if (!existing) {
      await AppStore.create({ key: "pump_users", value: DEFAULT_USERS });
      console.log("🌱 Seeded default staff accounts — change these passwords after your first login.");
    }
  } catch (err) {
    console.error("Seed error:", err.message);
  }
}
mongoose.connection.once("open", ensureSeedUsers);

// ---------------- Auth helpers ----------------
function signToken(user) {
  return jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "12h" });
}

function authMiddleware(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.status(401).json({ success: false, message: "Not authenticated" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Session expired, please log in again" });
  }
}

// Modest brute-force protection on the two public auth endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please wait a few minutes and try again." }
});

// ---------------- Auth routes (public) ----------------
app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password required" });
    }
    const doc = await AppStore.findOne({ key: "pump_users" });
    const users = doc && Array.isArray(doc.value) ? doc.value : [];
    const cleanUser = normalizeStr(username);
    const found = users.find(
      (u) => normalizeStr(u.username) === cleanUser && String(u.pass || "").trim() === String(password).trim()
    );
    if (!found) {
      return res.status(401).json({ success: false, reason: "invalid", message: "Invalid Username or Password!" });
    }
    if (found.approved === false) {
      return res.status(401).json({ success: false, reason: "pending", message: "Your account is pending approval!" });
    }
    if (found.active === false) {
      return res.status(401).json({ success: false, reason: "inactive", message: "Your account has been deactivated." });
    }

    const token = signToken(found);
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 12 * 60 * 60 * 1000
    });
    const { pass, ...safeUser } = found;
    res.json({ success: true, user: safeUser });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

// Self-registration stays open (new staff still request an account from
// the login screen), but it no longer trusts the client: every new
// account is created as approved:false, whatever role was requested.
// The old frontend auto-approved anyone who registered as "Admin" —
// that was a real backdoor, so it's removed here.
app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const { username, pass, role, mobile, gender } = req.body || {};
    if (!username || !pass || !role) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }
    const doc = await AppStore.findOne({ key: "pump_users" });
    const users = doc && Array.isArray(doc.value) ? doc.value : [];
    const clean = normalizeStr(username);
    if (users.some((u) => normalizeStr(u.username) === clean)) {
      return res.status(409).json({ success: false, message: "Username already exists!" });
    }
    users.push({ username, pass, role, mobile: mobile || "", gender: gender || "", active: true, approved: false });
    await AppStore.findOneAndUpdate({ key: "pump_users" }, { value: users, updatedAt: new Date() }, { upsert: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------- Sync routes (must be logged in) ----------------
app.get("/api/sync", authMiddleware, async (req, res) => {
  try {
    const docs = await AppStore.find({ key: { $in: SYNC_KEYS } });
    const data = {};
    docs.forEach((doc) => {
      data[doc.key] = doc.value;
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/sync", authMiddleware, async (req, res) => {
  try {
    const { key, value } = req.body || {};
    if (!SYNC_KEYS.includes(key)) {
      return res.status(400).json({ success: false, message: "Invalid key" });
    }
    if (req.user.role === "Operator" && !OPERATOR_WRITE_KEYS.has(key)) {
      return res.status(403).json({ success: false, message: "Your role is not permitted to update this data." });
    }
    await AppStore.findOneAndUpdate(
      { key },
      { value, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- Static frontend ----------------
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Thayyil Petroleum Server running on port ${PORT}`);
});
