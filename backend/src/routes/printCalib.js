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
    // Catatan: nilai default ini sengaja dibuat tidak terlalu rapat (jarak
    // antar baris & ukuran font diperbesar dibanding versi sebelumnya) dan
    // posisi Nomor/Tanggal/Jam digeser ke bawah supaya tidak menabrak judul
    // "SURAT JALAN" yang sudah tercetak di kertas. Ini hanya titik awal -
    // sesuaikan lagi lewat halaman "Kalibrasi Cetak" memakai kertas asli.
    fields: {
      apDari: { x: 8, y: 10, size: 10 },
      penerima: { x: 8, y: 18, size: 10 },
      tujuan: { x: 8, y: 26, size: 10 },
      jenisBarang: { x: 8, y: 34, size: 10 },
      no: { x: 175, y: 30, size: 11 },
      tanggal: { x: 175, y: 38, size: 11 },
      jam: { x: 175, y: 46, size: 11 },
      nopol: { x: 14, y: 62, size: 13 },
      ukuranBak: { x: 90, y: 62, size: 13 },
      m3: { x: 200, y: 62, size: 13 },
      sopirNama: { x: 150, y: 98, size: 11 },
      hormatKamiNama: { x: 226, y: 102, size: 11 },
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