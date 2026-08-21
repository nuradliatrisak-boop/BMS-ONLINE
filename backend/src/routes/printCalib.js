import { Router } from "express";
import prisma from "../prismaClient.js";

const router = Router();

// Nilai default awal. Setelah dikalibrasi lewat halaman "Kalibrasi Cetak",
// nilai yang tersimpan di database (tabel PrintCalib) akan menimpa nilai ini.
const DEFAULTS = {
  sj: {
    w: 241.3,
    h: 108,
    offsetX: 0,
    offsetY: 0,
    fields: {
      apDari: { x: 8, y: 8, size: 8 },
      penerima: { x: 8, y: 14, size: 8 },
      no: { x: 186, y: 8, size: 9 },
      tanggalJam: { x: 186, y: 14, size: 8 },
      tujuan: { x: 8, y: 20, size: 8 },
      jenisBarang: { x: 8, y: 32, size: 8 },
      nopol: { x: 14, y: 63, size: 10 },
      ukuranBak: { x: 95, y: 63, size: 10 },
      m3: { x: 206, y: 63, size: 10 },
      sopirNama: { x: 150, y: 96, size: 9 },
      hormatKamiNama: { x: 226, y: 100, size: 9 },
    },
  },
  inv: {
    w: 241.3,
    h: 279.4,
    offsetX: 0,
    offsetY: 0,
    topMargin: 36,
  },
};

router.get("/", async (req, res, next) => {
  try {
    const rows = await prisma.printCalib.findMany();
    const result = {
      sj: { ...DEFAULTS.sj },
      inv: { ...DEFAULTS.inv },
    };
    for (const r of rows) {
      if (r.jenis === "sj") {
        result.sj = {
          ...DEFAULTS.sj,
          ...r.data,
          fields: { ...DEFAULTS.sj.fields, ...(r.data?.fields || {}) },
        };
      } else if (r.jenis === "inv") {
        result.inv = { ...DEFAULTS.inv, ...r.data };
      }
    }
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.put("/:jenis", async (req, res, next) => {
  try {
    const jenis = req.params.jenis;
    if (!["sj", "inv"].includes(jenis)) {
      return res.status(400).json({ error: "Jenis kalibrasi tidak dikenali" });
    }
    const saved = await prisma.printCalib.upsert({
      where: { jenis },
      update: { data: req.body },
      create: { jenis, data: req.body },
    });
    res.json(saved);
  } catch (e) {
    next(e);
  }
});

export default router;