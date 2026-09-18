// Seed/update data master Armada (Nopol, Sopir, Index P-L-T, Volume) dari
// tabel "INDEK MOBIL" (Tronton & Colt Diesel) yang difoto user.
//
// Cara pakai (dari folder backend/):
//   node scripts/seedArmadaIndex.js
//
// Aman dijalankan berkali-kali: pakai upsert by nopol (nopol dinormalisasi
// huruf besar + tanpa spasi ganda), jadi kalau nopol sudah ada datanya akan
// di-UPDATE (bukan dobel), kalau belum ada akan dibuat baru dengan
// divisi default "Armada".
//
// CATATAN: kolom Volume utk Colt Diesel tidak ada di foto sumber, jadi
// dihitung otomatis = panjang x lebar x tinggi.

import prisma from "../src/prismaClient.js";
import { buildDefaultDokumenData } from "../src/config/dokumenConfig.js";

const TRONTON = [
  { nopol: "B 9244 UYW", sopir: "Aswer", p: 5.6, l: 2.35, t: 1.69, vol: 22.24 },
  { nopol: "B 9320 UIS", sopir: "Eman", p: 6.0, l: 2.3, t: 1.75, vol: 24.15 },
  { nopol: "B 9372 UYZ", sopir: "Purnomo", p: 6.1, l: 2.35, t: 1.67, vol: 23.939 },
  { nopol: "B 9534 UIS", sopir: "Miskun", p: 6.0, l: 2.4, t: 1.75, vol: 25.2 },
  { nopol: "B 9598 UVY", sopir: "Yadi", p: 5.9, l: 2.35, t: 1.77, vol: 24.541 },
  { nopol: "B 9635 UYZ", sopir: "", p: 6.1, l: 2.35, t: 1.72, vol: 24.656 },
  { nopol: "B 9656 UYX", sopir: "Tajri", p: 6.1, l: 2.35, t: 1.7, vol: 24.37 },
  { nopol: "B 9659 UYY", sopir: "Anto", p: 6.0, l: 2.35, t: 1.75, vol: 24.675 },
  { nopol: "B 9661 UYY", sopir: "", p: 5.9, l: 2.3, t: 1.7, vol: 23.069 },
  { nopol: "B 9847 UIU", sopir: "Tono", p: 6.2, l: 2.3, t: 1.7, vol: 24.242 },
  { nopol: "B 9848 UIU", sopir: "Pandi", p: 6.2, l: 2.3, t: 1.7, vol: 24.242 },
  { nopol: "B 9862 UYX", sopir: "", p: 5.9, l: 2.3, t: 1.7, vol: 23.069 },
  { nopol: "B 9924 LJ", sopir: "", p: 5.5, l: 2.35, t: 1.4, vol: 18.095 },
];

const COLT_DIESEL = [
  { nopol: "B 9069 UIS", sopir: "Edi", p: 3.51, l: 1.8, t: 0.7 },
  { nopol: "B 9086 UYY", sopir: "Dargo", p: 3.6, l: 1.8, t: 0.75 },
  { nopol: "B 9188 UYX", sopir: "Alex", p: 3.5, l: 1.85, t: 0.7 },
  { nopol: "B 9201 UYZ", sopir: "Yanto", p: 3.61, l: 1.85, t: 0.7 },
  { nopol: "B 9305 UYX", sopir: "Parno", p: 3.6, l: 1.8, t: 0.85 },
  { nopol: "B 9488 UYX", sopir: "Rudi", p: 3.5, l: 1.85, t: 0.7 },
  { nopol: "B 9489 UYX", sopir: "Kariadi", p: 3.58, l: 1.8, t: 0.84 },
  { nopol: "B 9520 UIS", sopir: "Ipul", p: 3.6, l: 1.85, t: 0.82 },
  { nopol: "B 9661 UYW", sopir: "Nanang", p: 3.6, l: 1.8, t: 0.85 },
  { nopol: "B 9662 UYY", sopir: "", p: 3.6, l: 1.8, t: 0.85 },
  { nopol: "B 9715 UYW", sopir: "Yumi", p: 3.6, l: 1.8, t: 0.7 },
  { nopol: "B 9782 UYV", sopir: "Aceng", p: 3.6, l: 1.8, t: 0.85 },
  { nopol: "B 9789 UYW", sopir: "Wartono", p: 3.6, l: 1.8, t: 0.9 },
  { nopol: "B 9878 UYV", sopir: "Iskak", p: 3.6, l: 1.8, t: 0.84 },
];

const normNopol = (s) => (s || "").toUpperCase().replace(/\s+/g, " ").trim();

async function upsertArmada(nopol, jenis, sopir, panjang, lebar, tinggi, volume) {
  const existing = await prisma.armada.findFirst({
    where: { nopol: { equals: nopol, mode: "insensitive" } },
  });

  const data = {
    nopol,
    jenis,
    sopir: sopir || undefined,
    panjang,
    lebar,
    tinggi,
    volume,
  };

  if (existing) {
    await prisma.armada.update({ where: { id: existing.id }, data });
    console.log(`~ update  ${nopol.padEnd(12)} (${jenis}) sopir=${sopir || "-"}`);
  } else {
    const created = await prisma.armada.create({
      data: { ...data, divisi: "Armada" },
    });
    await prisma.dokumen.createMany({
      data: buildDefaultDokumenData("MOBIL", created.id),
    });
    console.log(`+ create  ${nopol.padEnd(12)} (${jenis}) sopir=${sopir || "-"}`);
  }
}

async function main() {
  console.log("== Seed Index Armada: Tronton ==");
  for (const r of TRONTON) {
    await upsertArmada(normNopol(r.nopol), "Tronton", r.sopir, r.p, r.l, r.t, r.vol);
  }

  console.log("\n== Seed Index Armada: Cold Diesel ==");
  for (const r of COLT_DIESEL) {
    const vol = Math.round(r.p * r.l * r.t * 1000) / 1000;
    await upsertArmada(normNopol(r.nopol), "Cold Diesel", r.sopir, r.p, r.l, r.t, vol);
  }

  console.log("\nSelesai.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
