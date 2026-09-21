import { Router } from "express";
import prisma from "../prismaClient.js";

const router = Router();

// Daftar sopir sengaja TIDAK dibatasi per-divisi (sama seperti Armada) --
// dipakai lintas divisi (Armada, Supplier, dst) lewat dropdown di halaman
// Armada & Surat Jalan.
// Tugas dianggap SELESAI kalau Surat Jalan bukan draft dan TTD-nya LENGKAP.
// Komisi baru "didapat" sopir setelah tugasnya selesai.
const SELESAI = { isDraft: false, statusTTD: "LENGKAP" };

router.get("/", async (req, res, next) => {
  try {
    const { all, stats } = req.query;
    const sopir = await prisma.sopir.findMany({
      where: all ? {} : { aktif: true },
      orderBy: { nama: "asc" },
    });
    if (!stats) return res.json(sopir);

    // Ringkasan komisi per sopir (dipakai di daftar menu Sopir)
    const selesai = await prisma.suratJalan.groupBy({
      by: ["sopirId", "komisiDiambil"],
      where: { sopirId: { not: null }, ...SELESAI },
      _count: { _all: true },
      _sum: { uangKomisi: true },
    });
    const map = new Map();
    for (const g of selesai) {
      const m = map.get(g.sopirId) || { trip: 0, komisiBelumDiambil: 0, komisiSudahDiambil: 0 };
      m.trip += g._count._all;
      const nominal = Number(g._sum.uangKomisi || 0);
      if (g.komisiDiambil) m.komisiSudahDiambil += nominal;
      else m.komisiBelumDiambil += nominal;
      map.set(g.sopirId, m);
    }
    res.json(
      sopir.map((s) => ({
        ...s,
        trip: map.get(s.id)?.trip || 0,
        komisiBelumDiambil: map.get(s.id)?.komisiBelumDiambil || 0,
        komisiSudahDiambil: map.get(s.id)?.komisiSudahDiambil || 0,
      }))
    );
  } catch (e) {
    next(e);
  }
});

// Buku komisi 1 sopir: semua perjalanan (Surat Jalan) + status komisinya.
// ?bulan=YYYY-MM (opsional) untuk membatasi ke satu bulan.
router.get("/:id/perjalanan", async (req, res, next) => {
  try {
    const sopir = await prisma.sopir.findUnique({ where: { id: req.params.id } });
    if (!sopir) return res.status(404).json({ error: "Sopir tidak ditemukan" });

    const where = { sopirId: sopir.id, isDraft: false };
    const { bulan } = req.query;
    if (bulan) {
      const [y, m] = String(bulan).split("-").map(Number);
      if (y && m) where.tanggal = { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
    }

    const sjs = await prisma.suratJalan.findMany({
      where,
      orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        no: true,
        tanggal: true,
        tujuan: true,
        penerima: true,
        jenisBarang: true,
        noPolisi: true,
        statusTTD: true,
        uangKomisi: true,
        komisiDiambil: true,
        komisiDiambilAt: true,
      },
    });

    const rows = sjs.map((r) => ({
      ...r,
      selesai: r.statusTTD === "LENGKAP",
      uangKomisi: Number(r.uangKomisi || 0),
    }));
    const selesai = rows.filter((r) => r.selesai);
    const sum = (arr) => arr.reduce((t, r) => t + r.uangKomisi, 0);
    res.json({
      sopir,
      summary: {
        tripSelesai: selesai.length,
        tripBerjalan: rows.length - selesai.length,
        totalKomisi: sum(selesai),
        sudahDiambil: sum(selesai.filter((r) => r.komisiDiambil)),
        belumDiambil: sum(selesai.filter((r) => !r.komisiDiambil)),
        menungguSelesai: sum(rows.filter((r) => !r.selesai)),
      },
      rows,
    });
  } catch (e) {
    next(e);
  }
});

// Tandai komisi beberapa perjalanan sudah diambil (atau batalkan).
// body: { ids: [suratJalanId...], diambil: true|false }
router.post("/:id/komisi/diambil", async (req, res, next) => {
  try {
    const { ids, diambil } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: "Pilih minimal satu perjalanan" });
    }
    const flag = diambil !== false;
    const result = await prisma.suratJalan.updateMany({
      // hanya tugas yang sudah selesai yang komisinya bisa diambil
      where: { id: { in: ids }, sopirId: req.params.id, ...SELESAI },
      data: { komisiDiambil: flag, komisiDiambilAt: flag ? new Date() : null },
    });
    res.json({ updated: result.count });
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
