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
    "鈿狅笍  JWT_SECRET is not set in the environment. Using a random secret for THIS run only, " +
    "which means every restart logs everyone out. Set JWT_SECRET in Render's Environment " +
    "Variables before going live."
  );
}

// ---------------- MongoDB ----------------
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/thayyil_petroleum";
mongoose.connect(MONGO_URI)
  .then(() => console.log("鉁� MongoDB Connected"))
  .catch((err) => console.error("鉂� MongoDB Error:", err.message));

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
