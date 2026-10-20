// Masukkan data RITASE + KEHADIRAN SOPIR dari Excel "Rekap Ritase Trans Cilegon" ke aplikasi:
//   - Rekap Ritase (input manual, customer PT Trans Cilegon): ritase per mobil per tanggal, 5,5 m3 per ritase
//   - Absensi & Upah Sopir: daftar sopir + nopol, status Libur/Kerja/Izin dari tabel "Keterangan", upah per hari, jumlah hari yang sudah dibayar
// Data: scripts/data/ritase_trans_cilegon_okt2026.json
//
//   node scripts/importRitaseTransCilegon.js --dry   # cek saja
//   node scripts/importRitaseTransCilegon.js         # import (aman diulang, tidak dobel)
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "data", "ritase_trans_cilegon_okt2026.json");
const prisma = new PrismaClient();
const dry = process.argv.includes("--dry");
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const STATUS_OK = { kerja: "Kerja", libur: "Libur", izin: "Izin", sakit: "Sakit" };

async function bacaSetting(k, awal) {
  const s = await prisma.setting.findUnique({ where: { key: k } });
  try {
    return JSON.parse(s?.value || "null") ?? awal;
  } catch {
    return awal;
  }
}
const simpanSetting = (k, v) => {
  const value = JSON.stringify(v);
  return prisma.setting.upsert({ where: { key: k }, update: { value }, create: { key: k, value } });
};

async function main() {
  const d = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  const semua = await prisma.customer.findMany({ select: { id: true, nama: true } });
  const cust = semua.find((c) => key(c.nama).includes("transcilegon"));
  if (!cust) {
    console.log("! Customer PT Trans Cilegon belum ada. Jalankan dulu importStokKubusKeStok.js atau buat customernya.");
    process.exitCode = 1;
    return;
  }
  console.log(`${dry ? "[dry] " : ""}Customer: ${cust.nama}`);

  // ---- 1. ritase manual ----
  const manual = await bacaSetting("ritaseManual", []);
  let baruRit = 0;
  for (const m of d.mobil) {
    if (m.abaikanRitase) {
      console.log(`  (dilewati) ritase ${m.noPolisi}: tab ini isinya salinan data B 9305 UYX di Excel, cek dulu`);
      continue;
    }
    for (const r of m.ritase) {
      if (manual.some((e) => e.customerId === cust.id && e.tanggal === r.tanggal && e.noPolisi === m.noPolisi)) continue;
      manual.push({ id: uid("m"), customerId: cust.id, tanggal: r.tanggal, noPolisi: m.noPolisi, ritase: r.ritase, kubikasi: r.kubikasi, catatan: "Impor Excel" });
      baruRit++;
    }
    console.log(`  ${m.noPolisi} (${m.sopir}): ${m.ritase.reduce((s, x) => s + x.ritase, 0)} ritase di ${m.ritase.length} tanggal`);
  }
  console.log(`Ritase manual baru: ${baruRit} baris`);

  // ---- 2. sopir, absensi, upah, pembayaran ----
  const abs = await bacaSetting("absensiSopir", {});
  abs.sopir ||= [];
  abs.absensi ||= [];
  abs.bayar ||= [];
  abs.upahPerHari = Number(abs.upahPerHari) || d.upahPerHari;
  let baruAbs = 0;
  for (const m of d.mobil) {
    let s = abs.sopir.find((x) => x.noPolisi === m.noPolisi);
    if (!s) {
      s = { id: uid("s"), nama: m.sopir, noPolisi: m.noPolisi };
      abs.sopir.push(s);
    }
    for (const k of m.keterangan) {
      const st = STATUS_OK[key(k.status)];
      if (!st) continue;
      if (abs.absensi.some((a) => a.sopirId === s.id && a.tanggal === k.tanggal)) continue;
      abs.absensi.push({ sopirId: s.id, tanggal: k.tanggal, status: st, catatan: k.catatan || "" });
      baruAbs++;
    }
    const hari = d.dibayar[m.sopir];
    if (hari && !abs.bayar.some((b) => b.sopirId === s.id && /impor excel/i.test(b.catatan || ""))) {
      abs.bayar.push({ id: uid("b"), sopirId: s.id, tanggal: "2026-10-20", hari, catatan: "Impor Excel (tanggal bayar tidak tercatat di Excel)" });
    }
  }
  console.log(`Sopir: ${abs.sopir.length}, status kehadiran baru: ${baruAbs}, upah per hari: Rp ${abs.upahPerHari.toLocaleString("id-ID")}`);

  if (dry) return console.log("[dry] Tidak ada yang ditulis ke database.");
  await simpanSetting("ritaseManual", manual);
  await simpanSetting("absensiSopir", abs);
  console.log("Selesai. Di Rekap Ritase pilih Sumber = 'Surat Jalan + input manual' atau 'Input manual saja', customer PT Trans Cilegon, periode 5-11 Oktober 2026.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
