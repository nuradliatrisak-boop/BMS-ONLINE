import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.js";
import customerRoutes from "./routes/customers.js";
import armadaRoutes from "./routes/armada.js";
import materialRoutes from "./routes/material.js";
import invoiceRoutes from "./routes/invoices.js";
import suratJalanRoutes from "./routes/suratJalan.js";
import divisiTxRoutes from "./routes/divisiTx.js";
import dashboardRoutes from "./routes/dashboard.js";
import userRoutes from "./routes/users.js";
import rekapPenjualanRoutes from "./routes/rekapPenjualan.js";
import stockMasterRoutes from "./routes/stockMaster.js";
import printCalibRoutes from "./routes/printCalib.js";
import settingsRoutes from "./routes/settings.js";
import solarTxRoutes from "./routes/solarTx.js";

import { requireAuth } from "./middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Halaman statis sederhana (HTML+JS polos, tanpa Vue/Vite) untuk PC lama
// di gudang (mis. Windows XP + Firefox 52 ESR) yang dipakai input Surat
// Jalan & Invoice. Diakses lewat: <backend-url>/simple/login.html
// Halaman ini memanggil API yang sama persis (path relatif /api/...),
// jadi 1 origin dengan backend -> tidak perlu setting CORS terpisah.
app.use("/simple", express.static(path.join(__dirname, "..", "public", "simple")));

// File upload (foto/PDF bukti surat jalan Solar dst) - lihat catatan
// penting soal storage ephemeral di src/middleware/upload.js.
app.use("/uploads", express.static(path.join(__dirname, "..", "public", "uploads")));

const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());

console.log("ALLOWED ORIGINS:", JSON.stringify(allowedOrigins));

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Publik (login)
app.use("/api/auth", authRoutes);

// Semua route di bawah ini wajib login
app.use("/api/customers", requireAuth, customerRoutes);
app.use("/api/armada", requireAuth, armadaRoutes);
app.use("/api/material", requireAuth, materialRoutes);
app.use("/api/invoices", requireAuth, invoiceRoutes);
app.use("/api/surat-jalan", requireAuth, suratJalanRoutes);
app.use("/api/divisi-tx", requireAuth, divisiTxRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);
app.use("/api/users", requireAuth, userRoutes);
app.use("/api/rekap-penjualan", requireAuth, rekapPenjualanRoutes);
app.use("/api/stock-master", requireAuth, stockMasterRoutes);
app.use("/api/print-calib", requireAuth, printCalibRoutes);
app.use("/api/settings", requireAuth, settingsRoutes);
app.use("/api/solar-tx", requireAuth, solarTxRoutes);

// Penanganan error terpusat
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Terjadi kesalahan pada server" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`BMS backend jalan di port ${port}`);
});