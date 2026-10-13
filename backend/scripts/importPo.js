// Import data Purchase Order (hasil baca foto PO) ke tabel PO di app.
// Semua file backend/scripts/data/po_*.json dibaca sekaligus, jadi tiap batch
// foto baru cukup ditaruh di folder itu (po_batch2.json, po_batch3.json, dst).
//
// CARA PAKAI (dari folder backend):
//   node scripts/importPo.js --dry     # cek saja: tampilkan daftar & cek total, TIDAK menulis ke database
//   node scripts/importPo.js           # import (aman diulang: nomor PO yang sudah ada dilewati)
//
// Customer dicocokkan ke menu Customer berdasarkan nama (huruf besar/kecil & spasi
// diabaikan). Kalau tidak ketemu, nama ditulis di kolom "Nama Pemesan" (bisa diganti
// ke customer terdaftar lewat Edit PO). Dihitung ulang qty x harga dan dibandingkan
// dengan total di kertas (`totalKertas`); kalau beda, PO itu dilewati dan dilaporkan.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const prisma = new PrismaClient();
const dry = process.argv.includes("--dry");

const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); // abaikan titik/spasi: "PT. Pitaco Mitra Perkasa" = "PT Pitaco Mitraperkasa"
const rp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");

async function main() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => /^po_.*\.json$/.test(f)).sort();
  if (!files.length) return console.log("Tidak ada file scripts/data/po_*.json");

  const rows = [];
  for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf-8"));
    for (const r of arr) rows.push({ ...r, _file: f });
  }
  console.log(`Data: ${rows.length} PO dari ${files.length} file (${files.join(", ")})`);

  const customers = await prisma.customer.findMany({ select: { id: true, nama: true } });
  const custByKey = new Map(customers.map((c) => [key(c.nama), c]));
  const sudah = new Set((await prisma.purchaseOrder.findMany({ select: { no: true } })).map((p) => p.no));

  let dibuat = 0;
  const dilewati = [];
  const noDiFile = new Set();

  for (const r of rows) {
    const total = r.items.reduce((s, i) => s + i.qty * i.hargaSatuan, 0);
    const cust = custByKey.get(key(r.namaCustomer));
    const info = `${r.no} | ${r.tanggal} | ${r.namaCustomer}${cust ? " (cocok customer)" : " (belum ada di menu Customer, ditulis manual)"} | ${rp(total)}`;

    if (noDiFile.has(r.no)) { dilewati.push(`${r.no}: nomor ganda di file data`); continue; }
    noDiFile.add(r.no);
    if (r.totalKertas != null && Math.round(total) !== Math.round(r.totalKertas)) {
      dilewati.push(`${r.no}: total hitungan ${rp(total)} beda dengan kertas ${rp(r.totalKertas)}`);
      continue;
    }
    if (sudah.has(r.no)) { dilewati.push(`${r.no}: sudah ada di database`); continue; }

    console.log((dry ? "[dry] " : "") + info);
    if (!dry) {
      await prisma.purchaseOrder.create({
        data: {
          no: r.no,
          divisi: r.divisi || "Supplier",
          tanggal: new Date(`${r.tanggal}T00:00:00.000Z`),
          customerId: cust?.id || null,
          namaCustomer: cust ? null : r.namaCustomer || null,
          proyek: r.proyek || null,
          lokasiProyek: r.lokasiProyek || null,
          kepalaProyek: r.kepalaProyek || null,
          penerimaBarang: r.penerimaBarang || null,
          catatan: r.catatan || null,
          ppnPersen: r.ppnPersen || 0,
          items: {
            create: r.items.map((i, n) => ({
              urut: n,
              uraian: i.uraian,
              satuan: i.satuan || null,
              qty: i.qty,
              hargaSatuan: i.hargaSatuan || 0,
            })),
          },
        },
      });
    }
    dibuat++;
  }

  console.log(`\n${dry ? "Akan dibuat" : "Berhasil dibuat"}: ${dibuat} PO`);
  if (dilewati.length) {
    console.log(`Dilewati: ${dilewati.length}`);
    dilewati.forEach((d) => console.log("  - " + d));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
