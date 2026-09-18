// Import SEMUA transaksi "Uang Jalan Sopir" & "Pembelian Material" (per
// kendaraan Armada, kelompok "operasional") untuk periode 31 Agustus - 18
// September 2026, hasil transkrip catatan tangan sopir + foto tabel index.
//
// SUMBER DATA (3 tahap, beda tingkat kepercayaan):
//   1. data/csv1_31agu_5sep.csv       -> user ketik ulang sendiri = AKURAT
//   2. data/csv2_2sep_7sep_draft.csv  -> transkrip awal Claude, tingkat
//                                        yakin SEDANG/RENDAH per baris
//   3. data/new_entries_7sep_18sep.js -> transkrip lanjutan dari foto yang
//                                        di-upload ulang (lebih jelas),
//                                        tanggal 7-18 Sept, tingkat yakin
//                                        SEDANG/RENDAH per baris juga
//
// PENTING: karena sumber tulisan tangan aslinya banyak yang buram/coret-
// coret, sebagian besar nominal & tujuan di sini adalah PERKIRAAN. Baris
// dengan tingkat yakin RENDAH/SEDANG ditandai di kolom `keterangan` (jadi
// kelihatan di halaman Armada / Rekap Armada) SUPAYA GAMPANG DICEK ULANG.
// Silakan edit/hapus/koreksi langsung dari menu Armada (CRUD sudah aktif) -
// tidak perlu jalankan ulang script ini untuk koreksi kecil.
//
// AMAN dijalankan berkali-kali: tiap baris ditandai lewat kolom `sumber`
// dengan tag unik (mis. "UANG_JALAN_IMPORT:2026-09-07:B 9789 UYW:Uang Jalan
// Sopir:0"). Kalau tag itu sudah ada di database, baris itu DILEWATI (tidak
// dobel). Kalau mau re-import dari nol (mis. setelah revisi besar), hapus
// dulu transaksi lama dari menu Armada, baru jalankan lagi.
//
// CARA PAKAI (dari folder backend/):
//   node scripts/importUangJalanSopir.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import prisma from "../src/prismaClient.js";
import { NEW_COLD_DIESEL, NEW_TRONTON } from "./data/new_entries_7sep_18sep.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAG_PREFIX = "UANG_JALAN_IMPORT:";

// ---------------------------------------------------------------------
// Roster fallback (sama seperti seedArmadaIndex.js) - dipakai kalau nama
// sopir tidak ketemu di tabel Armada database (mis. script ini dijalankan
// sebelum seedArmadaIndex.js).
// ---------------------------------------------------------------------
const ROSTER = {
  // Tronton
  purnomo: "B 9372 UYZ",
  miskun: "B 9534 UIS",
  yadi: "B 9598 UVY",
  tajri: "B 9656 UYX",
  tairi: "B 9656 UYX",
  anto: "B 9659 UYY",
  tono: "B 9847 UIU",
  pandi: "B 9848 UIU",
  pardi: "B 9848 UIU", // salah tulis "Pardi" -> Pandi (tidak ada nama Pardi di 27 sopir)
  aswer: "B 9244 UYW",
  eman: "B 9320 UIS",
  // Cold Diesel
  edi: "B 9069 UIS",
  dargo: "B 9086 UYY",
  darso: "B 9086 UYY",
  alex: "B 9188 UYX",
  yanto: "B 9201 UYZ",
  parno: "B 9305 UYX",
  parru: "B 9305 UYX",
  rudi: "B 9488 UYX",
  kariadi: "B 9489 UYX",
  harindi: "B 9489 UYX", // dugaan: "Harind(i)" di catatan = Kariadi
  harind: "B 9489 UYX",
  hariadi: "B 9489 UYX",
  ipul: "B 9520 UIS",
  epul: "B 9520 UIS",
  nanang: "B 9661 UYW",
  nanan: "B 9661 UYW",
  naran: "B 9661 UYW",
  nano: "B 9661 UYW",
  yumi: "B 9715 UYW",
  gumi: "B 9715 UYW",
  aceng: "B 9782 UYV",
  acong: "B 9782 UYV",
  acory: "B 9782 UYV",
  wartono: "B 9789 UYW",
  wartuno: "B 9789 UYW",
  warfuru: "B 9789 UYW",
  warfono: "B 9789 UYW",
  iskak: "B 9878 UYV",
  iskan: "B 9878 UYV",
  ishan: "B 9878 UYV",
  isnan: "B 9878 UYV",
  isman: "B 9878 UYV",
  khan: "B 9489 UYX", // dugaan: coretan "Khan/Khaola" tanggal 10 & 17 Sept = Kariadi
  khaola: "B 9489 UYX",
};

function normName(s) {
  return (s || "").toLowerCase().replace(/\(.*\)/g, "").trim();
}

async function resolveNopol(armadaByName, sopirRaw, nopolHint) {
  if (nopolHint && nopolHint !== "?" && nopolHint !== "(?)" && !/^\(/.test(nopolHint)) {
    return nopolHint.trim();
  }
  const key = normName(sopirRaw);
  if (armadaByName.has(key)) return armadaByName.get(key);
  if (ROSTER[key]) return ROSTER[key];
  // nama ganda "A/B" atau "A (tertulis B)" - coba tiap bagian satu-satu
  const parts = key.split(/[\/,]| tertulis | dugaan /).map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    if (armadaByName.has(p)) return armadaByName.get(p);
    if (ROSTER[p]) return ROSTER[p];
  }
  // coba cocokkan parsial (mis. "Tajri (tertulis Tairi)")
  for (const [nama, nopol] of armadaByName.entries()) {
    if (key.includes(nama) || nama.includes(key)) return nopol;
  }
  for (const [nama, nopol] of Object.entries(ROSTER)) {
    if (parts.some((p) => p.includes(nama) || nama.includes(p))) return nopol;
  }
  return null;
}

// Parser CSV sederhana yang tahan koma di dalam tanda kutip ("...")
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // skip
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

function extractNumbers(text) {
  if (!text) return [];
  const matches = text.match(/[\d.]{4,}/g) || [];
  return matches
    .map((m) => parseInt(m.replace(/\./g, ""), 10))
    .filter((n) => !Number.isNaN(n) && n > 0);
}

async function upsertTx({ tanggal, nopol, jenis, kategori, nominal, keterangan, tagSuffix }) {
  if (!nominal || nominal <= 0) return false;
  const sumber = `${TAG_PREFIX}${tanggal}:${nopol}:${kategori}:${tagSuffix}`;
  const existing = await prisma.divisiTx.findFirst({ where: { sumber } });
  if (existing) return false;

  await prisma.divisiTx.create({
    data: {
      divisi: "Armada",
      tipe: "PENGELUARAN",
      kelompok: "operasional",
      kategori,
      subKategori: nopol,
      keterangan,
      nominal,
      tanggal: new Date(`${tanggal}T00:00:00.000Z`),
      sumber,
    },
  });
  return true;
}

async function main() {
  const armadaList = await prisma.armada.findMany({
    where: { divisi: { not: undefined } },
    select: { nopol: true, sopir: true },
  });
  const armadaByName = new Map();
  for (const a of armadaList) {
    if (a.sopir) armadaByName.set(normName(a.sopir), a.nopol);
  }

  let created = 0;
  let skipped = 0;
  let unresolved = [];

  // ---------- 1. CSV1 (31 Agu - 5 Sep, AKURAT) ----------
  const csv1Path = path.join(__dirname, "data", "csv1_31agu_5sep.csv");
  const csv1Rows = parseCsv(fs.readFileSync(csv1Path, "utf-8"));
  const csv1Header = csv1Rows.shift();
  for (let i = 0; i < csv1Rows.length; i++) {
    const r = csv1Rows[i];
    if (r.length < 6) continue;
    const [tanggal, nopolCol, sopir, , kategori, nominalStr, keteranganCol, tujuan] = r;
    const nopol = await resolveNopol(armadaByName, sopir, nopolCol);
    if (!nopol) {
      unresolved.push(`CSV1 baris ${i + 2}: sopir "${sopir}" tanggal ${tanggal}`);
      continue;
    }
    const nominal = parseInt((nominalStr || "0").replace(/[^\d]/g, ""), 10);
    const keterangan = [keteranganCol, tujuan].filter(Boolean).join(" | ") || null;
    const ok = await upsertTx({
      tanggal,
      nopol,
      kategori,
      nominal,
      keterangan,
      tagSuffix: `csv1-${i}`,
    });
    ok ? created++ : skipped++;
  }

  // ---------- 2. CSV2 (2-7 Sep, DRAFT - SEDANG/RENDAH) ----------
  const csv2Path = path.join(__dirname, "data", "csv2_2sep_7sep_draft.csv");
  const csv2Rows = parseCsv(fs.readFileSync(csv2Path, "utf-8"));
  const csv2Header = csv2Rows.shift();
  for (let i = 0; i < csv2Rows.length; i++) {
    const r = csv2Rows[i];
    if (r.length < 9) continue;
    const [tanggal, , sopirTulis, sopirDugaan, nopolDugaan, ujsBreakdown, materialStr, tujuan, yakin] = r;
    // Baris rentang tanggal ringkasan (2026-09-08 s/d 2026-09-13) sudah
    // digantikan oleh data harian di new_entries_7sep_18sep.js -> dilewati.
    if (tanggal.includes(" s/d ")) continue;

    const sopirPakai = sopirDugaan && !sopirDugaan.startsWith("(") ? sopirDugaan : sopirTulis;
    const nopol = await resolveNopol(armadaByName, sopirPakai, nopolDugaan);
    if (!nopol) {
      unresolved.push(`CSV2 baris ${i + 2}: sopir "${sopirTulis}" tanggal ${tanggal}`);
      continue;
    }
    const tag = `[${yakin || "RENDAH"}] `;
    const ujsNumbers = extractNumbers(ujsBreakdown);
    const ujsTotal = ujsNumbers.reduce((a, b) => a + b, 0);
    let okAny = false;
    if (ujsTotal > 0) {
      const ok = await upsertTx({
        tanggal,
        nopol,
        kategori: "Uang Jalan Sopir",
        nominal: ujsTotal,
        keterangan: `${tag}${ujsBreakdown || ""} ${tujuan ? "| Tujuan: " + tujuan : ""}`.trim(),
        tagSuffix: `csv2-ujs-${i}`,
      });
      okAny = okAny || ok;
      ok ? created++ : skipped++;
    }
    const materialNum = extractNumbers(materialStr)[0];
    if (materialNum) {
      const ok = await upsertTx({
        tanggal,
        nopol,
        kategori: "Pembelian Material",
        nominal: materialNum,
        keterangan: `${tag}${tujuan ? "Tujuan: " + tujuan : ""}`.trim(),
        tagSuffix: `csv2-mat-${i}`,
      });
      ok ? created++ : skipped++;
    }
  }

  // ---------- 3. Data baru Cold Diesel & Tronton (7-18 Sep) ----------
  const newRows = [...NEW_COLD_DIESEL, ...NEW_TRONTON];
  for (let i = 0; i < newRows.length; i++) {
    const row = newRows[i];
    const nopol = await resolveNopol(armadaByName, row.sopir, null);
    if (!nopol) {
      unresolved.push(`Data baru #${i}: sopir "${row.sopir}" tanggal ${row.tanggal}`);
      continue;
    }
    const tag = `[${row.confidence}] `;
    const ok1 = await upsertTx({
      tanggal: row.tanggal,
      nopol,
      kategori: "Uang Jalan Sopir",
      nominal: row.ujs,
      keterangan: `${tag}${row.ujsKet || ""} | Tujuan: ${row.tujuan || "-"}`,
      tagSuffix: `new-ujs-${i}`,
    });
    ok1 ? created++ : skipped++;
    if (row.material) {
      const ok2 = await upsertTx({
        tanggal: row.tanggal,
        nopol,
        kategori: "Pembelian Material",
        nominal: row.material,
        keterangan: `${tag}Tujuan: ${row.tujuan || "-"}`,
        tagSuffix: `new-mat-${i}`,
      });
      ok2 ? created++ : skipped++;
    }
  }

  console.log(`\n== Selesai ==`);
  console.log(`Transaksi baru dibuat : ${created}`);
  console.log(`Dilewati (sudah ada)  : ${skipped}`);
  if (unresolved.length) {
    console.log(`\nTIDAK BISA DIPROSES (nama sopir tidak ketemu, ${unresolved.length} baris):`);
    unresolved.forEach((u) => console.log(`  - ${u}`));
    console.log(`\nBaris di atas dilewati. Tambahkan manual dari menu Armada kalau perlu.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
