// Import sheet "SEWA ALAT" dari Rekap_Invoice.xlsx menjadi INVOICE beneran
// (Customer -> Invoice -> Item -> Pembayaran), bukan cuma catatan Laporan Divisi.
//
// CARA PAKAI:
//   cd backend
//   npx prisma migrate deploy      <-- WAJIB sekali saja, nambah kolom baru di InvoiceItem
//   npx prisma generate
//   node scripts/importExcelData.js
//   node scripts/importSewaAlat.js
//
// Kenapa harus lewat Invoice, bukan Laporan Divisi?
//   Halaman Dashboard & angka piutang cuma membaca tabel Invoice. Data sewa
//   alat yang dulu nyangkut di Laporan Divisi tidak akan pernah muncul di
//   statistik. Makanya baris sheet SEWA ALAT sekarang dipindah ke sini, dan
//   baris lamanya sudah dihapus dari import_data.json supaya TIDAK dobel hitung.
//
// Apa yang MASUK tagihan (Invoice):
//   - jam kerja alat x tarif sewa per jam (tarif diambil dari baris
//     "Biaya sewa alat ..." di Excel, mis. 625 jam x Rp130.000)
//   - biaya mobilisasi alat (kalau ada di Excel)
//   - pembayaran dari customer dicatat sebagai Pembayaran, jadi status
//     BELUM / SEBAGIAN / LUNAS terhitung otomatis
//
// Apa yang TIDAK masuk tagihan:
//   - UANG MAKAN OPERATOR. Itu biaya internal ke operator, bukan tagihan ke
//     customer. Semua uang makan diimport sebagai PENGELUARAN di Laporan
//     Divisi (kelompok "Uang Makan Operator") lewat importExcelData.js.
//
// Script ini AMAN dijalankan berkali-kali: invoice yang nomornya sudah ada
// akan dilewati, tidak digandakan.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();
const DATA_PATH = path.join(__dirname, "import_sewa_alat.json");

function loadData() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`File data tidak ditemukan: ${DATA_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
}

// Cari customer berdasarkan nama (case-insensitive). Kalau belum ada, dibuat
// baru dengan kode otomatis yang dijamin unik.
async function resolveCustomers(list) {
  console.log(`\n== Customer sewa alat (${list.length}) ==`);
  const existing = await prisma.customer.findMany({ select: { id: true, nama: true } });
  const byNama = new Map(existing.map((c) => [c.nama.trim().toUpperCase(), c.id]));

  const namaToId = {};
  let created = 0;
  let reused = 0;

  for (const c of list) {
    const key = c.nama.trim().toUpperCase();
    if (byNama.has(key)) {
      namaToId[c.nama] = byNama.get(key);
      reused++;
      continue;
    }
    let kode = c.kode;
    let n = 1;
    while (await prisma.customer.findUnique({ where: { kode } })) {
      kode = `${c.kode}-${n++}`;
    }
    const row = await prisma.customer.create({
      data: { kode, nama: c.nama, divisi: c.divisi || "Alat Berat", aktif: true },
    });
    namaToId[c.nama] = row.id;
    byNama.set(key, row.id);
    created++;
  }
  console.log(`  dibuat baru: ${created}, dipakai ulang (nama sudah ada): ${reused}`);
  return namaToId;
}

function hitungStatus(total, dibayar) {
  if (dibayar <= 0) return "BELUM";
  if (dibayar >= total) return "LUNAS";
  return "SEBAGIAN";
}

async function importInvoices(invoices, namaToId) {
  console.log(`\n== Invoice Sewa Alat (${invoices.length}) ==`);

  const existing = await prisma.invoice.findMany({ select: { no: true } });
  const existingNo = new Set(existing.map((i) => i.no));

  let dibuat = 0;
  let dilewati = 0;
  let totalItem = 0;

  for (const inv of invoices) {
    if (existingNo.has(inv.no)) {
      dilewati++;
      continue;
    }
    const customerId = namaToId[inv.customerNama];
    if (!customerId) {
      console.warn(`  ! customer tidak ketemu untuk invoice ${inv.no}: ${inv.customerNama}`);
      continue;
    }

    const total = inv.items.reduce((s, it) => s + Number(it.qty) * Number(it.hargaSatuan), 0);
    const dibayar = (inv.pembayaran || []).reduce((s, p) => s + Number(p.nominal), 0);

    await prisma.invoice.create({
      data: {
        no: inv.no,
        divisi: inv.divisi || "Alat Berat",
        customerId,
        tanggal: new Date(inv.tanggal),
        catatan: inv.catatan || null,
        status: hitungStatus(total, dibayar),
        items: {
          create: inv.items.map((it) => ({
            keterangan: it.keterangan,
            qty: Number(it.qty) || 0,
            satuan: it.satuan || "jam",
            hargaSatuan: Number(it.hargaSatuan) || 0,
            kategoriAlat: it.kategoriAlat || null,
            unitAlat: it.unitAlat || null,
            tglPakai: it.tglPakai ? new Date(it.tglPakai) : null,
          })),
        },
        pembayaran: {
          create: (inv.pembayaran || []).map((p) => ({
            tanggal: new Date(p.tanggal),
            nominal: Number(p.nominal) || 0,
            metode: p.metode || null,
            catatan: p.catatan || null,
          })),
        },
      },
    });

    existingNo.add(inv.no);
    dibuat++;
    totalItem += inv.items.length;
    process.stdout.write(`\r  dibuat ${dibuat}/${invoices.length}`);
  }
  console.log("");
  console.log(`  invoice dibuat: ${dibuat} (${totalItem} baris item), dilewati (nomor sudah ada): ${dilewati}`);
}

async function main() {
  console.log("Import sheet SEWA ALAT -> Invoice...");
  const data = loadData();
  const namaToId = await resolveCustomers(data.customers);
  await importInvoices(data.invoices, namaToId);

  console.log("\n=== SELESAI ===");
  console.log("Cek di menu Invoice, Rekap Sewa Alat, dan Dashboard.");
  console.log("Blok yang tarifnya TIDAK tertulis di Excel ditandai di catatan invoice");
  console.log('(cari kata "TARIF ASUMSI") -- tolong dicek & dibetulkan admin.');
}

main()
  .catch((e) => {
    console.error("\nGAGAL:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
