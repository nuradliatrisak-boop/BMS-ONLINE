import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

// ------------------------------------------------------------
// PROYEK KONTRAKTOR
//
// Rekap per proyek untuk Divisi Kontraktor (dan divisi lain yang butuh):
//   Tagihan  = jumlah baris Invoice yang ditautkan ke proyek (Invoice.proyekId)
//   Dibayar  = jumlah Pembayaran pada invoice-invoice itu
//   HPP      = pengeluaran proyek (ProyekBiaya jenis HPP)
//   Potongan = pengurang HPP (mis. sisa material yang dikembalikan)
//   Diskon   = potongan harga ke customer
//   Margin   = Tagihan - (HPP - Potongan) - Diskon
//
// Setiap baris biaya juga dicerminkan ke Laporan Divisi > Pengeluaran
// (tabel DivisiTx, sumber = "AUTO_PROYEK:<id biaya>") supaya laba rugi
// divisi ikut terisi tanpa input dua kali. Baris cerminan itu tidak boleh
// diedit dari Laporan Divisi, harus lewat menu Proyek Kontraktor.
// ------------------------------------------------------------
const router = Router();

export const PROYEK_SUMBER_PREFIX = "AUTO_PROYEK:";
const JENIS = ["HPP", "POTONGAN_HPP", "DISKON"];
const LABEL_JENIS = { HPP: "HPP", POTONGAN_HPP: "Potongan HPP", DISKON: "Diskon" };

const num = (v) => {
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

const INCLUDE = {
  customer: { select: { id: true, nama: true } },
  invoices: {
    include: { items: true, pembayaran: true },
    orderBy: [{ tanggal: "asc" }, { no: "asc" }],
  },
  biaya: { orderBy: [{ urut: "asc" }, { createdAt: "asc" }] },
};

function bebanBiaya(b) {
  return b.jenis === "POTONGAN_HPP" ? -b.nominal : b.nominal;
}

// Hitung semua angka turunan 1 proyek.
export function ringkasProyek(p) {
  const invoices = p.invoices.map((inv) => {
    const total = inv.items.reduce((s, it) => s + num(it.qty) * num(it.hargaSatuan), 0);
    const dibayar = inv.pembayaran.reduce((s, x) => s + num(x.nominal), 0);
    return {
      id: inv.id,
      no: inv.no,
      tanggal: inv.tanggal,
      status: inv.status,
      total,
      dibayar,
      sisa: total - dibayar,
      pembayaran: [...inv.pembayaran]
        .sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal))
        .map((x) => ({ id: x.id, tanggal: x.tanggal, nominal: x.nominal, metode: x.metode, catatan: x.catatan })),
    };
  });
  const tagihan = invoices.reduce((s, i) => s + i.total, 0);
  const dibayar = invoices.reduce((s, i) => s + i.dibayar, 0);
  const hpp = p.biaya.filter((b) => b.jenis === "HPP").reduce((s, b) => s + b.nominal, 0);
  const potongan = p.biaya.filter((b) => b.jenis === "POTONGAN_HPP").reduce((s, b) => s + b.nominal, 0);
  const diskon = p.biaya.filter((b) => b.jenis === "DISKON").reduce((s, b) => s + b.nominal, 0);
  const hppBersih = hpp - potongan;
  const marginKotor = tagihan - hppBersih;
  const margin = marginKotor - diskon;
  return {
    id: p.id,
    nama: p.nama,
    divisi: p.divisi,
    customerId: p.customerId,
    namaCustomer: p.customer?.nama || p.namaCustomer || null,
    lokasi: p.lokasi,
    catatan: p.catatan,
    createdAt: p.createdAt,
    invoices,
    biaya: p.biaya,
    ringkasan: {
      tagihan,
      dibayar,
      sisaTagihan: tagihan - dibayar,
      hpp,
      potongan,
      hppBersih,
      marginKotor,
      diskon,
      margin,
      persenMargin: tagihan > 0 ? (margin / tagihan) * 100 : 0,
    },
  };
}

// ---- Cermin biaya -> Laporan Divisi (DivisiTx) ----
function dataTx(proyek, b) {
  const label = b.uraian;
  return {
    divisi: proyek.divisi,
    tipe: "PENGELUARAN",
    kelompok: "pengeluaran",
    kategori: proyek.nama,
    subKategori: b.jenis === "HPP" ? label : `${LABEL_JENIS[b.jenis]}: ${label}`,
    keterangan: `Otomatis dari Proyek Kontraktor \u2014 ${proyek.nama}`,
    qty: b.qty ?? null,
    hargaSatuan: b.hargaSatuan ?? null,
    nominal: bebanBiaya(b),
    tanggal: b.tanggal,
    sumber: `${PROYEK_SUMBER_PREFIX}${b.id}`,
  };
}

export async function syncBiayaTx(proyek, b) {
  const sumber = `${PROYEK_SUMBER_PREFIX}${b.id}`;
  const ada = await prisma.divisiTx.findFirst({ where: { sumber } });
  const data = dataTx(proyek, b);
  if (ada) await prisma.divisiTx.update({ where: { id: ada.id }, data });
  else await prisma.divisiTx.create({ data });
}

async function hapusTxBiaya(biayaId) {
  await prisma.divisiTx.deleteMany({ where: { sumber: `${PROYEK_SUMBER_PREFIX}${biayaId}` } });
}

async function syncSemuaBiaya(proyekId) {
  const p = await prisma.proyekKontraktor.findUnique({ where: { id: proyekId }, include: { biaya: true } });
  if (!p) return;
  for (const b of p.biaya) await syncBiayaTx(p, b);
}

async function ambilProyek(req, res) {
  const p = await prisma.proyekKontraktor.findFirst({
    where: { id: req.params.id, ...scopeDivisi(req) },
    include: INCLUDE,
  });
  if (!p) {
    res.status(404).json({ error: "Proyek tidak ditemukan" });
    return null;
  }
  return p;
}

function bacaBiaya(body) {
  const jenis = String(body.jenis || "HPP").toUpperCase();
  if (!JENIS.includes(jenis)) return { error: "Jenis harus HPP, POTONGAN_HPP, atau DISKON" };
  const uraian = bersih(body.uraian);
  if (!uraian) return { error: "Uraian wajib diisi" };
  const tanggal = tglDate(body.tanggal);
  if (!tanggal) return { error: "Tanggal wajib diisi" };

  const adaQty = body.qty !== undefined && body.qty !== null && body.qty !== "";
  const adaHarga = body.hargaSatuan !== undefined && body.hargaSatuan !== null && body.hargaSatuan !== "";
  const pakaiQty = adaQty && adaHarga;
  const nominal = pakaiQty ? num(body.qty) * num(body.hargaSatuan) : num(body.nominal);
  if (!(nominal > 0)) return { error: "Nominal (atau Qty x Harga Satuan) wajib diisi dan harus lebih dari 0" };

  return {
    data: {
      jenis,
      uraian,
      tanggal,
      qty: adaQty ? num(body.qty) : null,
      satuan: bersih(body.satuan),
      hargaSatuan: adaHarga ? num(body.hargaSatuan) : null,
      nominal,
      catatan: bersih(body.catatan),
    },
  };
}

// ---- Daftar proyek + ringkasan ----
router.get("/", async (req, res, next) => {
  try {
    const list = await prisma.proyekKontraktor.findMany({
      where: scopeDivisi(req),
      include: INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    const hasil = list.map((p) => {
      const r = ringkasProyek(p);
      // daftar ringan: detail invoice & biaya diambil lewat GET /:id
      return { ...r, invoices: r.invoices.map(({ pembayaran, ...i }) => i), biaya: undefined, jumlahBiaya: p.biaya.length };
    });
    res.json(hasil);
  } catch (e) {
    next(e);
  }
});

// Invoice yang belum ditautkan ke proyek mana pun (untuk dipilih saat menautkan).
router.get("/invoice-tersedia", async (req, res, next) => {
  try {
    const divisi = req.query.divisi || (req.user.role === "ADMIN" ? "Kontraktor" : req.user.divisi);
    const list = await prisma.invoice.findMany({
      where: { proyekId: null, divisi: String(divisi), ...scopeDivisi(req) },
      include: { items: true, customer: { select: { nama: true } } },
      orderBy: { tanggal: "desc" },
    });
    res.json(
      list.map((i) => ({
        id: i.id,
        no: i.no,
        tanggal: i.tanggal,
        customer: i.customer?.nama || "",
        total: i.items.reduce((s, it) => s + num(it.qty) * num(it.hargaSatuan), 0),
      }))
    );
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const p = await ambilProyek(req, res);
    if (p) res.json(ringkasProyek(p));
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const nama = bersih(req.body.nama);
    if (!nama) return res.status(400).json({ error: "Nama proyek wajib diisi" });
    const divisi = req.user.role === "ADMIN" ? bersih(req.body.divisi) || "Kontraktor" : req.user.divisi;
    const p = await prisma.proyekKontraktor.create({
      data: {
        nama,
        divisi,
        customerId: req.body.customerId || null,
        namaCustomer: req.body.customerId ? null : bersih(req.body.namaCustomer),
        lokasi: bersih(req.body.lokasi),
        catatan: bersih(req.body.catatan),
      },
      include: INCLUDE,
    });
    res.status(201).json(ringkasProyek(p));
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const cur = await ambilProyek(req, res);
    if (!cur) return;
    const nama = bersih(req.body.nama) || cur.nama;
    await prisma.proyekKontraktor.update({
      where: { id: cur.id },
      data: {
        nama,
        customerId: req.body.customerId || null,
        namaCustomer: req.body.customerId ? null : bersih(req.body.namaCustomer),
        lokasi: bersih(req.body.lokasi),
        catatan: bersih(req.body.catatan),
      },
    });
    if (nama !== cur.nama) await syncSemuaBiaya(cur.id); // kategori di Laporan Divisi = nama proyek
    const p = await prisma.proyekKontraktor.findUnique({ where: { id: cur.id }, include: INCLUDE });
    res.json(ringkasProyek(p));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const cur = await ambilProyek(req, res);
    if (!cur) return;
    for (const b of cur.biaya) await hapusTxBiaya(b.id);
    // Invoice tidak ikut terhapus (relasi SetNull), hanya lepas dari proyek.
    await prisma.proyekKontraktor.delete({ where: { id: cur.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ---- Tautkan / lepas invoice ----
router.post("/:id/invoices", async (req, res, next) => {
  try {
    const cur = await ambilProyek(req, res);
    if (!cur) return;
    const inv = await prisma.invoice.findUnique({ where: { id: String(req.body.invoiceId || "") } });
    if (!inv) return res.status(404).json({ error: "Invoice tidak ditemukan" });
    if (inv.proyekId && inv.proyekId !== cur.id) {
      return res.status(409).json({ error: "Invoice ini sudah ditautkan ke proyek lain" });
    }
    await prisma.invoice.update({ where: { id: inv.id }, data: { proyekId: cur.id } });
    const p = await prisma.proyekKontraktor.findUnique({ where: { id: cur.id }, include: INCLUDE });
    res.json(ringkasProyek(p));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id/invoices/:invoiceId", async (req, res, next) => {
  try {
    const cur = await ambilProyek(req, res);
    if (!cur) return;
    await prisma.invoice.updateMany({
      where: { id: req.params.invoiceId, proyekId: cur.id },
      data: { proyekId: null },
    });
    const p = await prisma.proyekKontraktor.findUnique({ where: { id: cur.id }, include: INCLUDE });
    res.json(ringkasProyek(p));
  } catch (e) {
    next(e);
  }
});

// ---- Biaya / HPP / Diskon ----
router.post("/:id/biaya", async (req, res, next) => {
  try {
    const cur = await ambilProyek(req, res);
    if (!cur) return;
    const { data, error } = bacaBiaya(req.body);
    if (error) return res.status(400).json({ error });
    const urut = cur.biaya.reduce((m, b) => Math.max(m, b.urut), -1) + 1;
    const b = await prisma.proyekBiaya.create({ data: { ...data, proyekId: cur.id, urut } });
    await syncBiayaTx(cur, b);
    const p = await prisma.proyekKontraktor.findUnique({ where: { id: cur.id }, include: INCLUDE });
    res.status(201).json(ringkasProyek(p));
  } catch (e) {
    next(e);
  }
});

router.put("/:id/biaya/:biayaId", async (req, res, next) => {
  try {
    const cur = await ambilProyek(req, res);
    if (!cur) return;
    if (!cur.biaya.some((b) => b.id === req.params.biayaId)) {
      return res.status(404).json({ error: "Biaya tidak ditemukan" });
    }
    const { data, error } = bacaBiaya(req.body);
    if (error) return res.status(400).json({ error });
    const b = await prisma.proyekBiaya.update({ where: { id: req.params.biayaId }, data });
    await syncBiayaTx(cur, b);
    const p = await prisma.proyekKontraktor.findUnique({ where: { id: cur.id }, include: INCLUDE });
    res.json(ringkasProyek(p));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id/biaya/:biayaId", async (req, res, next) => {
  try {
    const cur = await ambilProyek(req, res);
    if (!cur) return;
    if (!cur.biaya.some((b) => b.id === req.params.biayaId)) {
      return res.status(404).json({ error: "Biaya tidak ditemukan" });
    }
    await hapusTxBiaya(req.params.biayaId);
    await prisma.proyekBiaya.delete({ where: { id: req.params.biayaId } });
    const p = await prisma.proyekKontraktor.findUnique({ where: { id: cur.id }, include: INCLUDE });
    res.json(ringkasProyek(p));
  } catch (e) {
    next(e);
  }
});

export default router;
