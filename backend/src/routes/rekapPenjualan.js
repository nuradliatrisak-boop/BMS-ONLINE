import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

function scopeCustomerIds(req) {
  return prisma.customer.findMany({
    where: scopeDivisi(req),
    select: { id: true },
  });
}

router.get("/", async (req, res, next) => {
  try {
    const { customerId, bulan, from, to } = req.query;
    const customerIds = await scopeCustomerIds(req);
    const allowedIds = new Set(customerIds.map((c) => c.id));

    if (customerId && !allowedIds.has(customerId)) {
      return res.status(403).json({ error: "Customer tidak dapat diakses" });
    }

    const where = {
      customerId: customerId ? customerId : { in: [...allowedIds] },
    };

    if (bulan) {
      const [year, month] = String(bulan).split("-").map(Number);
      if (year && month) {
        where.tanggal = {
          gte: new Date(year, month - 1, 1),
          lt: new Date(year, month, 1),
        };
      }
    } else if (from || to) {
      where.tanggal = {};
      if (from) where.tanggal.gte = new Date(`${from}T00:00:00`);
      if (to) {
        const d = new Date(`${to}T00:00:00`);
        d.setDate(d.getDate() + 1);
        where.tanggal.lt = d;
      }
    }

    const rows = await prisma.rekapPenjualan.findMany({
      where,
      include: { customer: true },
      orderBy: [{ tanggal: "asc" }, { createdAt: "asc" }],
    });

    const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const jumlah = rows.reduce((sum, row) => sum + Number(row.jumlah || 0), 0);

    res.json({ rows, summary: { total, jumlah, count: rows.length } });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const {
      customerId,
      tanggal,
      noSuratJalan,
      noPolisi,
      jenisBarang,
      panjang,
      lebar,
      tinggi,
      jumlah,
      harga,
      catatan,
    } = req.body;

    if (!customerId || !tanggal || !noSuratJalan || !noPolisi || !jenisBarang) {
      return res.status(400).json({
        error: "Customer, tanggal, nomor surat jalan, nomor polisi, dan jenis barang wajib diisi",
      });
    }

    const volume = Number(panjang || 0) * Number(lebar || 0) * Number(tinggi || 0);
    const qty = Number(jumlah || volume || 0);
    const price = Number(harga || 0);
    const total = qty * price;

    const row = await prisma.rekapPenjualan.create({
      data: {
        customerId,
        tanggal: new Date(tanggal),
        noSuratJalan: String(noSuratJalan).trim(),
        noPolisi: String(noPolisi).trim(),
        jenisBarang: String(jenisBarang).trim(),
        panjang: Number(panjang || 0),
        lebar: Number(lebar || 0),
        tinggi: Number(tinggi || 0),
        jumlah: qty,
        harga: price,
        total,
        catatan: catatan || null,
      },
      include: { customer: true },
    });

    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const current = await prisma.rekapPenjualan.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Data rekap tidak ditemukan" });

    const {
      customerId,
      tanggal,
      noSuratJalan,
      noPolisi,
      jenisBarang,
      panjang,
      lebar,
      tinggi,
      jumlah,
      harga,
      catatan,
    } = req.body;

    const volume = Number(panjang || 0) * Number(lebar || 0) * Number(tinggi || 0);
    const qty = Number(jumlah || volume || 0);
    const price = Number(harga || 0);

    const row = await prisma.rekapPenjualan.update({
      where: { id: req.params.id },
      data: {
        customerId,
        tanggal: tanggal ? new Date(tanggal) : undefined,
        noSuratJalan: noSuratJalan?.trim(),
        noPolisi: noPolisi?.trim(),
        jenisBarang: jenisBarang?.trim(),
        panjang: Number(panjang || 0),
        lebar: Number(lebar || 0),
        tinggi: Number(tinggi || 0),
        jumlah: qty,
        harga: price,
        total: qty * price,
        catatan: catatan || null,
      },
      include: { customer: true },
    });

    res.json(row);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.rekapPenjualan.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
