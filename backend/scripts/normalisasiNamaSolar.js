// Seragamkan huruf besar/kecil nama di catatan Stok Solar yang SUDAH ada
// ("aceng" & "Aceng" -> "Aceng").
//
//   node scripts/normalisasiNamaSolar.js           -> cuma tampilkan rencana (aman)
//   node scripts/normalisasiNamaSolar.js --apply   -> benar-benar ubah datanya
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const rapikan = (n) => String(n || "").trim().replace(/\s+/g, " ");
const key = (n) => rapikan(n).toLowerCase();
const titleCase = (n) =>
  rapikan(n)
    .toLowerCase()
    .replace(/(^|[\s.\-'])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());

const rows = await prisma.solarTx.findMany({ select: { id: true, nama: true } });
const grup = new Map();
for (const r of rows) {
  const k = key(r.nama);
  if (!grup.has(k)) grup.set(k, []);
  grup.get(k).push(r);
}

let diubah = 0;
for (const [, list] of grup) {
  const varian = [...new Set(list.map((r) => r.nama))];
  const baku = varian.includes(titleCase(varian[0]))
    ? titleCase(varian[0])
    : varian.find((v) => /^\p{Lu}/u.test(v) && v === rapikan(v)) || titleCase(varian[0]);
  const perlu = list.filter((r) => r.nama !== baku);
  if (!perlu.length) continue;
  console.log(`${[...new Set(perlu.map((r) => JSON.stringify(r.nama)))].join(", ")}  ->  "${baku}"  (${perlu.length} baris)`);
  diubah += perlu.length;
  if (apply) {
    await prisma.solarTx.updateMany({ where: { id: { in: perlu.map((r) => r.id) } }, data: { nama: baku } });
  }
}

console.log(diubah ? `\n${diubah} baris ${apply ? "sudah diubah." : "akan diubah. Jalankan lagi dengan --apply untuk menerapkan."}` : "Semua nama sudah seragam.");
await prisma.$disconnect();
