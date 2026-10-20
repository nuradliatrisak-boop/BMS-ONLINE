import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";
import { syncStokUpahKuliTx, hapusStokUpahKuliTx, syncSemuaStokUpahKuli } from "../services/stokUpahKuli.js";

// ------------------------------------------------------------
// STOK (menu "Stok")
//
// Kartu stok per barang (mis. Kubus Masif 11.000 BH untuk PT Trans Cilegon):
//   Sisa = qtyAwal + total MASUK - total KELUAR, dihitung realtime.
// Tiap mutasi (pengiriman / pemakaian / tambah stok) punya tanggal, qty, no. surat,
// catatan, dan upah kuli. Upah kuli otomatis dicerminkan ke Laporan Divisi > Pengeluaran
// (lihat services/stokUpahKuli.js).
// ------------------------------------------------------------
const router = Router();

const TIPE = ["KELUAR", "MASUK"];
const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];
const r3 = (x) => Math.round((Number(x) || 0) * 1000) / 1000;
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const bersih = (v) => {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  return s || null;
};
const tglDate = (v) => {
  const s = String(v || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
function bacaUpah(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = toNum(v);
  return n > 0 ? n : null;
}

function urutMutasi(a, b) {
  return new Date(a.tanggal) - new Date(b.tanggal) || new Date(a.createdAt) - new Date(b.createdAt);
}

// Hitung kartu stok (baris + sisa berjalan) & ringkasan 1 barang.
export function ringkasStok(s) {
  const mutasi = [...(s.mutasi || [])].sort(urutMutasi);
  let sisa = s.qtyAwal;
  const rows = mutasi.map((m, i) => {
    sisa = r3(sisa + (m.tipe === "MASUK" ? m.qty : -m.qty));
    return {
      no: i + 1,
      id: m.id,
      tipe: m.tipe,
      tanggal: m.tanggal,
      qty: m.qty,
      noSurat: m.noSurat,
      catatan: m.catatan,
      upahKuli: m.upahKuli,
      sisa,
    };
  });
  const masuk = r3(mutasi.filter((m) => m.tipe === "MASUK").reduce((t, m) => t + m.qty, 0));
  const keluar = r3(mutasi.filter((m) => m.tipe === "KELUAR").reduce((t, m) => t + m.qty, 0));
  return {
    id: s.id,
    nama: s.nama,
    kategori: s.kategori,
    satuan: s.satuan,
    divisi: s.divisi,
    namaCustomer: s.namaCustomer,
    proyek: s.proyek,
    qtyAwal: s.qtyAwal,
    catatan: s.catatan,
    aktif: s.aktif,
    createdAt: s.createdAt,
    masuk,
    keluar,
    sisa: r3(s.qtyAwal + masuk - keluar),
    totalUpahKuli: Math.round(mutasi.reduce((t, m) => t + (Number(m.upahKuli) || 0), 0)),
    jumlahMutasi: mutasi.length,
    mutasi: rows,
  };
}

async function ambil(req, res) {
  const s = await prisma.stokBarang.findFirst({
    where: { id: req.params.id, ...scopeDivisi(req) },
    include: { mutasi: true },
  });
  if (!s) {
    res.status(404).json({ error: "Stok tidak ditemukan" });
    return null;
  }
  return s;
}

function bacaBarang(req) {
  const b = req.body || {};
  const nama = bersih(b.nama);
  if (!nama) return { error: "Nama barang wajib diisi" };
  const qtyAwal = toNum(b.qtyAwal);
  if (qtyAwal < 0) return { error: "Total stok tidak boleh minus" };
  let divisi = bersih(b.divisi) || "Kontraktor";
  if (!DIVISI.includes(divisi)) return { error: "Divisi tidak dikenal" };
  if (req.user.role !== "ADMIN") divisi = req.user.divisi || divisi; // staf hanya boleh divisinya sendiri
  return {
    data: {
      nama,
      kategori: bersih(b.kategori) || "Material",
      satuan: bersih(b.satuan),
      divisi,
      namaCustomer: bersih(b.namaCustomer),
      proyek: bersih(b.proyek),
      qtyAwal,
      catatan: bersih(b.catatan),
      ...(typeof b.aktif === "boolean" ? { aktif: b.aktif } : {}),
    },
  };
}

function bacaMutasi(body, sebelumnya = null) {
  const b = body || {};
  const tipe = String(b.tipe ?? sebelumnya?.tipe ?? "KELUAR").toUpperCase();
  if (!TIPE.includes(tipe)) return { error: "Tipe harus KELUAR atau MASUK" };
  const tanggal = b.tanggal !== undefined ? tglDate(b.tanggal) : sebelumnya?.tanggal;
  if (!tanggal) return { error: "Tanggal wajib diisi" };
  const qty = b.qty !== undefined ? toNum(b.qty) : sebelumnya?.qty;
  if (!(qty > 0)) return { error: "Jumlah harus lebih dari 0" };
  return {
    data: {
      tipe,
      tanggal,
      qty,
      noSurat: b.noSurat !== undefined ? bersih(b.noSurat) : sebelumnya?.noSurat ?? null,
      catatan: b.catatan !== undefined ? bersih(b.catatan) : sebelumnya?.catatan ?? null,
      upahKuli: b.upahKuli !== undefined ? bacaUpah(b.upahKuli) : sebelumnya?.upahKuli ?? null,
    },
  };
}

// Stok akhir tidak boleh minus.
function sisaSetelah(s, ganti) {
  const daftar = (s.mutasi || []).filter((m) => m.id !== ganti.hapusId).concat(ganti.tambah ? [ganti.tambah] : []);
  const net = daftar.reduce((t, m) => t + (m.tipe === "MASUK" ? m.qty : -m.qty), 0);
  return r3(s.qtyAwal + net);
}

router.get("/", async (req, res, next) => {
  try {
    const list = await prisma.stokBarang.findMany({
      where: { ...scopeDivisi(req), ...(req.query.all ? {} : { aktif: true }) },
      include: { mutasi: true },
      orderBy: [{ nama: "asc" }, { createdAt: "asc" }],
    });
    res.json(list.map((s) => {
      const { mutasi, ...ringkas } = ringkasStok(s);
      return ringkas;
    }));
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const s = await ambil(req, res);
    if (!s) return;
    res.json(ringkasStok(s));
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { data, error } = bacaBarang(req);
    if (error) return res.status(400).json({ error });
    const s = await prisma.stokBarang.create({ data, include: { mutasi: true } });
    res.status(201).json(ringkasStok(s));
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const cur = await ambil(req, res);
    if (!cur) return;
    const { data, error } = bacaBarang(req);
    if (error) return res.status(400).json({ error });
    if (sisaSetelah({ ...cur, qtyAwal: data.qtyAwal }, {}) < 0) {
      return res.status(400).json({ error: "Total stok terlalu kecil: sisa akan minus karena sudah ada pengeluaran" });
    }
    await prisma.stokBarang.update({ where: { id: cur.id }, data });
    await syncSemuaStokUpahKuli(cur.id); // divisi / nama / proyek bisa berubah
    const s = await prisma.stokBarang.findUnique({ where: { id: cur.id }, include: { mutasi: true } });
    res.json(ringkasStok(s));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const cur = await ambil(req, res);
    if (!cur) return;
    await hapusStokUpahKuliTx(cur.mutasi.map((m) => m.id));
    await prisma.stokBarang.delete({ where: { id: cur.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

router.post("/:id/mutasi", async (req, res, next) => {
  try {
    const cur = await ambil(req, res);
    if (!cur) return;
    const { data, error } = bacaMutasi(req.body);
    if (error) return res.status(400).json({ error });
    if (sisaSetelah(cur, { tambah: { ...data, id: "baru" } }) < 0) {
      return res.status(400).json({ error: `Jumlah melebihi sisa stok (sisa sekarang ${ringkasStok(cur).sisa})` });
    }
    const m = await prisma.stokMutasi.create({ data: { ...data, stokId: cur.id } });
    await syncStokUpahKuliTx(cur, m);
    const s = await prisma.stokBarang.findUnique({ where: { id: cur.id }, include: { mutasi: true } });
    res.status(201).json(ringkasStok(s));
  } catch (e) {
    next(e);
  }
});

router.put("/:id/mutasi/:mid", async (req, res, next) => {
  try {
    const cur = await ambil(req, res);
    if (!cur) return;
    const lama = cur.mutasi.find((m) => m.id === req.params.mid);
    if (!lama) return res.status(404).json({ error: "Baris tidak ditemukan" });
    const { data, error } = bacaMutasi(req.body, lama);
    if (error) return res.status(400).json({ error });
    if (sisaSetelah(cur, { hapusId: lama.id, tambah: { ...data, id: lama.id } }) < 0) {
      return res.status(400).json({ error: "Perubahan ini membuat sisa stok minus" });
    }
    const m = await prisma.stokMutasi.update({ where: { id: lama.id }, data });
    await syncStokUpahKuliTx(cur, m);
    const s = await prisma.stokBarang.findUnique({ where: { id: cur.id }, include: { mutasi: true } });
    res.json(ringkasStok(s));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id/mutasi/:mid", async (req, res, next) => {
  try {
    const cur = await ambil(req, res);
    if (!cur) return;
    const lama = cur.mutasi.find((m) => m.id === req.params.mid);
    if (!lama) return res.status(404).json({ error: "Baris tidak ditemukan" });
    if (sisaSetelah(cur, { hapusId: lama.id }) < 0) {
      return res.status(400).json({ error: "Menghapus baris ini membuat sisa stok minus" });
    }
    await hapusStokUpahKuliTx(lama.id);
    await prisma.stokMutasi.delete({ where: { id: lama.id } });
    const s = await prisma.stokBarang.findUnique({ where: { id: cur.id }, include: { mutasi: true } });
    res.json(ringkasStok(s));
  } catch (e) {
    next(e);
  }
});

export default router;
