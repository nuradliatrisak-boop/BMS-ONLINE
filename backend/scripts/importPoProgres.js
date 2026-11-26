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
//  - PO yang nomornya tidak ketemu di database DIBUAT otomatis (bagian "poTambahan" di JSON) dengan
//    catatan "[TANDAI] PO BELUM DIINPUT ..." dan Jumlah PO = 0. Barang yang belum ada di PO ditambahkan
//    (bagian "itemTambahan") dengan akhiran " [CEK]" dan qty PO 0. Pengirimannya diberi catatan
//    "| TANDAI: ...". Semuanya ditandai supaya mudah dicari & dirapikan setelah dokumen PO asli diinput.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { cariPo, cariItem } from "./lib/cariItemProgres.js";

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

  // ---- PO & barang tambahan (ditandai [TANDAI] / [CEK]) supaya SEMUA data Pak Adi ikut masuk
  const customers = await prisma.customer.findMany({ select: { id: true, nama: true } });
  const custByKey = new Map(customers.map((c) => [key(c.nama), c]));
  let poDibuat = 0;
  let itemDibuat = 0;
  for (const t of data.poTambahan || []) {
    if (cariPo(poByKey, t.no)) continue;
    const cust = custByKey.get(key(t.namaCustomer));
    let po;
    if (!dry) {
      po = await prisma.purchaseOrder.create({
        data: {
          no: t.no, divisi: "Supplier", tanggal: tgl(t.tanggal),
          customerId: cust?.id || null, namaCustomer: cust ? null : t.namaCustomer || null,
          proyek: t.proyek || null, lokasiProyek: t.lokasiProyek || null, catatan: t.catatan || null, ppnPersen: 0,
          items: { create: t.items.map((i, n) => ({ urut: n, uraian: i.uraian, satuan: i.satuan || null, qty: i.qty, hargaSatuan: i.hargaSatuan || 0 })) },
        },
        include: { items: true, pengiriman: true },
      });
    } else {
      po = { id: `dry-${t.no}`, no: t.no, items: t.items.map((i, n) => ({ id: `dry-${t.no}-${n}`, uraian: i.uraian })), pengiriman: [] };
    }
    poByKey.set(key(t.no), po);
    poDibuat++;
  }
  for (const t of data.itemTambahan || []) {
    const po = cariPo(poByKey, t.poNo);
    if (!po || po.items.some((i) => i.uraian === t.uraian) || cariItem(po, { uraian: t.uraian, jenis: t.uraian, satuan: t.satuan, harga: t.hargaSatuan, alat: t.satuan === "jam" || t.satuan === "ls", qty: 0 })) continue;
    const it = dry
      ? { id: `dry-${t.poNo}-${po.items.length}`, uraian: t.uraian }
      : await prisma.purchaseOrderItem.create({ data: { poId: po.id, urut: po.items.length, uraian: t.uraian, satuan: t.satuan || null, qty: t.qty || 0, hargaSatuan: t.hargaSatuan || 0 } });
    po.items.push(it);
    itemDibuat++;
  }
  console.log(`${dry ? "[dry] " : ""}PO baru ditandai [TANDAI]: ${poDibuat} | barang baru ditandai [CEK] di PO yang sudah ada: ${itemDibuat}`);

  let dibuat = 0;
  const sudahAda = [];
  const poHilang = new Map();
  const itemHilang = new Map();
  const perPo = new Map();

  for (const r of rows) {
    const po = cariPo(poByKey, r.poNo);
    if (!po) {
      poHilang.set(r.poNo, (poHilang.get(r.poNo) || 0) + 1);
      continue;
    }
    let item = cariItem(po, r);
    if (!item && /\[CEK\]\s*$/.test(r.uraian)) {
      // barang belum ada di PO (PO asli sudah ada di BMS) -> tambah ditandai [CEK]
      item = dry
        ? { id: `dry-${po.no}-${po.items.length}`, uraian: r.uraian }
        : await prisma.purchaseOrderItem.create({ data: { poId: po.id, urut: po.items.length, uraian: r.uraian, satuan: r.satuan || null, qty: 0, hargaSatuan: r.harga || 0 } });
      po.items.push({ ...item, satuan: r.satuan, hargaSatuan: r.harga || 0 });
      itemDibuat++;
    }
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
