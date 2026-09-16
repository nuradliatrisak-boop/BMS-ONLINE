// REKAP SEWA ALAT
// ================
// Menjawab kebutuhan: "dipisahkan total keseluruhan, terus berdasarkan
// kategori alatnya" untuk customer-customer sewa alat (PT. Djasipa,
// Bp. Moreno, dst).
//
// Sumbernya tabel Invoice + InvoiceItem (bukan Laporan Divisi), jadi angkanya
// konsisten dengan Dashboard & piutang. Baris item sewa alat dikenali dari
// kolom baru `kategoriAlat` (Bucket / Breker / Mobilisasi) yang diisi saat
// import maupun saat admin input invoice manual.
//
// Endpoint:
//   GET /api/rekap-alat             -> ringkasan (total, per customer, per kategori, per unit, per bulan)
//   GET /api/rekap-alat/rincian     -> daftar baris item (buat tabel detail + pencarian)
//   GET /api/rekap-alat/opsi        -> isi dropdown pencarian (customer, kategori, unit)
//
// Query filter yang dipahami semua endpoint di atas:
//   customerId, kategori, unit, dari (YYYY-MM-DD), sampai (YYYY-MM-DD), q (kata kunci)

import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

// Susun kondisi `where` untuk InvoiceItem dari query string.
function buildWhere(req) {
  const invoiceWhere = { ...scopeDivisi(req) };
  if (req.query.customerId) invoiceWhere.customerId = String(req.query.customerId);

  const where = {
    kategoriAlat: { not: null },
    invoice: invoiceWhere,
  };

  if (req.query.kategori) where.kategoriAlat = String(req.query.kategori);
  if (req.query.unit) where.unitAlat = String(req.query.unit);

  const dari = req.query.dari ? new Date(String(req.query.dari)) : null;
  const sampai = req.query.sampai ? new Date(String(req.query.sampai)) : null;
  if (dari || sampai) {
    where.tglPakai = {};
    if (dari) where.tglPakai.gte = dari;
    if (sampai) {
      // sampai akhir hari supaya tanggal terakhir ikut terhitung
      const akhir = new Date(sampai);
      akhir.setHours(23, 59, 59, 999);
      where.tglPakai.lte = akhir;
    }
  }

  const q = (req.query.q || "").toString().trim();
  if (q) {
    where.OR = [
      { keterangan: { contains: q, mode: "insensitive" } },
      { unitAlat: { contains: q, mode: "insensitive" } },
      { kategoriAlat: { contains: q, mode: "insensitive" } },
      { invoice: { ...invoiceWhere, no: { contains: q, mode: "insensitive" } } },
      { invoice: { ...invoiceWhere, customer: { nama: { contains: q, mode: "insensitive" } } } },
    ];
  }

  return where;
}

function bulanKey(d) {
  if (!d) return "(tanpa tanggal)";
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
}

async function ambilItem(req) {
  return prisma.invoiceItem.findMany({
    where: buildWhere(req),
    include: {
      invoice: {
        select: {
          id: true,
          no: true,
          tanggal: true,
          status: true,
          divisi: true,
          catatan: true,
          customer: { select: { id: true, nama: true, kode: true } },
        },
      },
    },
    orderBy: [{ tglPakai: "asc" }],
  });
}

// ---------- RINGKASAN ----------
router.get("/", async (req, res, next) => {
  try {
    const items = await ambilItem(req);

    const perCustomer = new Map();
    const perKategori = new Map();
    const perUnit = new Map();
    const perBulan = new Map();

    let totalNilai = 0;
    let totalJam = 0;

    for (const it of items) {
      const nilai = Number(it.qty) * Number(it.hargaSatuan);
      const jam = it.satuan === "jam" ? Number(it.qty) : 0;
      totalNilai += nilai;
      totalJam += jam;

      const cNama = it.invoice?.customer?.nama || "(tanpa customer)";
      const cId = it.invoice?.customer?.id || null;
      const c = perCustomer.get(cNama) || { customerId: cId, nama: cNama, nilai: 0, jam: 0, baris: 0, kategori: {} };
      c.nilai += nilai;
      c.jam += jam;
      c.baris += 1;
      c.kategori[it.kategoriAlat] = (c.kategori[it.kategoriAlat] || 0) + nilai;
      perCustomer.set(cNama, c);

      const k = perKategori.get(it.kategoriAlat) || { kategori: it.kategoriAlat, nilai: 0, jam: 0, baris: 0 };
      k.nilai += nilai;
      k.jam += jam;
      k.baris += 1;
      perKategori.set(it.kategoriAlat, k);

      const uNama = it.unitAlat || "(tanpa unit)";
      const u = perUnit.get(uNama) || { unit: uNama, nilai: 0, jam: 0, baris: 0 };
      u.nilai += nilai;
      u.jam += jam;
      u.baris += 1;
      perUnit.set(uNama, u);

      const bk = bulanKey(it.tglPakai || it.invoice?.tanggal);
      const bln = perBulan.get(bk) || { bulan: bk, nilai: 0, jam: 0 };
      bln.nilai += nilai;
      bln.jam += jam;
      perBulan.set(bk, bln);
    }

    // Pembayaran & piutang dihitung per invoice yang punya baris sewa alat,
    // supaya "sisa tagihan" yang ditampilkan nyambung dengan Dashboard.
    const invoiceIds = [...new Set(items.map((i) => i.invoiceId))];
    const invoices = invoiceIds.length
      ? await prisma.invoice.findMany({
          where: { id: { in: invoiceIds } },
          include: { items: true, pembayaran: true, customer: { select: { nama: true } } },
        })
      : [];

    let totalTagihanInvoice = 0;
    let totalDibayar = 0;
    for (const inv of invoices) {
      totalTagihanInvoice += inv.items.reduce((s, it) => s + Number(it.qty) * Number(it.hargaSatuan), 0);
      totalDibayar += inv.pembayaran.reduce((s, p) => s + Number(p.nominal), 0);
    }

    const urut = (arr) => arr.sort((a, b) => b.nilai - a.nilai);

    res.json({
      totalNilai,
      totalJam,
      totalBaris: items.length,
      totalInvoice: invoices.length,
      totalTagihanInvoice,
      totalDibayar,
      sisaPiutang: totalTagihanInvoice - totalDibayar,
      perCustomer: urut([...perCustomer.values()]),
      perKategori: urut([...perKategori.values()]),
      perUnit: urut([...perUnit.values()]).slice(0, 30),
      perBulan: [...perBulan.values()].sort((a, b) => a.bulan.localeCompare(b.bulan)),
    });
  } catch (e) {
    next(e);
  }
});

// ---------- RINCIAN PER BARIS ----------
router.get("/rincian", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 500, 3000);
    const items = await ambilItem(req);
    res.json({
      total: items.length,
      baris: items.slice(0, limit).map((it) => ({
        id: it.id,
        invoiceId: it.invoiceId,
        noInvoice: it.invoice?.no,
        statusInvoice: it.invoice?.status,
        customer: it.invoice?.customer?.nama,
        tglPakai: it.tglPakai,
        unitAlat: it.unitAlat,
        kategoriAlat: it.kategoriAlat,
        keterangan: it.keterangan,
        qty: it.qty,
        satuan: it.satuan,
        hargaSatuan: it.hargaSatuan,
        nilai: Number(it.qty) * Number(it.hargaSatuan),
        tarifAsumsi: /TARIF ASUMSI/i.test(it.invoice?.catatan || ""),
      })),
    });
  } catch (e) {
    next(e);
  }
});

// ---------- ISI DROPDOWN PENCARIAN ----------
router.get("/opsi", async (req, res, next) => {
  try {
    const invoiceWhere = scopeDivisi(req);
    const items = await prisma.invoiceItem.findMany({
      where: { kategoriAlat: { not: null }, invoice: invoiceWhere },
      select: {
        kategoriAlat: true,
        unitAlat: true,
        invoice: { select: { customer: { select: { id: true, nama: true } } } },
      },
    });

    const kategori = new Set();
    const unit = new Set();
    const customerMap = new Map();

    for (const it of items) {
      if (it.kategoriAlat) kategori.add(it.kategoriAlat);
      if (it.unitAlat) unit.add(it.unitAlat);
      const c = it.invoice?.customer;
      if (c) customerMap.set(c.id, c.nama);
    }

    res.json({
      kategori: [...kategori].sort(),
      unit: [...unit].sort(),
      customer: [...customerMap.entries()]
        .map(([id, nama]) => ({ id, nama }))
        .sort((a, b) => a.nama.localeCompare(b.nama)),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
