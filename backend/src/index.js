import "dotenv/config";
import express from "express";
import cors from "cors";

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

import { requireAuth } from "./middleware/auth.js";

const app = express();

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

// Penanganan error terpusat
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Terjadi kesalahan pada server" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`BMS backend jalan di port ${port}`);
});