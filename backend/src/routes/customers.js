import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const customers = await prisma.customer.findMany({
      where: scopeDivisi(req),
      orderBy: { nama: "asc" },
    });
    res.json(customers);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { nama, alamat, telepon, npwp, divisi } = req.body;
    if (!nama || !divisi) {
      return res.status(400).json({ error: "Nama dan divisi wajib diisi" });
    }
    const customer = await prisma.customer.create({
      data: { nama, alamat, telepon, npwp, divisi },
    });
    res.status(201).json(customer);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { nama, alamat, telepon, npwp, divisi } = req.body;
    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data: { nama, alamat, telepon, npwp, divisi },
    });
    res.json(customer);
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
