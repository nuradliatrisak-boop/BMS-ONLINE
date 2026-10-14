// Import "Rekap_Pengeluaran_BMS_10-29Sep2026.xlsx" (sheet Pengeluaran, 150 baris)
// ke Laporan Divisi (tabel DivisiTx), sehingga bisa dilihat, diedit, dan dihapus
// dari halaman Laporan Divisi seperti transaksi biasa.
//
// CARA PAKAI (dari folder backend):
//   node scripts/importRekapPengeluaran.js            # import (aman diulang, baris yang sudah ada dilewati)
//   node scripts/importRekapPengeluaran.js --dry      # cek saja, tidak menulis ke database
//   node scripts/importRekapPengeluaran.js --reset    # hapus dulu hasil import sebelumnya, lalu import ulang
//
// Pemetaan (sudah dihitung di file JSON, total Rp 248.722.000 sama dengan Excel):
//   Alat Berat  -> divisi "Alat Berat", kelompok operasional, rincian "Sparepart" (+ Pengeluaran Lainnya)
//   Truk        -> divisi "Armada", kelompok sparepart (Tronton / Cold Diesel, rincian per unit)
//   Mobil Storing, RS sopir, koordinasi angkutan -> Armada, Pengeluaran Lainnya
//   Kapal, Ponton -> divisi "Kapal", kelompok pengeluaran (kategori = nama kapal)
//   Kantor, utang/kas periode lalu, koreksi, stok, tanpa unit -> Supplier
//   Proyek Pulau Kelor -> Kontraktor
// Setiap baris diberi kolom `sumber` = "Import Excel Rekap_Pengeluaran_... #<no>".

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();
const DATA_PATH = path.join(__dirname, "data", "rekap_pengeluaran_sep2026.json");
const PREFIX = "Import Excel Rekap_Pengeluaran_BMS_10-29Sep2026 #";

const dry = process.argv.includes("--dry");
const reset = process.argv.includes("--reset");

async function main() {
  const rows = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  const total = rows.reduce((s, r) => s + r.nominal, 0);
  console.log(`Data: ${rows.length} baris, total Rp ${total.toLocaleString("id-ID")}`);

  if (dry) {
    const per = {};
    for (const r of rows) {
      const k = `${r.divisi} / ${r.kelompok}`;
      per[k] = (per[k] || 0) + r.nominal;
    }
    console.table(per);
    console.log("Mode --dry: tidak ada yang ditulis.");
    return;
  }

  if (reset) {
    const del = await prisma.divisiTx.deleteMany({ where: { sumber: { startsWith: PREFIX } } });
    console.log(`Reset: ${del.count} baris import lama dihapus.`);
  }

  const existing = await prisma.divisiTx.findMany({
    where: { sumber: { startsWith: PREFIX } },
    select: { sumber: true },
  });
  const sudah = new Set(existing.map((e) => e.sumber));
  const baru = rows.filter((r) => !sudah.has(r.sumber));

  if (baru.length) {
    await prisma.divisiTx.createMany({
      data: baru.map((r) => ({
        divisi: r.divisi,
        tipe: r.tipe,
        kelompok: r.kelompok,
        kategori: r.kategori,
        subKategori: r.subKategori || null,
        keterangan: r.keterangan || null,
        nominal: r.nominal,
        tanggal: new Date(`${r.tanggal}T00:00:00.000Z`),
        sumber: r.sumber,
      })),
    });
  }
  console.log(`Selesai: ${baru.length} baris ditambahkan, ${rows.length - baru.length} dilewati (sudah ada).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
