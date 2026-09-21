import { Router } from "express";
import prisma from "../prismaClient.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const rate = await prisma.uangMakanAlat.findMany({
      orderBy: [{ unitAlat: "asc" }, { kategoriAlat: "asc" }],
    });
    res.json(rate);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { unitAlat, kategoriAlat, nominal } = req.body;
    if (!unitAlat || !kategoriAlat) {
      return res.status(400).json({ error: "Unit alat dan kategori wajib diisi" });
    }
    const rate = await prisma.uangMakanAlat.create({
      data: {
        unitAlat: unitAlat.trim(),
        kategoriAlat: kategoriAlat.trim(),
        nominal: Number(nominal) || 0,
      },
    });
    res.status(201).json(rate);
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "Rate untuk kombinasi unit + kategori ini sudah ada" });
    }
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { unitAlat, kategoriAlat, nominal } = req.body;
    const rate = await prisma.uangMakanAlat.update({
      where: { id: req.params.id },
      data: {
        unitAlat: unitAlat?.trim(),
        kategoriAlat: kategoriAlat?.trim(),
        nominal: nominal !== undefined ? Number(nominal) || 0 : undefined,
      },
    });
    res.json(rate);
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "Rate untuk kombinasi unit + kategori ini sudah ada" });
    }
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.uangMakanAlat.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
