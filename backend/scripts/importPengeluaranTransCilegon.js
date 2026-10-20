// Catat PENGELUARAN PT. TRANS CILEGON JAYA - proyek "Penyempurnaan Tanggul Cilincing"
// (dari Excel PENGELUARAN_PT_TRANSCILEGON_JAYA.xlsx, sheet Pengeluaran) ke menu Proyek Kontraktor.
//
// Hasil di aplikasi:
//   Menu Proyek Kontraktor                     -> proyek + tiap baris pengeluaran (HPP) lengkap dengan
//                                                 Qty x Harga, penerima, metode bayar, kode BoQ, link bukti
//   Laporan Divisi > Kontraktor > Pengeluaran  -> otomatis ikut (tanpa input dua kali)
//
// Data: scripts/data/pengeluaran_transcilegon_okt2026.json
//
// CARA PAKAI (dari folder backend):
//   node scripts/importPengeluaranTransCilegon.js --dry   # cek saja, TIDAK menulis ke database
//   node scripts/importPengeluaranTransCilegon.js         # import (aman diulang: baris yang sudah ada dilewati)

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { syncBiayaTx, ringkasProyek } from "../src/routes/proyek.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "data", "pengeluaran_transcilegon_okt2026.json");
const prisma = new PrismaClient();
const dry = process.argv.includes("--dry");
const DIVISI = "Kontraktor";
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const rp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s) => new Date(`${s}T00:00:00.000Z`);

async function kodeCustomerBerikutnya() {
  const all = await prisma.customer.findMany({ select: { kode: true } });
  let maks = 0;
  for (const c of all) {
    const m = /(\d+)\s*$/.exec(c.kode || "");
    if (m) maks = Math.max(maks, Number(m[1]));
  }
  return `TS${maks + 1}`;
}

// Semua info Excel yang tidak punya kolom sendiri di Proyek disimpan di catatan baris, supaya tidak hilang.
function catatanBaris(b) {
  const bagian = [];
  if (b.kategori) bagian.push(`Kategori: ${b.kategori}`);
  if (b.kodeBoq) bagian.push(`Kode BoQ: ${b.kodeBoq}`);
  if (b.dibayarKe) bagian.push(`Dibayar ke: ${b.dibayarKe}`);
  if (b.metode) bagian.push(`Metode: ${b.metode}`);
  if (b.catatanAsli) bagian.push(b.catatanAsli);
  if (b.linkBukti) bagian.push(`Bukti: ${b.linkBukti}`);
  return bagian.join(" | ") || null;
}

async function main() {
  const d = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  const hitung = d.biaya.reduce((s, b) => s + b.qty * b.hargaSatuan, 0);
  console.log(`${dry ? "[dry] " : ""}${d.proyek.nama} (${d.customer}): ${d.biaya.length} baris pengeluaran, total ${rp(hitung)}`);
  // Pengaman seperti importPo.js: kalau total hitungan beda dengan Excel, jangan lanjut.
  if (Math.round(hitung) !== Math.round(d.totalKertas)) {
    console.log(`! Hitungan ${rp(hitung)} beda dengan total Excel ${rp(d.totalKertas)} -> dihentikan`);
    process.exitCode = 1;
    return;
  }

  // Customer: pakai yang sudah ada (mis. dibuat oleh importStokKubus.js), kalau belum ada baru dibuat.
  const semua = await prisma.customer.findMany({ select: { id: true, nama: true } });
  let cust = semua.find((c) => key(c.nama) === key(d.customer) || key(c.nama).includes("transcilegon"));
  console.log(`Customer: ${cust ? `sudah ada (${cust.nama})` : "akan dibuat baru"}`);

  let proyek = await prisma.proyekKontraktor.findFirst({ where: { nama: d.proyek.nama, divisi: DIVISI } });
  console.log(`Proyek: ${proyek ? "sudah ada, dipakai ulang" : "akan dibuat baru"}`);
  if (dry) {
    for (const b of d.biaya) console.log(`  HPP ${rp(b.qty * b.hargaSatuan).padStart(15)}  ${b.tanggal}  ${b.uraian}`);
    console.log("[dry] Tidak ada yang ditulis ke database.");
    return;
  }

  if (!cust) cust = await prisma.customer.create({ data: { kode: await kodeCustomerBerikutnya(), nama: d.customer, divisi: DIVISI } });
  if (!proyek) {
    proyek = await prisma.proyekKontraktor.create({
      data: { nama: d.proyek.nama, divisi: DIVISI, customerId: cust.id, lokasi: d.proyek.lokasi || null, catatan: d.proyek.catatan || null },
    });
    console.log("Proyek dibuat.");
  }

  const ada = await prisma.proyekBiaya.findMany({ where: { proyekId: proyek.id } });
  let urut = ada.reduce((m, b) => Math.max(m, b.urut), -1);
  let baru = 0;
  for (const b of d.biaya) {
    const nominal = b.qty * b.hargaSatuan;
    if (ada.some((x) => x.uraian === b.uraian && x.tanggal.toISOString().slice(0, 10) === b.tanggal && Math.round(x.nominal) === Math.round(nominal))) {
      console.log(`  (sudah ada) ${b.uraian}`);
      continue;
    }
    urut++;
    const dibuat = await prisma.proyekBiaya.create({
      data: {
        proyekId: proyek.id, jenis: "HPP", tanggal: tgl(b.tanggal), uraian: b.uraian,
        qty: b.qty, satuan: b.satuan || null, hargaSatuan: b.hargaSatuan, nominal, catatan: catatanBaris(b), urut,
      },
    });
    await syncBiayaTx(proyek, dibuat);
    baru++;
    console.log(`  + ${rp(nominal).padStart(15)}  ${b.uraian}`);
  }

  const lengkap = await prisma.proyekKontraktor.findUnique({
    where: { id: proyek.id },
    include: { invoices: { include: { items: true, pembayaran: true } }, biaya: true, customer: { select: { id: true, nama: true } } },
  });
  const r = ringkasProyek(lengkap).ringkasan;
  console.log(`Baris baru: ${baru}. Total pengeluaran proyek sekarang ${rp(r.hppBersih)} (Excel: ${rp(d.totalKertas)} untuk ${d.biaya.length} baris).`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
