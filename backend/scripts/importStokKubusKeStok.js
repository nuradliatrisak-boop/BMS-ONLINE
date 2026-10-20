// Masukkan STOK KUBUS MASIF (11.000 BH, PT. Trans Cilegon - Tanggul Dermaga) ke menu STOK
// beserta 7 surat jalan keluarnya (sisa 8.900). Data sama dengan importStokKubus.js
// (scripts/data/stok_kubus_trans_cilegon.json), tapi masuk ke menu Stok, bukan menu PO.
//
// PENTING: PO Kubus Masif yang sudah ada di menu Purchase Order TIDAK diubah. Supaya upah kuli
// tidak tercatat dobel di Laporan Divisi, isi kolom Upah Kuli HANYA di salah satu menu (disarankan di Stok).
//
// CARA PAKAI (dari folder backend, SETELAH `npx prisma migrate deploy`):
//   node scripts/importStokKubusKeStok.js --dry   |   node scripts/importStokKubusKeStok.js   (aman diulang)
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { syncStokUpahKuliTx } from "../src/services/stokUpahKuli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "stok_kubus_trans_cilegon.json"), "utf-8"));
const prisma = new PrismaClient();
const dry = process.argv.includes("--dry");
const tgl = (s) => new Date(`${s}T00:00:00.000Z`);

async function main() {
  const total = d.pengiriman.reduce((s, p) => s + p.qty, 0);
  console.log(`${dry ? "[dry] " : ""}${d.barang.uraian} ${d.barang.qty} ${d.barang.satuan} - ${d.customer} - ${d.proyek}: ${d.pengiriman.length} baris keluar, total ${total}, sisa ${d.barang.qty - total}`);
  let stok = await prisma.stokBarang.findFirst({ where: { nama: d.barang.uraian, proyek: d.proyek } });
  console.log(`Barang di menu Stok: ${stok ? "sudah ada, dipakai ulang" : "akan dibuat baru"}`);
  if (dry) return;
  if (!stok) {
    stok = await prisma.stokBarang.create({
      data: { nama: d.barang.uraian, kategori: "Kubus", satuan: d.barang.satuan, divisi: d.divisi || "Kontraktor", namaCustomer: d.customer, proyek: d.proyek, qtyAwal: d.barang.qty, catatan: `Dari ${d.sumber}` },
    });
  }
  const ada = await prisma.stokMutasi.findMany({ where: { stokId: stok.id } });
  let baru = 0;
  for (const p of d.pengiriman) {
    if (ada.some((x) => x.noSurat === p.noSuratJalan)) continue;
    const m = await prisma.stokMutasi.create({
      data: { stokId: stok.id, tipe: "KELUAR", tanggal: tgl(p.tanggal), qty: p.qty, noSurat: p.noSuratJalan, catatan: p.catatan || null, upahKuli: p.upahKuli || null },
    });
    await syncStokUpahKuliTx(stok, m);
    baru++;
  }
  console.log(`Baris keluar baru: ${baru}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
