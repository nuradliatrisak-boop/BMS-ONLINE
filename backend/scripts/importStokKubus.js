// Catat STOK KUBUS MASIF (total 11.000) untuk PT. Trans Cilegon - proyek Tanggul Dermaga
// (dari gambar Excel: No, Tanggal, No Surat, QTY, Total sisa) sebagai Purchase Order + pengiriman.
//   Hasil di aplikasi: menu Purchase Order -> kartu stok (terkirim 1.800, sisa 9.200),
//   tombol Excel/PDF di PO itu mencetak kartu stok lengkap dengan kolom Upah Kuli.
//   Kolom Upah Kuli diisi per baris pengiriman di menu PO; otomatis masuk Laporan Divisi > Pengeluaran.
// Divisi PO ada di konstanta DIVISI_PO di bawah (ubah kalau stok ini milik divisi lain).
// CARA PAKAI (dari folder backend, SETELAH `npx prisma migrate deploy`):
//   node scripts/importStokKubus.js --dry   |   node scripts/importStokKubus.js   (aman diulang)
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { syncUpahKuliTx } from "../src/services/poUpahKuli.js";

const DIVISI_PO = "Kontraktor";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "stok_kubus_trans_cilegon.json"), "utf-8"));
const prisma = new PrismaClient();
const dry = process.argv.includes("--dry");
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const tgl = (s) => new Date(`${s}T00:00:00.000Z`);

async function kodeBerikutnya() {
  const all = await prisma.customer.findMany({ select: { kode: true } });
  let maks = 0;
  for (const c of all) { const m = /(\d+)\s*$/.exec(c.kode || ""); if (m) maks = Math.max(maks, Number(m[1])); }
  return `TS${maks + 1}`;
}

async function main() {
  const total = d.pengiriman.reduce((s, p) => s + p.qty, 0);
  console.log(`${dry ? "[dry] " : ""}${d.barang.uraian} ${d.barang.qty} ${d.barang.satuan} - ${d.customer} - ${d.proyek}: ${d.pengiriman.length} pengiriman, terkirim ${total}, sisa ${d.barang.qty - total}`);
  const semua = await prisma.customer.findMany({ select: { id: true, nama: true } });
  let cust = semua.find((c) => key(c.nama) === key(d.customer) || key(c.nama).includes("transcilegon"));
  console.log(`Customer: ${cust ? "sudah ada (" + cust.nama + ")" : "akan dibuat baru"}`);
  if (dry) return;
  if (!cust) cust = await prisma.customer.create({ data: { kode: await kodeBerikutnya(), nama: d.customer, divisi: DIVISI_PO } });

  let po = await prisma.purchaseOrder.findUnique({ where: { no: d.po }, include: { items: true, pengiriman: true } });
  if (!po) {
    po = await prisma.purchaseOrder.create({
      data: { no: d.po, divisi: DIVISI_PO, tanggal: tgl(d.pengiriman.map((p) => p.tanggal).sort()[0]), customerId: cust.id, proyek: d.proyek, catatan: `Dari ${d.sumber}. Nomor PO sementara -- ganti lewat Edit PO bila ada nomor aslinya.`, items: { create: [{ urut: 0, uraian: d.barang.uraian, satuan: d.barang.satuan, qty: d.barang.qty, hargaSatuan: 0 }] } },
      include: { items: true, pengiriman: true },
    });
    console.log("PO dibuat:", po.no);
  } else console.log("PO sudah ada:", po.no);
  const item = po.items[0];
  let baru = 0;
  for (const p of d.pengiriman) {
    if (po.pengiriman.some((x) => x.itemId === item.id && x.noSuratJalan === p.noSuratJalan)) continue;
    const dibuat = await prisma.poPengiriman.create({ data: { poId: po.id, itemId: item.id, tanggal: tgl(p.tanggal), qty: p.qty, noSuratJalan: p.noSuratJalan, upahKuli: p.upahKuli, catatan: p.catatan || null } });
    if (p.upahKuli) await syncUpahKuliTx(po, item, dibuat);
    baru++;
  }
  console.log(`Pengiriman baru: ${baru}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
