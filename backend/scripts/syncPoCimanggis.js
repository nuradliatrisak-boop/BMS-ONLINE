// Sinkron PO WADUK CIMANGGIS (PT Leotunggal Mandiri) sesuai "Rekap PO Cimanggis Masuk-Keluar" (PDF)
// dan alexander.xls.
//
// Yang dilakukan:
//   1. Membuat PO yang belum ada di database (dari scripts/data/po_batch*.json):
//      PO 56/LTM-WADUK CIMANGGIS/X/2026 dan penampung "TANPA PO" (makadam tronton OA 074 yang
//      dikirim tanpa PO, supaya ikut tampil di Rekap PO).
//   2. Merapikan pengiriman hasil importPoProgres.js lama yang salah PO / usang
//      (mis. OA 090 batu belah & pasir tronton yang tadinya masuk PO 39 / 44, padahal PO 51).
//   3. Mencatat pengiriman yang belum ada (OA 090 makadam -> PO 48/51/56, OA 074 makadam tanpa PO,
//      OA 126 sirtu -> PO 08).
//   4. Menyamakan presisi qty (4 desimal dari Excel) supaya total di Rekap PO sama dengan PDF.
//
// Yang disentuh HANYA pengiriman PO Waduk Cimanggis (divisi Supplier) yang catatannya diawali
// "Excel Pak Adi". Catatan pengiriman manual & upah kuli tidak diubah.
//
// CARA PAKAI (dari folder backend):
//   node scripts/syncPoCimanggis.js --dry   # cek saja, TIDAK menulis ke database
//   node scripts/syncPoCimanggis.js         # jalankan (aman diulang)

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "data");
const prisma = new PrismaClient();
const dry = process.argv.includes("--dry");

const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const r2 = (x) => Math.round(x * 100) / 100;
const hari = (d) => new Date(d).toISOString().slice(0, 10);
const K_PROYEK = key("LTM-WADUK CIMANGGIS");
const K_TANPA = key("TANPA PO");
const dalamScope = (no) => key(no).includes(K_PROYEK) || key(no).startsWith(K_TANPA);
const sig = (poId, itemId, tgl, noSj, catatan) => [poId, itemId, hari(tgl), String(noSj || "").trim(), String(catatan || "").trim()].join("|");
const baca = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf-8"));

async function main() {
  console.log(`=== SINKRON PO WADUK CIMANGGIS ${dry ? "(DRY RUN)" : ""} ===\n`);
  const files = fs.readdirSync(DATA).filter((f) => /^po_.*\.json$/.test(f)).sort();
  const defs = files.flatMap((f) => baca(f)).filter((r) => dalamScope(r.no));
  const prog = baca("progres_po_alexander.json").pengiriman.filter((r) => dalamScope(r.poNo));

  // ---- 1. PO yang belum ada
  const customers = await prisma.customer.findMany({ select: { id: true, nama: true } });
  const custByKey = new Map(customers.map((c) => [key(c.nama), c]));
  const ada = new Set((await prisma.purchaseOrder.findMany({ select: { no: true } })).map((p) => key(p.no)));
  let poBaru = 0;
  for (const r of defs) {
    if (ada.has(key(r.no))) { console.log(`PO sudah ada, dilewati: ${r.no}`); continue; }
    const total = r.items.reduce((s, i) => s + i.qty * i.hargaSatuan, 0);
    if (r.totalKertas != null && Math.round(total) !== Math.round(r.totalKertas)) { console.log(`DILEWATI ${r.no}: total beda dengan kertas`); continue; }
    const cust = custByKey.get(key(r.namaCustomer));
    console.log(`${dry ? "[dry] " : ""}PO dibuat: ${r.no}`);
    if (!dry) {
      await prisma.purchaseOrder.create({
        data: {
          no: r.no, divisi: r.divisi || "Supplier", tanggal: new Date(`${r.tanggal}T00:00:00.000Z`),
          customerId: cust?.id || null, namaCustomer: cust ? null : r.namaCustomer || null,
          proyek: r.proyek || null, lokasiProyek: r.lokasiProyek || null, kepalaProyek: r.kepalaProyek || null,
          penerimaBarang: r.penerimaBarang || null, catatan: r.catatan || null, ppnPersen: r.ppnPersen || 0,
          items: { create: r.items.map((i, n) => ({ urut: n, uraian: i.uraian, satuan: i.satuan || null, qty: i.qty, hargaSatuan: i.hargaSatuan || 0 })) },
        },
      });
    }
    poBaru++;
  }

  // ---- 2. PO dalam scope (setelah PO baru dibuat)
  const semua = await prisma.purchaseOrder.findMany({ where: { batal: false }, include: { items: true, pengiriman: true } });
  const poScope = [...new Map(semua.filter((p) => p.divisi === "Supplier" && dalamScope(p.no)).map((p) => [p.id, p])).values()];
  const poByKey = new Map(poScope.map((p) => [key(p.no), p]));
  console.log(`\nPO material proyek ini di database: ${poScope.length} | baris Excel yang relevan: ${prog.length}`);

  // pengiriman yang diinginkan
  const inginkan = new Map(); // sig -> { po, item, r }
  const lewat = [];
  for (const r of prog) {
    const po = poByKey.get(key(r.poNo));
    if (!po) { lewat.push(`${r.poNo} (PO belum ada di database${dry ? " - normal saat dry run" : ""})`); continue; }
    const item = po.items.find((i) => i.uraian === r.uraian);
    if (!item) { lewat.push(`${r.poNo} | ${r.uraian} (barang tidak ketemu)`); continue; }
    inginkan.set(sig(po.id, item.id, r.tanggal, r.noSuratJalan, r.catatan), { po, item, r });
  }

  // pengiriman yang ada
  const hapusList = [], presisi = [], sudah = new Set();
  for (const po of poScope) {
    for (const k of po.pengiriman) {
      if (!String(k.catatan || "").startsWith("Excel Pak Adi")) continue; // catatan manual jangan disentuh
      const sg = sig(po.id, k.itemId, k.tanggal, k.noSuratJalan, k.catatan);
      const mau = inginkan.get(sg);
      if (!mau || sudah.has(sg)) { hapusList.push({ po, k }); continue; }
      sudah.add(sg);
      if (Math.abs(mau.r.qty - k.qty) > 1e-6) presisi.push({ k, q: mau.r.qty });
    }
  }
  const tambah = [...inginkan.entries()].filter(([sg]) => !sudah.has(sg)).map(([, v]) => v);

  console.log(`\nSalah PO / usang yang akan DIHAPUS: ${hapusList.length}`);
  hapusList.forEach(({ po, k }) => console.log(`  - ${po.no} | ${po.items.find((i) => i.id === k.itemId)?.uraian} | ${hari(k.tanggal)} | ${k.qty} | SJ ${k.noSuratJalan}`));
  console.log(`\nQty yang akan DISAMAKAN presisinya dengan Excel: ${presisi.length}`);
  console.log(`\nPengiriman yang akan DICATAT: ${tambah.length}`);
  tambah.forEach(({ po, item, r }) => console.log(`  + ${po.no} | ${item.uraian} | ${r.tanggal} | ${r.qty} | SJ ${r.noSuratJalan}`));

  if (!dry) {
    for (const { k } of hapusList) await prisma.poPengiriman.delete({ where: { id: k.id } });
    for (const x of presisi) await prisma.poPengiriman.update({ where: { id: x.k.id }, data: { qty: x.q } });
    for (const { po, item, r } of tambah) {
      await prisma.poPengiriman.create({
        data: { poId: po.id, itemId: item.id, tanggal: new Date(`${r.tanggal}T00:00:00.000Z`), qty: r.qty, noSuratJalan: r.noSuratJalan || null, catatan: r.catatan || null },
      });
    }
  }

  // ---- ringkasan (simulasi hasil akhir)
  const gone = new Set(hapusList.map((h) => h.k.id));
  const qtyBaru = new Map(presisi.map((p) => [p.k.id, p.q]));
  console.log("\nHasil akhir (qty PO | terkirim | sisa):");
  for (const po of [...poScope].sort((a, b) => hari(a.tanggal).localeCompare(hari(b.tanggal)))) {
    console.log(`  ${po.no}`);
    for (const it of po.items) {
      let t = po.pengiriman.filter((k) => k.itemId === it.id && !gone.has(k.id)).reduce((s, k) => s + (qtyBaru.get(k.id) ?? k.qty), 0);
      t += tambah.filter((x) => x.po.id === po.id && x.item.id === it.id).reduce((s, x) => s + x.r.qty, 0);
      console.log(`      ${it.uraian.padEnd(36)} ${String(it.qty).padStart(5)} | ${r2(t).toFixed(2).padStart(7)} | ${r2(Math.max(it.qty - t, 0)).toFixed(2).padStart(7)}${t > it.qty ? `  (lebih ${r2(t - it.qty)})` : ""}`);
    }
  }
  console.log(`\nPO baru: ${poBaru} | pengiriman dihapus: ${hapusList.length} | dicatat: ${tambah.length} | presisi disamakan: ${presisi.length}`);
  if (lewat.length) { console.log("\nDilewati:"); lewat.forEach((l) => console.log("  - " + l)); }
  console.log('\nCatatan: invoice OA 126 (29 Okt) baris Batu Belah SJ 3559 tidak punya PO yang cocok -> tidak dicatat.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
