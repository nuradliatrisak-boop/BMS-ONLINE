import { PrismaClient } from "@prisma/client";

// Satu instance dipakai di seluruh aplikasi (praktik standar Prisma)
const prisma = new PrismaClient();

// Railway (dan proxy DB sejenis) suka memutus koneksi yang idle terlalu lama
// (biasanya sekitar 1 jam tanpa aktivitas). Kalau itu terjadi, query PERTAMA
// setelah idle akan gagal dengan error koneksi (P1001/P1017/ECONNRESET/dst),
// padahal DB-nya baik-baik saja. Middleware ini otomatis mencoba ulang SEKALI
// setiap query yang gagal karena masalah koneksi, sebelum benar-benar
// melempar error ke user. Ini yang menyebabkan gejala "login gagal random
// tiap 1-2 jam" di awal.
const KODE_ERROR_KONEKSI = [
  "P1001", // Can't reach database server
  "P1002", // Database server was reached but timed out
  "P1008", // Operations timed out
  "P1017", // Server has closed the connection
];

prisma.$use(async (params, next) => {
  try {
    return await next(params);
  } catch (e) {
    const pesan = String(e?.message || "");
    const errKoneksi =
      KODE_ERROR_KONEKSI.includes(e?.code) ||
      pesan.includes("Connection terminated") ||
      pesan.includes("ECONNRESET") ||
      pesan.includes("Closed") ||
      pesan.includes("connection");

    if (!errKoneksi) throw e; // error lain (misal validasi data) langsung dilempar, jangan diulang

    console.warn(
      `[prisma] Koneksi DB terputus saat query ${params.model}.${params.action}, mencoba ulang sekali...`
    );
    await new Promise((r) => setTimeout(r, 300)); // jeda kecil sebelum retry
    return next(params); // percobaan kedua; kalau gagal lagi, baru dilempar ke caller
  }
});

export default prisma;