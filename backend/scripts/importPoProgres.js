// Catat PROGRES / PENGIRIMAN PO dari Excel Pak Adi (alexander.xls = rekapan
// invoice Bp. Alexander) ke tabel PoPengiriman, supaya kolom Terkirim / Sisa /
// Status di menu Purchase Order (PO) terisi dari pesanan Bp. Alexander.
//
// Data sudah dibaca dari Excel -> scripts/data/progres_po_alexander.json
// (tiap baris Excel = 1 pengiriman: tanggal, no. surat jalan, qty, barang PO).
// Baris Excel dicocokkan ke PO lewat kolom "No PO" di rekapan invoice, lalu ke
// barang PO lewat nama barang (Ps. Pasang = Pasir Pasang, Batu Belah = Batu Kali).
//
// CARA PAKAI (dari folder backend):
//   node scripts/importPoProgres.js --dry   # cek saja, TIDAK menulis ke database
//   node scripts/importPoProgres.js         # import (aman diulang: yang sudah ada dilewati)
//
// Catatan:
//  - noSuratJalan diisi nomor SJ dari Excel. Kalau SJ yang sama sudah ada di menu
//    Surat Jalan dengan nomor persis sama, PO tidak menghitungnya dua kali
//    (lihat aturan no. 6 di services/poSuratJalan.js).
//  - PO yang nomornya tidak ketemu di database dilaporkan & dilewati.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "data", "progres_po_alexander.json");
const prisma = new PrismaClient();
const dry = process.argv.includes("--dry");
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const tgl = (s) => new Date(`${s}T00:00:00.000Z`);
const r2 = (x) => Math.round(x * 100) / 100;

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  const rows = data.pengiriman;
  console.log(`Data: ${rows.length} baris pengiriman dari Excel (${data.sumber})`);

  const poList = await prisma.purchaseOrder.findMany({
    include: { items: true, pengiriman: true },
  });
  const poByKey = new Map(poList.map((p) => [key(p.no), p]));

  let dibuat = 0;
  const sudahAda = [];
  const poHilang = new Map();
  const itemHilang = new Map();
  const perPo = new Map();

  for (const r of rows) {
    const po = poByKey.get(key(r.poNo));
    if (!po) {
      poHilang.set(r.poNo, (poHilang.get(r.poNo) || 0) + 1);
      continue;
    }
    const item = po.items.find((i) => i.uraian === r.uraian);
    if (!item) {
      const k = `${r.poNo} | ${r.uraian}`;
      itemHilang.set(k, (itemHilang.get(k) || 0) + 1);
      continue;
    }
    const dup = po.pengiriman.find(
      (k) =>
        k.itemId === item.id &&
        tgl(r.tanggal).getTime() === new Date(k.tanggal).getTime() &&
        Math.abs(k.qty - r.qty) < 0.005 &&
        String(k.noSuratJalan || "") === String(r.noSuratJalan || "") &&
        String(k.catatan || "") === String(r.catatan || "")
    );
    if (dup) {
      sudahAda.push(r);
      continue;
    }
    if (!dry) {
      const baru = await prisma.poPengiriman.create({
        data: {
          poId: po.id,
          itemId: item.id,
          tanggal: tgl(r.tanggal),
          qty: r.qty,
          noSuratJalan: r.noSuratJalan || null,
          catatan: r.catatan || null,
        },
      });
      po.pengiriman.push(baru);
    }
    dibuat++;
    const p = perPo.get(po.no) || {};
    p[item.uraian] = r2((p[item.uraian] || 0) + r.qty);
    perPo.set(po.no, p);
  }

  console.log(`\n${dry ? "[dry] Akan dicatat" : "Berhasil dicatat"}: ${dibuat} pengiriman di ${perPo.size} PO`);
  for (const [no, p] of perPo) {
    console.log(`  ${no}`);
    for (const [u, q] of Object.entries(p)) console.log(`      + ${q}  ${u}`);
  }
  if (sudahAda.length) console.log(`\nSudah ada sebelumnya (dilewati): ${sudahAda.length}`);
  if (poHilang.size) {
    console.log(`\nNomor PO tidak ada di database (dilewati):`);
    for (const [n, c] of poHilang) console.log(`  - ${n} (${c} baris)`);
  }
  if (itemHilang.size) {
    console.log(`\nBarang tidak ketemu di PO (dilewati):`);
    for (const [n, c] of itemHilang) console.log(`  - ${n} (${c} baris)`);
  }
  if (data.tidakTercatat?.length) {
    console.log(`\nBaris Excel yang barangnya TIDAK ada di PO yang tertulis di invoice-nya (tidak dicatat): ${data.tidakTercatat.length}`);
    console.log(`  Detail ada di bagian "tidakTercatat" di ${path.basename(FILE)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
