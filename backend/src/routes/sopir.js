import { Router } from "express";
import prisma from "../prismaClient.js";

const router = Router();

// Daftar sopir sengaja TIDAK dibatasi per-divisi (sama seperti Armada) --
// dipakai lintas divisi (Armada, Supplier, dst) lewat dropdown di halaman
// Armada & Surat Jalan.
router.get("/", async (req, res, next) => {
  try {
    const { all } = req.query;
    const sopir = await prisma.sopir.findMany({
      where: all ? {} : { aktif: true },
      orderBy: { nama: "asc" },
    });
    res.json(sopir);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { nama, tipe, noHp, komisiDefault, aktif, keterangan } = req.body;
    if (!nama || !tipe) {
      return res.status(400).json({ error: "Nama dan tipe sopir wajib diisi" });
    }
    const sopir = await prisma.sopir.create({
      data: {
        nama: nama.trim(),
        tipe,
        noHp: noHp || null,
        // Tronton default komisi flat 50rb kalau tidak diisi; Cold Diesel
        // dibiarkan 0 (komisinya manual tiap kali, bukan flat).
        komisiDefault:
          komisiDefault !== undefined && komisiDefault !== ""
            ? Number(komisiDefault)
            : tipe === "TRONTON"
            ? 50000
            : 0,
        aktif: aktif ?? true,
        keterangan: keterangan || null,
      },
    });
    res.status(201).json(sopir);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { nama, tipe, noHp, komisiDefault, aktif, keterangan } = req.body;
    const sopir = await prisma.sopir.update({
      where: { id: req.params.id },
      data: {
        nama: nama?.trim(),
        tipe,
        noHp: noHp || null,
        komisiDefault: komisiDefault !== undefined ? Number(komisiDefault) || 0 : undefined,
        aktif: aktif ?? undefined,
        keterangan: keterangan || null,
      },
    });

    // Sinkronkan nama sopir yang sudah "dicache" sebagai teks di Armada
    // (kolom Armada.sopir) supaya tidak beda dari master kalau nama diubah.
    if (nama) {
      await prisma.armada.updateMany({
        where: { sopirId: sopir.id },
        data: { sopir: sopir.nama },
      });
    }

    res.json(sopir);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    // Jangan hapus kalau masih dipakai Armada/SuratJalan -- lepas kaitannya
    // dulu (nama tetap tersimpan sebagai teks di data lama), baru hapus
    // master-nya, supaya riwayat SJ/Armada lama tidak error.
    await prisma.armada.updateMany({ where: { sopirId: req.params.id }, data: { sopirId: null } });
    await prisma.suratJalan.updateMany({ where: { sopirId: req.params.id }, data: { sopirId: null } });
    await prisma.sopir.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
