import { Router } from "express";
import prisma from "../prismaClient.js";
import { syncTrontonTx, hapusTrontonTx } from "../services/trontonDivisiTx.js";

// ------------------------------------------------------------
// BUKU TRONTON -- digitalisasi buku tulis catatan uang jalan sopir tronton.
//   GET    /api/buku-tronton?from=&to=&sopirId=&q=   daftar + ringkasan
//   GET    /api/buku-tronton/opsi                    isi dropdown (sopir, material, tujuan)
//   POST   /api/buku-tronton/batch                   simpan banyak baris sekaligus (1 tanggal)
//   PUT    /api/buku-tronton/:id                     ubah 1 baris
//   DELETE /api/buku-tronton/:id                     hapus 1 baris
//   POST   /api/buku-tronton/daftar-sopir            daftarkan nama manual jadi master Sopir (Tronton)
// ------------------------------------------------------------
const router = Router();
const err = (status, message) => Object.assign(new Error(message), { status });
const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
};

const rapikan = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
const key = (s) => rapikan(s).toLowerCase();
const titleCase = (s) =>
  rapikan(s)
    .toLowerCase()
    .replace(/(^|[\s.\-'])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
const num = (v) => {
  // angka dari MoneyInput sudah number; teks "1.500.000" (titik ribuan) juga dimengerti
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const isTgl = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const tglDate = (s) => new Date(`${s}T00:00:00.000Z`);
const tglStr = (d) => new Date(d).toISOString().slice(0, 10);

// Cocokkan nama sopir ke master Sopir: pakai sopirId kalau valid, kalau tidak coba cocokkan nama persis.
async function resolveSopir(sopirId, nama) {
  if (sopirId) {
    const s = await prisma.sopir.findUnique({ where: { id: sopirId } });
    if (s) return { sopirId: s.id, sopirNama: s.nama };
  }
  const n = rapikan(nama);
  if (!n) throw err(400, "Nama sopir wajib diisi");
  const semua = await prisma.sopir.findMany({ select: { id: true, nama: true } });
  const cocok = semua.find((s) => key(s.nama) === key(n));
  if (cocok) return { sopirId: cocok.id, sopirNama: cocok.nama };
  return { sopirId: null, sopirNama: titleCase(n) };
}

async function dataBaris(b, tanggal, masukLaporan) {
  const { sopirId, sopirNama } = await resolveSopir(b.sopirId, b.sopirNama);
  return {
    tanggal,
    sopirId,
    sopirNama,
    noPolisi: rapikan(b.noPolisi).toUpperCase() || null,
    uangJalan: num(b.uangJalan),
    material: rapikan(b.material) || null,
    uangBeliMaterial: num(b.uangBeliMaterial),
    tujuan: rapikan(b.tujuan) || null,
    catatan: rapikan(b.catatan) || null,
    masukLaporan: masukLaporan !== false,
  };
}

// ---------- Opsi dropdown ----------
router.get("/opsi", handle(async (_req, res) => {
  const [sopir, armada, stock, material, trips] = await Promise.all([
    prisma.sopir.findMany({ where: { aktif: true }, orderBy: { nama: "asc" } }),
    prisma.armada.findMany({ where: { sopirId: { not: null } }, select: { sopirId: true, nopol: true, jenis: true } }),
    prisma.stockMaster.findMany({ where: { aktif: true }, orderBy: { kode: "asc" } }),
    prisma.material.findMany({ select: { nama: true }, orderBy: { nama: "asc" } }),
    prisma.trontonTrip.findMany({ select: { tujuan: true, material: true }, orderBy: { tanggal: "desc" }, take: 3000 }),
  ]);
  const nopolBySopir = new Map();
  for (const a of armada) {
    const lama = nopolBySopir.get(a.sopirId);
    const tronton = String(a.jenis || "").toLowerCase().includes("tronton");
    if (!lama || tronton) nopolBySopir.set(a.sopirId, a.nopol);
  }
  const urut = [...sopir].sort((a, b) => (a.tipe === b.tipe ? 0 : a.tipe === "TRONTON" ? -1 : 1));
  const tujuan = [...new Set(trips.map((t) => rapikan(t.tujuan)).filter(Boolean))];
  const stockNama = stock.map((s) => ({ kode: s.kode, nama: s.nama }));
  const dikenal = new Set(stockNama.map((s) => key(s.nama)));
  const materialManual = [
    ...new Set([...trips.map((t) => rapikan(t.material)), ...material.map((m) => rapikan(m.nama))].filter((m) => m && !dikenal.has(key(m)))),
  ];
  res.json({
    sopir: urut.map((s) => ({ id: s.id, nama: s.nama, tipe: s.tipe, nopol: nopolBySopir.get(s.id) || null })),
    material: stockNama,
    materialManual,
    tujuan,
  });
}));

// ---------- Daftar + ringkasan ----------
router.get("/", handle(async (req, res) => {
  const { from, to, sopirId, q } = req.query;
  const where = {};
  if (isTgl(from) || isTgl(to)) {
    where.tanggal = {};
    if (isTgl(from)) where.tanggal.gte = tglDate(from);
    if (isTgl(to)) where.tanggal.lte = tglDate(to);
  }
  if (sopirId) where.sopirId = String(sopirId);
  const qq = rapikan(q);
  if (qq) {
    where.OR = ["sopirNama", "material", "tujuan", "catatan", "noPolisi"].map((f) => ({ [f]: { contains: qq, mode: "insensitive" } }));
  }
  const rows = await prisma.trontonTrip.findMany({ where, orderBy: [{ tanggal: "desc" }, { createdAt: "asc" }] });

  const per = new Map();
  let totalUJ = 0;
  let totalBM = 0;
  for (const r of rows) {
    totalUJ += r.uangJalan;
    totalBM += r.uangBeliMaterial;
    const k = r.sopirId ? `id:${r.sopirId}` : `nama:${key(r.sopirNama)}`;
    const p = per.get(k) || { sopirId: r.sopirId, nama: r.sopirNama, terdaftar: !!r.sopirId, trip: 0, uangJalan: 0, uangBeliMaterial: 0 };
    p.trip += 1;
    p.uangJalan += r.uangJalan;
    p.uangBeliMaterial += r.uangBeliMaterial;
    per.set(k, p);
  }
  res.json({
    rows: rows.map((r) => ({ ...r, tanggal: tglStr(r.tanggal) })),
    ringkasan: {
      trip: rows.length,
      totalUangJalan: totalUJ,
      totalUangBeliMaterial: totalBM,
      totalKeluar: totalUJ + totalBM,
      perSopir: [...per.values()].sort((a, b) => b.trip - a.trip || a.nama.localeCompare(b.nama)),
    },
  });
}));

// ---------- Simpan banyak baris (1 tanggal) ----------
router.post("/batch", handle(async (req, res) => {
  const { tanggal, rows, masukLaporan } = req.body || {};
  if (!isTgl(tanggal)) throw err(400, "Tanggal tidak valid");
  const input = (Array.isArray(rows) ? rows : []).filter(
    (r) => rapikan(r.sopirNama || r.sopirId) || num(r.uangJalan) || num(r.uangBeliMaterial) || rapikan(r.material) || rapikan(r.tujuan)
  );
  if (!input.length) throw err(400, "Belum ada baris yang diisi");
  const tgl = tglDate(tanggal);
  const dibuat = [];
  for (let i = 0; i < input.length; i++) {
    const b = input[i];
    if (!rapikan(b.sopirNama) && !b.sopirId) throw err(400, `Baris ${i + 1}: nama sopir wajib diisi`);
    const data = await dataBaris(b, tgl, masukLaporan);
    const trip = await prisma.trontonTrip.create({ data });
    await syncTrontonTx(trip);
    dibuat.push(trip);
  }
  res.status(201).json({ jumlah: dibuat.length });
}));

// ---------- Ubah / hapus 1 baris ----------
router.put("/:id", handle(async (req, res) => {
  const ada = await prisma.trontonTrip.findUnique({ where: { id: req.params.id } });
  if (!ada) throw err(404, "Data tidak ditemukan");
  const b = req.body || {};
  const tanggal = b.tanggal !== undefined ? (isTgl(b.tanggal) ? tglDate(b.tanggal) : null) : ada.tanggal;
  if (!tanggal) throw err(400, "Tanggal tidak valid");
  const data = await dataBaris(b, tanggal, b.masukLaporan);
  const trip = await prisma.trontonTrip.update({ where: { id: ada.id }, data });
  await syncTrontonTx(trip);
  res.json(trip);
}));

router.delete("/:id", handle(async (req, res) => {
  const ada = await prisma.trontonTrip.findUnique({ where: { id: req.params.id } });
  if (!ada) throw err(404, "Data tidak ditemukan");
  await hapusTrontonTx(ada.id);
  await prisma.trontonTrip.delete({ where: { id: ada.id } });
  res.json({ ok: true });
}));

// ---------- Daftarkan nama manual jadi master Sopir (Tronton) ----------
// Semua baris Buku Tronton dengan nama yang sama (belum terkait master) ikut dikaitkan.
router.post("/daftar-sopir", handle(async (req, res) => {
  const nama = titleCase(req.body?.nama);
  if (!nama) throw err(400, "Nama wajib diisi");
  const semua = await prisma.sopir.findMany({ select: { id: true, nama: true } });
  let sopir = semua.find((s) => key(s.nama) === key(nama));
  if (!sopir) sopir = await prisma.sopir.create({ data: { nama, tipe: "TRONTON", komisiDefault: 50000 } });
  const belum = await prisma.trontonTrip.findMany({ where: { sopirId: null } });
  const ids = belum.filter((t) => key(t.sopirNama) === key(nama)).map((t) => t.id);
  if (ids.length) await prisma.trontonTrip.updateMany({ where: { id: { in: ids } }, data: { sopirId: sopir.id, sopirNama: sopir.nama } });
  for (const id of ids) {
    const t = await prisma.trontonTrip.findUnique({ where: { id } });
    if (t) await syncTrontonTx(t);
  }
  res.status(201).json({ sopir, dikaitkan: ids.length });
}));

export default router;
