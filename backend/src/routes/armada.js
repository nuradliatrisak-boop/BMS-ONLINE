import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const armada = await prisma.armada.findMany({
      where: scopeDivisi(req),
      orderBy: { nopol: "asc" },
    });
    res.json(armada);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { nopol, jenis, sopir, divisi } = req.body;
    if (!nopol || !jenis || !divisi) {
      return res.status(400).json({ error: "Nopol, jenis, dan divisi wajib diisi" });
    }
    const armada = await prisma.armada.create({ data: { nopol, jenis, sopir, divisi } });
    res.status(201).json(armada);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { nopol, jenis, sopir, divisi } = req.body;
    const armada = await prisma.armada.update({
      where: { id: req.params.id },
      data: { nopol, jenis, sopir, divisi },
    });
    res.json(armada);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.armada.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
