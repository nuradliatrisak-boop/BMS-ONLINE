import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

const customerInclude = {
  prices: {
    orderBy: [
      { destinationCode: "asc" },
      { stockCode: "asc" },
    ],
  },
};

router.get("/", async (req, res, next) => {
  try {
    const customers = await prisma.customer.findMany({
      where: scopeDivisi(req),
      include: customerInclude,
      orderBy: { nama: "asc" },
    });
    res.json(customers);
  } catch (e) {
    next(e);
  }
});

router.get("/:id/prices", async (req, res, next) => {
  try {
    const prices = await prisma.customerPrice.findMany({
      where: { customerId: req.params.id },
      orderBy: [
        { destinationCode: "asc" },
        { stockCode: "asc" },
      ],
    });
    res.json(prices);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { kode, nama, alamat, telepon, npwp, divisi, prices = [] } = req.body;
    if (!kode || !nama || !divisi) {
      return res.status(400).json({ error: "Kode, nama, dan divisi wajib diisi" });
    }

    const customer = await prisma.customer.create({
      data: {
        kode: kode.trim().toUpperCase(),
        nama: nama.trim(),
        alamat,
        telepon,
        npwp,
        divisi,
        prices: {
          create: prices.map((p) => ({
            destinationCode: p.destinationCode,
            stockCode: p.stockCode,
            stockName: p.stockName,
            hargaM3: Number(p.hargaM3 || 0),
            sewaTruk: Number(p.sewaTruk || 0),
            hppTruk: Number(p.hppTruk || 0),
            destination: p.destination || null,
            discount: p.discount || null,
          })),
        },
      },
      include: customerInclude,
    });
    res.status(201).json(customer);
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "Kode customer sudah digunakan" });
    }
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { kode, nama, alamat, telepon, npwp, divisi } = req.body;
    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data: {
        kode: kode?.trim().toUpperCase(),
        nama: nama?.trim(),
        alamat,
        telepon,
        npwp,
        divisi,
      },
      include: customerInclude,
    });
    res.json(customer);
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "Kode customer sudah digunakan" });
    }
    next(e);
  }
});

router.post("/:id/prices", async (req, res, next) => {
  try {
    const {
      destinationCode,
      stockCode,
      stockName,
      hargaM3,
      sewaTruk,
      hppTruk,
      destination,
      discount,
    } = req.body;

    if (!destinationCode || !stockCode || !stockName) {
      return res.status(400).json({
        error: "Kode tujuan, kode stock, dan nama stock wajib diisi",
      });
    }

    const price = await prisma.customerPrice.create({
      data: {
        customerId: req.params.id,
        destinationCode: destinationCode.trim().toUpperCase(),
        stockCode: stockCode.trim().toUpperCase(),
        stockName: stockName.trim(),
        hargaM3: Number(hargaM3 || 0),
        sewaTruk: Number(sewaTruk || 0),
        hppTruk: Number(hppTruk || 0),
        destination: destination || null,
        discount: discount || null,
      },
    });
    res.status(201).json(price);
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "Kombinasi kode tujuan dan kode stock sudah ada" });
    }
    next(e);
  }
});

router.put("/:id/prices/:priceId", async (req, res, next) => {
  try {
    const price = await prisma.customerPrice.update({
      where: { id: req.params.priceId },
      data: {
        destinationCode: req.body.destinationCode?.trim().toUpperCase(),
        stockCode: req.body.stockCode?.trim().toUpperCase(),
        stockName: req.body.stockName?.trim(),
        hargaM3: Number(req.body.hargaM3 || 0),
        sewaTruk: Number(req.body.sewaTruk || 0),
        hppTruk: Number(req.body.hppTruk || 0),
        destination: req.body.destination || null,
        discount: req.body.discount || null,
      },
    });
    res.json(price);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id/prices/:priceId", async (req, res, next) => {
  try {
    await prisma.customerPrice.delete({ where: { id: req.params.priceId } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.customer.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
