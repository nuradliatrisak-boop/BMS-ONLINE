// Pindahkan CV. Simpink Pesona Nusantara ke divisi KONTRAKTOR + catat rekapan, invoice, dan
// detail pengirimannya (dari CV_SIMPINK2.pdf: Rekapan 002/INV-BMS/X/2026).
//  1. Customer "Simpink" yang sudah ada -> divisinya jadi Kontraktor (kalau belum ada, dibuat).
//  2. Invoice milik customer itu di divisi lain (mis. Kapal) -> divisi Kontraktor.
//  3. Transaksi Laporan Divisi (DivisiTx) di divisi Kapal yang menyebut Simpink -> pindah ke Kontraktor.
//     Yang ada di divisi LAIN (mis. Supplier "Rekap Invoice Tambahan") TIDAK dipindah otomatis,
//     hanya dilaporkan, supaya laporan divisi itu tidak rusak.
//  4. Buat 2 proyek (Pulau Sabira, Pulau Kelapa Dua), 2 invoice + baris detail (tanggal, no. SJ, kapal,
//     qty BH, harga) + pembayaran, ber-No. Rekapan yang sama.
// CARA PAKAI (dari folder backend, SETELAH `npx prisma migrate deploy`):
//   node scripts/importSimpink.js --dry   # cek saja, TIDAK menulis
//   node scripts/importSimpink.js         # jalankan (aman diulang)
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "simpink_okt2026.json"), "utf-8"));
const prisma = new PrismaClient();
const dry = process.argv.includes("--dry");
const DIVISI = "Kontraktor";
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const rp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s) => new Date(`${s}T00:00:00.000Z`);
const mirip = (s) => key(s).includes("simpink") || key(s).includes("simphink");
const statusBayar = (t, b) => (b <= 0 ? "BELUM" : b >= t ? "LUNAS" : "SEBAGIAN");

async function kodeBerikutnya() {
  const all = await prisma.customer.findMany({ select: { kode: true } });
  let maks = 0;
  for (const c of all) { const m = /(\d+)\s*$/.exec(c.kode || ""); if (m) maks = Math.max(maks, Number(m[1])); }
  return `TS${maks + 1}`;
}

async function main() {
  console.log(`${dry ? "[dry] " : ""}Sumber: ${data.sumber}\n`);
  let tagihan = 0, dibayar = 0;
  for (const p of data.proyek) {
    const t = p.invoice.items.reduce((s, i) => s + i.qty * i.hargaSatuan, 0);
    if (Math.round(t) !== Math.round(p.invoice.totalKertas)) throw new Error(`${p.invoice.no}: hitungan ${rp(t)} beda dengan kertas ${rp(p.invoice.totalKertas)}`);
    tagihan += t;
    dibayar += p.invoice.pembayaran.reduce((s, x) => s + x.nominal, 0);
  }

  const semua = await prisma.customer.findMany({ include: { _count: { select: { invoices: true } } } });
  const calon = semua.filter((c) => mirip(c.nama));
  console.log(`Customer mirip "Simpink": ${calon.length ? calon.map((c) => `${c.kode} ${c.nama} [${c.divisi}] (${c._count.invoices} invoice)`).join("; ") : "(belum ada)"}`);
  let cust = calon.sort((a, b) => b._count.invoices - a._count.invoices)[0];
  if (calon.length > 1) console.log("  ! Ada lebih dari satu -- dipakai yang invoice-nya terbanyak. Gabungkan manual lewat menu Customer bila itu orang yang sama.");
  if (!cust) {
    console.log(`  ${dry ? "Akan membuat" : "Membuat"} customer "${data.customer.nama}" di divisi ${DIVISI}`);
    if (!dry) cust = await prisma.customer.create({ data: { kode: await kodeBerikutnya(), nama: data.customer.nama, divisi: DIVISI } });
  } else if (cust.divisi !== DIVISI) {
    console.log(`  ${dry ? "Akan memindah" : "Memindah"} customer ${cust.nama}: ${cust.divisi} -> ${DIVISI}`);
    if (!dry) await prisma.customer.update({ where: { id: cust.id }, data: { divisi: DIVISI } });
  } else console.log("  Customer sudah di divisi Kontraktor");
  const custId = cust?.id;

  if (custId) {
    const lama = await prisma.invoice.findMany({ where: { customerId: custId, divisi: { not: DIVISI } }, select: { id: true, no: true, divisi: true } });
    console.log(`Invoice lama customer ini di divisi lain: ${lama.length}${lama.length ? " -> " + lama.map((i) => `${i.no} [${i.divisi}]`).join(", ") : ""}`);
    if (!dry && lama.length) await prisma.invoice.updateMany({ where: { id: { in: lama.map((i) => i.id) } }, data: { divisi: DIVISI } });
  }

  const txKapal = await prisma.divisiTx.findMany({ where: { divisi: "Kapal", OR: [{ kategori: { contains: "simp", mode: "insensitive" } }, { keterangan: { contains: "simp", mode: "insensitive" } }, { subKategori: { contains: "simp", mode: "insensitive" } }] } });
  console.log(`Transaksi Laporan Divisi di Kapal yang menyebut Simpink: ${txKapal.length}${txKapal.length ? " (total " + rp(txKapal.reduce((s, t) => s + t.nominal, 0)) + ")" : ""}`);
  if (!dry && txKapal.length) await prisma.divisiTx.updateMany({ where: { id: { in: txKapal.map((t) => t.id) } }, data: { divisi: DIVISI } });
  const txLain = await prisma.divisiTx.findMany({ where: { divisi: { notIn: ["Kapal", DIVISI] }, OR: [{ kategori: { contains: "simp", mode: "insensitive" } }, { keterangan: { contains: "simp", mode: "insensitive" } }] } });
  if (txLain.length) {
    console.log(`\n! ${txLain.length} transaksi Laporan Divisi di divisi LAIN menyebut Simpink (TIDAK dipindah otomatis):`);
    for (const t of txLain) console.log(`   [${t.divisi}/${t.kelompok}] ${t.tanggal.toISOString().slice(0, 10)} ${t.kategori} ${rp(t.nominal)} - ${(t.keterangan || "").slice(0, 70)}`);
    console.log("  Cek: kalau ini tagihan yang sama dengan invoice baru di bawah, hapus/pindahkan satu supaya tidak terhitung dobel.");
  }

  console.log();
  for (const p of data.proyek) {
    const inv = p.invoice;
    const total = inv.items.reduce((s, i) => s + i.qty * i.hargaSatuan, 0);
    const bayar = inv.pembayaran.reduce((s, x) => s + x.nominal, 0);
    console.log(`=== ${p.nama} === ${inv.no}: ${inv.items.length} baris, tagihan ${rp(total)}, dibayar ${rp(bayar)}, sisa ${rp(total - bayar)}`);
    if (dry || !custId) continue;
    let proyek = await prisma.proyekKontraktor.findFirst({ where: { nama: p.nama, divisi: DIVISI, customerId: custId } });
    if (!proyek) proyek = await prisma.proyekKontraktor.create({ data: { nama: p.nama, divisi: DIVISI, customerId: custId, lokasi: p.lokasi, catatan: p.catatan } });
    const ada = await prisma.invoice.findUnique({ where: { no: inv.no } });
    if (ada) {
      console.log("  Invoice sudah ada (dilewati); nomor rekap / proyek dilengkapi bila kosong");
      await prisma.invoice.update({ where: { id: ada.id }, data: { divisi: DIVISI, noRekap: ada.noRekap || data.noRekap, proyekId: ada.proyekId || proyek.id } });
      continue;
    }
    await prisma.invoice.create({
      data: {
        no: inv.no, divisi: DIVISI, customerId: custId, tanggal: tgl(inv.tanggal), noRekap: data.noRekap, proyekId: proyek.id, status: statusBayar(total, bayar),
        items: { create: inv.items.map((i) => ({ keterangan: i.keterangan, tglPakai: tgl(i.tglPakai), qty: i.qty, satuan: i.satuan, hargaSatuan: i.hargaSatuan })) },
        pembayaran: { create: inv.pembayaran.map((x) => ({ tanggal: tgl(x.tanggal), nominal: x.nominal, metode: x.metode })) },
      },
    });
    console.log("  Invoice dibuat");
  }
  console.log(`\nTOTAL: tagihan ${rp(tagihan)} | dibayar ${rp(dibayar)} | sisa ${rp(tagihan - dibayar)}  (kertas: ${rp(data.kertas.tagihan)} / ${rp(data.kertas.dibayar)} / ${rp(data.kertas.sisa)})`);
  if (dry) console.log("[dry] Tidak ada yang ditulis ke database.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
