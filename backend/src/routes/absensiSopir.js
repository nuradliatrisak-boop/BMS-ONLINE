import { Router } from "express";
import prisma from "../prismaClient.js";

// ------------------------------------------------------------
// ABSENSI & UPAH SOPIR (bagian dari menu Rekap Ritase)
// Meniru lembar Excel "Rekap Ritase": hari kerja/libur sopir + pembayaran upah.
// Disimpan di tabel Setting (key "absensiSopir", JSON) -> TANPA migrasi database.
//
// Bentuk data:
//  sopir:   [{ id, nama, noPolisi }]
//  absensi: [{ sopirId, tanggal YYYY-MM-DD, status: Kerja|Libur|Izin|Sakit, catatan }]
//  upahPerHari: angka (Rp)
//  bayar:   [{ id, sopirId, tanggal, hari, catatan }]   (hari = jumlah hari yang dibayar)
// ------------------------------------------------------------
const router = Router();
const KEY = "absensiSopir";
const STATUS = ["Kerja", "Libur", "Izin", "Sakit"];
const err = (status, message) => Object.assign(new Error(message), { status });
const isTgl = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const num = (v) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

async function baca() {
  const s = await prisma.setting.findUnique({ where: { key: KEY } });
  let d = {};
  try {
    d = JSON.parse(s?.value || "{}") || {};
  } catch {
    d = {};
  }
  return {
    sopir: Array.isArray(d.sopir) ? d.sopir : [],
    absensi: Array.isArray(d.absensi) ? d.absensi : [],
    upahPerHari: num(d.upahPerHari),
    bayar: Array.isArray(d.bayar) ? d.bayar : [],
  };
}
async function simpan(d) {
  const value = JSON.stringify(d);
  await prisma.setting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
}
const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
};

router.get("/", handle(async (_req, res) => res.json(await baca())));

// Daftar sopir + upah per hari (disimpan sekaligus)
router.put("/master", handle(async (req, res) => {
  const d = await baca();
  const lama = new Map(d.sopir.map((s) => [s.id, s]));
  const sopir = (Array.isArray(req.body.sopir) ? req.body.sopir : [])
    .map((s) => ({
      id: s.id && lama.has(s.id) ? s.id : uid("s"),
      nama: String(s.nama || "").trim().slice(0, 60),
      noPolisi: String(s.noPolisi || "").toUpperCase().replace(/\s+/g, " ").trim().slice(0, 20),
    }))
    .filter((s) => s.nama);
  d.sopir = sopir;
  const ada = new Set(sopir.map((s) => s.id));
  d.absensi = d.absensi.filter((a) => ada.has(a.sopirId));
  d.bayar = d.bayar.filter((b) => ada.has(b.sopirId));
  if (req.body.upahPerHari !== undefined) d.upahPerHari = Math.max(0, num(req.body.upahPerHari));
  await simpan(d);
  res.json(d);
}));

// Isi / ubah / hapus status 1 hari untuk 1 sopir. status "" = hapus.
router.post("/absensi", handle(async (req, res) => {
  const { sopirId, tanggal, status, catatan } = req.body || {};
  if (!isTgl(tanggal)) throw err(400, "Tanggal tidak valid");
  const d = await baca();
  if (!d.sopir.some((s) => s.id === sopirId)) throw err(404, "Sopir tidak ditemukan");
  d.absensi = d.absensi.filter((a) => !(a.sopirId === sopirId && a.tanggal === tanggal));
  if (status) {
    if (!STATUS.includes(status)) throw err(400, "Status tidak valid");
    d.absensi.push({ sopirId, tanggal, status, catatan: String(catatan || "").slice(0, 200) });
  }
  await simpan(d);
  res.json({ ok: true });
}));

router.post("/bayar", handle(async (req, res) => {
  const { sopirId, tanggal, hari, catatan } = req.body || {};
  const d = await baca();
  if (!d.sopir.some((s) => s.id === sopirId)) throw err(404, "Sopir tidak ditemukan");
  if (!isTgl(tanggal)) throw err(400, "Tanggal tidak valid");
  if (!(num(hari) > 0)) throw err(400, "Jumlah hari dibayar harus lebih dari 0");
  const row = { id: uid("b"), sopirId, tanggal, hari: num(hari), catatan: String(catatan || "").slice(0, 200) };
  d.bayar.push(row);
  await simpan(d);
  res.status(201).json(row);
}));

router.delete("/bayar/:id", handle(async (req, res) => {
  const d = await baca();
  d.bayar = d.bayar.filter((b) => b.id !== req.params.id);
  await simpan(d);
  res.status(204).end();
}));

export default router;
