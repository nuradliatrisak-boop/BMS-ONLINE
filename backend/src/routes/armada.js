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

// Rekap per kendaraan (Nopol) untuk satu bulan: Ritasi & total m3 diambil dari
// Surat Jalan, Pendapatan & Sparepart diambil dari Laporan Divisi (DivisiTx)
// dengan acuan subKategori == nopol kendaraan -- mengikuti pola yang sudah
// dipakai untuk rincian per unit Alat Berat. Ini mencerminkan sheet "REKAP"
// (kolom kanan: Nopol, Sopir, Ritase, Uang Jalan, Sparepart, Hasil Bersih)
// di Excel "Pengeluaran".
router.get("/rekap/:bulan", async (req, res, next) => {
  try {
    const { bulan } = req.params; // "YYYY-MM"
    const where = scopeDivisi(req);

    const armadaList = await prisma.armada.findMany({
      where,
      orderBy: { nopol: "asc" },
    });

    const sjAll = await prisma.suratJalan.findMany({
      where: { ...where, isDraft: false },
    });
    const sjBulan = sjAll.filter(
      (s) => s.tanggal.toISOString().slice(0, 7) === bulan
    );

    const txAll = await prisma.divisiTx.findMany({ where });
    const txBulan = txAll.filter(
      (t) => t.tanggal.toISOString().slice(0, 7) === bulan && t.subKategori
    );

    const rekap = armadaList.map((a) => {
      const trips = sjBulan.filter((s) => s.armadaId === a.id);
      const ritasi = trips.length;
      const totalM3 = trips.reduce((s, t) => s + (t.m3 || 0), 0);

      const txNopol = txBulan.filter((t) => t.subKategori === a.nopol);
      const pendapatan = txNopol
        .filter((t) => t.tipe === "PENJUALAN")
        .reduce((s, t) => s + t.nominal, 0);
      const sparepart = txNopol
        .filter((t) => t.tipe === "PENGELUARAN")
        .reduce((s, t) => s + t.nominal, 0);

      return {
        armadaId: a.id,
        nopol: a.nopol,
        jenis: a.jenis,
        sopir: a.sopir,
        divisi: a.divisi,
        volume: a.volume,
        ritasi,
        totalM3,
        pendapatan,
        sparepart,
        hasilBersih: pendapatan - sparepart,
      };
    });

    const totalRitasi = rekap.reduce((s, r) => s + r.ritasi, 0);
    const totalPendapatan = rekap.reduce((s, r) => s + r.pendapatan, 0);
    const totalSparepart = rekap.reduce((s, r) => s + r.sparepart, 0);

    res.json({
      bulan,
      rekap,
      total: {
        ritasi: totalRitasi,
        pendapatan: totalPendapatan,
        sparepart: totalSparepart,
        hasilBersih: totalPendapatan - totalSparepart,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { nopol, jenis, sopir, divisi, panjang, lebar, tinggi, volume } = req.body;
    if (!nopol || !jenis || !divisi) {
      return res.status(400).json({ error: "Nopol, jenis, dan divisi wajib diisi" });
    }
    const armada = await prisma.armada.create({
      data: {
        nopol,
        jenis,
        sopir,
        divisi,
        panjang: panjang !== undefined && panjang !== "" ? Number(panjang) : null,
        lebar: lebar !== undefined && lebar !== "" ? Number(lebar) : null,
        tinggi: tinggi !== undefined && tinggi !== "" ? Number(tinggi) : null,
        volume: volume !== undefined && volume !== "" ? Number(volume) : null,
      },
    });
    res.status(201).json(armada);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { nopol, jenis, sopir, divisi, panjang, lebar, tinggi, volume } = req.body;
    const armada = await prisma.armada.update({
      where: { id: req.params.id },
      data: {
        nopol,
        jenis,
        sopir,
        divisi,
        panjang: panjang !== undefined && panjang !== "" ? Number(panjang) : null,
        lebar: lebar !== undefined && lebar !== "" ? Number(lebar) : null,
        tinggi: tinggi !== undefined && tinggi !== "" ? Number(tinggi) : null,
        volume: volume !== undefined && volume !== "" ? Number(volume) : null,
      },
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
