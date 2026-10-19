// Catat REKAP PROYEK KONTRAKTOR (invoice + pembayaran + pengeluaran/HPP + diskon)
// dari invoice cetak & catatan tulisan tangan ke database:
//   - Pulau Tidung            (Bp. Michael)   : invoice BMS - OM001 & OM002
//   - Pasir Bangka Pulau Kelor (PT Arum Anugrah): invoice BMS-AA.001 (17 rit kapal)
//
// Data: scripts/data/proyek_kontraktor_okt2026.json
// Hasil di aplikasi:
//   Menu Invoice (divisi Kontraktor)          -> invoice + baris + pembayaran
//   Menu Proyek Kontraktor                    -> tagihan, HPP, diskon, margin per proyek
//   Laporan Divisi > Kontraktor > Pengeluaran -> pengeluaran proyek (otomatis)
//
// CARA PAKAI (dari folder backend, SETELAH `npx prisma migrate deploy`):
//   node scripts/importProyekKontraktor.js --dry   # cek saja, TIDAK menulis ke database
//   node scripts/importProyekKontraktor.js         # import (aman diulang: yang sudah ada dilewati)

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { syncBiayaTx, ringkasProyek } from "../src/routes/proyek.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "data", "proyek_kontraktor_okt2026.json");
const prisma = new PrismaClient();
const dry = process.argv.includes("--dry");
const DIVISI = "Kontraktor";
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const rp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s) => new Date(`${s}T00:00:00.000Z`);

function statusBayar(total, dibayar) {
  if (dibayar <= 0) return "BELUM";
  if (dibayar >= total) return "LUNAS";
  return "SEBAGIAN";
}

async function kodeCustomerBerikutnya() {
  const all = await prisma.customer.findMany({ select: { kode: true } });
  let maks = 0;
  for (const c of all) {
    const m = /(\d+)\s*$/.exec(c.kode || "");
    if (m) maks = Math.max(maks, Number(m[1]));
  }
  return `TS${maks + 1}`;
}

async function cariAtauBuatCustomer(nama) {
  const semua = await prisma.customer.findMany({ select: { id: true, nama: true, divisi: true } });
  const ada = semua.find((c) => key(c.nama) === key(nama));
  if (ada) return { id: ada.id, baru: false };
  if (dry) return { id: "(baru)", baru: true };
  const c = await prisma.customer.create({
    data: { kode: await kodeCustomerBerikutnya(), nama, divisi: DIVISI },
  });
  return { id: c.id, baru: true };
}

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  console.log(`${dry ? "[dry] " : ""}Data: ${data.proyek.length} proyek\n`);

  for (const px of data.proyek) {
    console.log(`=== ${px.nama} (${px.customer}) ===`);

    // Cek total invoice dulu (sama seperti importPo.js): kalau beda dengan kertas, proyek dilewati.
    let salah = false;
    for (const inv of px.invoices) {
      const total = inv.items.reduce((s, i) => s + i.qty * i.hargaSatuan, 0);
      if (Math.round(total) !== Math.round(inv.totalKertas)) {
        console.log(`  ! ${inv.no}: hitungan ${rp(total)} beda dengan kertas ${rp(inv.totalKertas)} -> proyek dilewati`);
        salah = true;
      }
    }
    if (salah) continue;

    const cust = await cariAtauBuatCustomer(px.customer);
    console.log(`  Customer "${px.customer}": ${cust.baru ? (dry ? "akan dibuat baru" : "dibuat baru") : "sudah ada"}`);

    let proyek = await prisma.proyekKontraktor.findFirst({ where: { nama: px.nama, divisi: DIVISI } });
    if (!proyek) {
      console.log(`  ${dry ? "Akan membuat" : "Membuat"} proyek "${px.nama}"`);
      if (!dry) {
        proyek = await prisma.proyekKontraktor.create({
          data: { nama: px.nama, divisi: DIVISI, customerId: cust.id, lokasi: px.lokasi || null, catatan: px.catatan || null },
        });
      }
    } else {
      console.log(`  Proyek sudah ada, dipakai ulang`);
    }

    // Invoice
    for (const inv of px.invoices) {
      const total = inv.items.reduce((s, i) => s + i.qty * i.hargaSatuan, 0);
      const dibayar = (inv.pembayaran || []).reduce((s, p) => s + p.nominal, 0);
      const ada = await prisma.invoice.findUnique({ where: { no: inv.no } });
      if (ada) {
        console.log(`  Invoice ${inv.no}: sudah ada (dilewati)`);
        if (!dry && proyek && !ada.proyekId) await prisma.invoice.update({ where: { id: ada.id }, data: { proyekId: proyek.id } });
        continue;
      }
      console.log(`  Invoice ${inv.no}: ${inv.items.length} baris, tagihan ${rp(total)}, dibayar ${rp(dibayar)}, status ${statusBayar(total, dibayar)}`);
      if (dry) continue;
      await prisma.invoice.create({
        data: {
          no: inv.no,
          divisi: DIVISI,
          customerId: cust.id,
          tanggal: tgl(inv.tanggal),
          status: statusBayar(total, dibayar),
          proyekId: proyek.id,
          items: {
            create: inv.items.map((i) => ({
              keterangan: i.keterangan,
              qty: i.qty,
              satuan: i.satuan || null,
              hargaSatuan: i.hargaSatuan,
            })),
          },
          pembayaran: {
            create: (inv.pembayaran || []).map((p) => ({ tanggal: tgl(p.tanggal), nominal: p.nominal, metode: p.metode || null })),
          },
        },
      });
    }

    // Pengeluaran / HPP / diskon
    let urut = 0;
    for (const b of px.biaya) {
      urut++;
      if (dry || !proyek) {
        console.log(`  ${b.jenis.padEnd(12)} ${rp(b.nominal).padStart(16)}  ${b.uraian}`);
        continue;
      }
      const ada = await prisma.proyekBiaya.findFirst({ where: { proyekId: proyek.id, jenis: b.jenis, uraian: b.uraian } });
      if (ada) continue;
      const baru = await prisma.proyekBiaya.create({
        data: {
          proyekId: proyek.id,
          jenis: b.jenis,
          tanggal: tgl(px.tanggalBiaya),
          uraian: b.uraian,
          qty: b.qty ?? null,
          satuan: b.satuan ?? null,
          hargaSatuan: b.hargaSatuan ?? null,
          nominal: b.nominal,
          catatan: b.catatan ?? null,
          urut,
        },
      });
      await syncBiayaTx(proyek, baru);
      console.log(`  + ${b.jenis.padEnd(12)} ${rp(b.nominal).padStart(16)}  ${b.uraian}`);
    }

    // Ringkasan akhir dibandingkan dengan catatan tulisan tangan
    if (proyek) {
      const lengkap = await prisma.proyekKontraktor.findUnique({
        where: { id: proyek.id },
        include: {
          invoices: { include: { items: true, pembayaran: true } },
          biaya: true,
          customer: { select: { id: true, nama: true } },
        },
      });
      const r = ringkasProyek(lengkap).ringkasan;
      console.log(`  -> Tagihan ${rp(r.tagihan)} | Dibayar ${rp(r.dibayar)} | Sisa ${rp(r.sisaTagihan)}`);
      console.log(`  -> Pengeluaran bersih ${rp(r.hppBersih)} | Diskon ${rp(r.diskon)} | MARGIN ${rp(r.margin)} (catatan kertas: ${rp(px.kertas.margin)})`);
      if (px.kertas.catatanSelisih) console.log(`     ${px.kertas.catatanSelisih}`);
    }
    console.log();
  }
  if (dry) console.log("[dry] Tidak ada yang ditulis ke database.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
