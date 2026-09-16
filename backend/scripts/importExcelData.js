// Import semua data dari "Rekap_Invoice.xlsx" (78 sheet lama) ke database.
//
// CARA PAKAI:
//   cd backend
//   node scripts/importExcelData.js
//
// Script ini AMAN dijalankan berkali-kali (idempotent) -- data yang sudah
// pernah diimport tidak akan digandakan lagi, jadi kalau prosesnya
// terputus di tengah jalan, tinggal dijalankan ulang.
//
// Sumber data ada di scripts/import_data.json (hasil olahan dari file Excel,
// sudah dipisah per baris/transaksi). Baris yang berhasil dikenali polanya
// (kolom No/Tanggal/No Surat Jalan/Jenis Barang/P/L/T/Jumlah/Harga/Total)
// masuk ke tabel "Rekap Penjualan" per customer. Baris lain (sewa alat per
// jam, giro/pembayaran, dan sheet yang formatnya tidak baku) masuk ke
// "Laporan Divisi" (DivisiTx) supaya tetap tercatat dan bisa dicek/dipindah
// manual lewat menu Laporan Divisi kalau kategorinya kurang pas.
//
// Baris yang TIDAK bisa diimport sama sekali (sheet referensi/daftar harga
// tanpa tanggal transaksi, misalnya "harga sihol", "HARGA BRAM", "pajak djp",
// dll) dicatat di scripts/import_report.json -- silakan cek & masukkan
// manual lewat menu yang sesuai (Customer > Harga, dst) kalau masih perlu.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

const DATA_PATH = path.join(__dirname, "import_data.json");

function loadData() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`File data tidak ditemukan: ${DATA_PATH}`);
    console.error(`Pastikan file "import_data.json" ada di folder scripts/ ini.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
}

async function upsertCustomers(customersMap) {
  console.log(`\n== Customer (${Object.keys(customersMap).length}) ==`);
  const existing = await prisma.customer.findMany({ select: { id: true, nama: true, kode: true } });
  const byNama = new Map(existing.map((c) => [c.nama.trim().toUpperCase(), c]));

  const kodeToId = {};
  let created = 0, reused = 0;

  for (const key of Object.keys(customersMap)) {
    const c = customersMap[key];
    const namaKey = c.nama.trim().toUpperCase();
    const found = byNama.get(namaKey);
    if (found) {
      kodeToId[c.kode] = found.id;
      reused++;
      continue;
    }
    // pastikan kode unik (kalau kode IMP-xxx kebetulan sudah dipakai)
    let kode = c.kode;
    let n = 1;
    while (await prisma.customer.findUnique({ where: { kode } })) {
      kode = `${c.kode}-${n++}`;
    }
    const row = await prisma.customer.create({
      data: { kode, nama: c.nama, divisi: c.divisi || "Supplier", aktif: true },
    });
    kodeToId[c.kode] = row.id;
    byNama.set(namaKey, row);
    created++;
  }
  console.log(`  dibuat baru: ${created}, dipakai ulang (nama sudah ada): ${reused}`);
  return kodeToId;
}

async function importRekap(rekapRows, kodeToId) {
  console.log(`\n== Rekap Penjualan (${rekapRows.length} baris dari Excel) ==`);
  if (rekapRows.length === 0) return;

  // Ambil kombinasi yang sudah ada di DB (customerId+tanggal+noSuratJalan) untuk cegah duplikat
  const existing = await prisma.rekapPenjualan.findMany({
    select: { customerId: true, tanggal: true, noSuratJalan: true },
  });
  const existingSet = new Set(
    existing.map((r) => `${r.customerId}|${r.tanggal.toISOString().slice(0, 10)}|${r.noSuratJalan}`)
  );

  const toInsert = [];
  let skippedNoCustomer = 0, skippedDup = 0;

  for (const r of rekapRows) {
    const customerId = kodeToId[r.customerKode];
    if (!customerId) {
      skippedNoCustomer++;
      continue;
    }
    const tglKey = r.tanggal;
    const dupKey = `${customerId}|${tglKey}|${r.noSuratJalan}`;
    if (existingSet.has(dupKey)) {
      skippedDup++;
      continue;
    }
    existingSet.add(dupKey); // cegah duplikat antar-baris Excel sendiri juga
    const sumberNote = `[Excel Import: ${r.sumber.replace("Excel Import - ", "")}]`;
    toInsert.push({
      customerId,
      tanggal: new Date(r.tanggal),
      noSuratJalan: r.noSuratJalan || "-",
      noPolisi: r.noPolisi || "",
      jenisBarang: r.jenisBarang || "-",
      panjang: r.panjang || 0,
      lebar: r.lebar || 0,
      tinggi: r.tinggi || 0,
      jumlah: r.jumlah || 0,
      harga: r.harga || 0,
      total: r.total || 0,
      catatan: r.catatan ? `${sumberNote} ${r.catatan}` : sumberNote,
    });
  }

  console.log(`  siap insert: ${toInsert.length}, dilewati (customer tak ketemu): ${skippedNoCustomer}, dilewati (sudah ada/duplikat): ${skippedDup}`);

  const BATCH = 500;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    await prisma.rekapPenjualan.createMany({ data: batch });
    process.stdout.write(`\r  insert ${Math.min(i + BATCH, toInsert.length)}/${toInsert.length}`);
  }
  console.log("");
}

async function importDivisiTx(rows) {
  console.log(`\n== Laporan Divisi / DivisiTx (${rows.length} baris dari Excel) ==`);
  if (rows.length === 0) return;

  const existing = await prisma.divisiTx.findMany({
    where: { sumber: { startsWith: "Excel Import" } },
    select: { divisi: true, kelompok: true, kategori: true, tanggal: true, nominal: true, keterangan: true },
  });
  const existingSet = new Set(
    existing.map((r) => `${r.divisi}|${r.kelompok}|${r.kategori}|${r.tanggal.toISOString().slice(0, 10)}|${r.nominal}|${r.keterangan || ""}`)
  );

  const toInsert = [];
  let skippedDup = 0;
  for (const r of rows) {
    const key = `${r.divisi}|${r.kelompok}|${r.kategori}|${r.tanggal}|${r.nominal}|${r.keterangan || ""}`;
    if (existingSet.has(key)) {
      skippedDup++;
      continue;
    }
    existingSet.add(key);
    toInsert.push({
      divisi: r.divisi,
      tipe: r.tipe,
      kelompok: r.kelompok,
      kategori: r.kategori,
      subKategori: r.subKategori || null,
      keterangan: r.keterangan || null,
      qty: r.qty ?? null,
      hargaSatuan: r.hargaSatuan ?? null,
      nominal: r.nominal || 0,
      tanggal: new Date(r.tanggal),
      sumber: r.sumber,
    });
  }

  console.log(`  siap insert: ${toInsert.length}, dilewati (sudah ada/duplikat): ${skippedDup}`);

  const BATCH = 500;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    await prisma.divisiTx.createMany({ data: batch });
    process.stdout.write(`\r  insert ${Math.min(i + BATCH, toInsert.length)}/${toInsert.length}`);
  }
  console.log("");
}

async function importCustomerPrices(rows, kodeToId, customersMap) {
  console.log(`\n== Harga Customer / CustomerPrice (${(rows || []).length} baris dari Excel) ==`);
  if (!rows || rows.length === 0) return;

  // rows pakai "customerNama" (bukan kode) karena diambil dari sheet harga yang
  // referensinya nama customer langsung -- cari kodenya lewat customersMap.
  const namaToKode = {};
  for (const key of Object.keys(customersMap)) {
    namaToKode[customersMap[key].nama.trim().toUpperCase()] = customersMap[key].kode;
  }

  const existing = await prisma.customerPrice.findMany({
    select: { customerId: true, destinationCode: true, vehicleType: true, stockCode: true },
  });
  const existingSet = new Set(
    existing.map((r) => `${r.customerId}|${r.destinationCode}|${r.vehicleType}|${r.stockCode}`)
  );

  const toInsert = [];
  let skippedNoCustomer = 0, skippedDup = 0;
  for (const r of rows) {
    const kode = namaToKode[r.customerNama.trim().toUpperCase()];
    const customerId = kode ? kodeToId[kode] : null;
    if (!customerId) {
      skippedNoCustomer++;
      continue;
    }
    const key = `${customerId}|${r.destinationCode}|${r.vehicleType}|${r.stockCode}`;
    if (existingSet.has(key)) {
      skippedDup++;
      continue;
    }
    existingSet.add(key);
    toInsert.push({
      customerId,
      destinationCode: r.destinationCode,
      vehicleType: r.vehicleType || "CD",
      stockCode: r.stockCode,
      stockName: r.stockName,
      hargaM3: r.hargaM3 || 0,
      destination: r.destination || null,
    });
  }

  console.log(`  siap insert: ${toInsert.length}, dilewati (customer tak ketemu): ${skippedNoCustomer}, dilewati (sudah ada/duplikat): ${skippedDup}`);
  if (toInsert.length > 0) {
    await prisma.customerPrice.createMany({ data: toInsert });
  }
}

async function main() {
  console.log("Mulai import data Excel (Rekap_Invoice.xlsx) ke database...");
  const data = loadData();

  const kodeToId = await upsertCustomers(data.customers);
  await importRekap(data.rekap, kodeToId);
  await importDivisiTx(data.divisitx);
  await importCustomerPrices(data.customerprices, kodeToId, data.customers);

  console.log("\n=== SELESAI ===");
  console.log("Cek hasilnya di menu Rekap Penjualan, Laporan Divisi, & Customer > Harga.");
  console.log("Sheet yang TIDAK ikut terimport (perlu dicek manual) ada di scripts/import_report.json / IMPORT_REPORT.md");
}

main()
  .catch((e) => {
    console.error("\nGAGAL:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
