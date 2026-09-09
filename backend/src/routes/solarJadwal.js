import { Router } from "express";
import prisma from "../prismaClient.js";

const router = Router();

function two(n) {
  return String(n).padStart(2, "0");
}

// Sama pola nomor pendek dengan solarTx.js -- "SM-YYMMDD-XX"
async function generateNoSolarMasuk(tanggal) {
  const d = new Date(tanggal);
  const yy = two(d.getFullYear() % 100);
  const mm = two(d.getMonth() + 1);
  const dd = two(d.getDate());
  const prefix = `SM-${yy}${mm}${dd}`;
  const last = await prisma.solarTx.findFirst({
    where: { no: { startsWith: `${prefix}-` } },
    orderBy: { no: "desc" },
    select: { no: true },
  });
  let urut = 1;
  if (last?.no) {
    const m = last.no.match(/-(\d+)$/);
    if (m) urut = Number(m[1]) + 1;
  }
  return `${prefix}-${two(urut)}`;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// GET /api/solar-jadwal?tanggal=YYYY-MM-DD  -> daftar jadwal 1 tanggal
// GET /api/solar-jadwal?bulan=YYYY-MM       -> daftar jadwal 1 bulan (riwayat)
router.get("/", async (req, res, next) => {
  try {
    const { tanggal, bulan } = req.query;
    let list;
    if (tanggal) {
      const dari = new Date(tanggal + "T00:00:00");
      const sampai = new Date(tanggal + "T23:59:59.999");
      list = await prisma.solarJadwalSetor.findMany({
        where: { tanggal: { gte: dari, lte: sampai } },
        orderBy: [{ status: "asc" }, { nama: "asc" }],
      });
    } else if (bulan) {
      const all = await prisma.solarJadwalSetor.findMany({ orderBy: { tanggal: "desc" } });
      list = all.filter((j) => j.tanggal.toISOString().slice(0, 7) === bulan);
    } else {
      list = await prisma.solarJadwalSetor.findMany({ orderBy: { tanggal: "desc" }, take: 200 });
    }
    res.json(list);
  } catch (e) {
    next(e);
  }
});

// GET /api/solar-jadwal/utang -> rekap saldo utang solar per sopir.
// Cuma baris yang sudah direalisasi (status != BELUM) yang dihitung --
// baris BELUM itu masih "rencana", belum tentu jadi utang beneran.
// saldoUtang > 0  => sopir masih kurang setor (utang ke perusahaan)
// saldoUtang <= 0 => sopir sudah pas/lebih setor (tidak ada utang, atau
//                    malah kelebihan yang otomatis nutup utang hari lain)
router.get("/utang", async (req, res, next) => {
  try {
    const realisasi = await prisma.solarJadwalSetor.findMany({
      where: { status: { not: "BELUM" } },
    });
    const map = new Map();
    for (const j of realisasi) {
      const key = j.nama;
      const setor = j.literSetor ?? j.literWajib;
      const cur = map.get(key) || { nama: key, totalWajib: 0, totalSetor: 0, jumlahEntri: 0 };
      cur.totalWajib += j.literWajib;
      cur.totalSetor += setor;
      cur.jumlahEntri += 1;
      map.set(key, cur);
    }
    const rekap = Array.from(map.values())
      .map((r) => ({ ...r, saldoUtang: r.totalWajib - r.totalSetor }))
      .sort((a, b) => b.saldoUtang - a.saldoUtang);
    res.json(rekap);
  } catch (e) {
    next(e);
  }
});

// POST /api/solar-jadwal -> tambah baris jadwal (input manual staff).
// terjadwal=false dipakai untuk sopir yang tidak ada di daftar awal tapi
// tetap setor hari itu (ditambah dadakan).
router.post("/", async (req, res, next) => {
  try {
    const { tanggal, nama, literWajib, noSuratJalan, catatan, terjadwal } = req.body;
    if (!tanggal || !nama || literWajib === undefined || literWajib === "") {
      return res.status(400).json({ error: "Tanggal, nama sopir, dan liter wajib diisi" });
    }
    const literNum = toNum(literWajib);
    if (literNum <= 0) {
      return res.status(400).json({ error: "Jumlah liter wajib harus lebih dari 0" });
    }
    const jadwal = await prisma.solarJadwalSetor.create({
      data: {
        tanggal: new Date(tanggal),
        nama: String(nama).trim(),
        literWajib: literNum,
        noSuratJalan: noSuratJalan || null,
        catatan: catatan || null,
        terjadwal: terjadwal === false ? false : true,
      },
    });
    res.status(201).json(jadwal);
  } catch (e) {
    next(e);
  }
});

// PUT /api/solar-jadwal/:id -> edit baris SEBELUM direalisasi (status masih
// BELUM). Kalau sudah dicentang/diisi, harus dibatalkan dulu lewat
// POST /:id/batal supaya tidak diam-diam mengubah angka yang sudah tercatat
// di SolarTx.
router.put("/:id", async (req, res, next) => {
  try {
    const current = await prisma.solarJadwalSetor.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Data tidak ditemukan" });
    if (current.status !== "BELUM") {
      return res.status(400).json({ error: "Baris ini sudah direalisasi, batalkan centangnya dulu sebelum diedit" });
    }
    const { tanggal, nama, literWajib, noSuratJalan, catatan } = req.body;
    const literNum = literWajib !== undefined && literWajib !== "" ? toNum(literWajib) : current.literWajib;
    if (literNum <= 0) {
      return res.status(400).json({ error: "Jumlah liter wajib harus lebih dari 0" });
    }
    const jadwal = await prisma.solarJadwalSetor.update({
      where: { id: req.params.id },
      data: {
        tanggal: tanggal ? new Date(tanggal) : current.tanggal,
        nama: nama ? String(nama).trim() : current.nama,
        literWajib: literNum,
        noSuratJalan: noSuratJalan !== undefined ? noSuratJalan || null : current.noSuratJalan,
        catatan: catatan !== undefined ? catatan || null : current.catatan,
      },
    });
    res.json(jadwal);
  } catch (e) {
    next(e);
  }
});

// POST /api/solar-jadwal/:id/centang
// Realisasi checklist. Body kosong / tanpa "literSetor" = dianggap PAS
// (sama dengan literWajib) -> tinggal dicentang. Kirim "literSetor" kalau
// beda (kurang/lebih) -> status jadi SELISIH. Otomatis bikin 1 baris
// SolarTx (MASUK) supaya nyambung ke saldo Stok Solar.
router.post("/:id/centang", async (req, res, next) => {
  try {
    const current = await prisma.solarJadwalSetor.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Data tidak ditemukan" });
    if (current.status !== "BELUM") {
      return res.status(400).json({ error: "Baris ini sudah dicentang. Batalkan dulu kalau mau ubah." });
    }

    const { literSetor, catatan } = req.body;
    const literSetorNum =
      literSetor !== undefined && literSetor !== "" ? toNum(literSetor) : current.literWajib;
    if (literSetorNum < 0) {
      return res.status(400).json({ error: "Jumlah liter setor tidak boleh negatif" });
    }
    const status = literSetorNum === current.literWajib ? "SESUAI" : "SELISIH";

    const no = await generateNoSolarMasuk(current.tanggal);
    const solarTx = await prisma.solarTx.create({
      data: {
        no,
        tipe: "MASUK",
        tanggal: current.tanggal,
        nama: current.nama,
        liter: literSetorNum,
        keterangan:
          status === "SELISIH"
            ? `Setor solar (wajib ${current.literWajib} L, disetor ${literSetorNum} L)`
            : "Setor solar sesuai jadwal",
      },
    });

    const jadwal = await prisma.solarJadwalSetor.update({
      where: { id: req.params.id },
      data: {
        status,
        literSetor: literSetorNum,
        catatan: catatan !== undefined ? catatan || null : current.catatan,
        solarTxId: solarTx.id,
      },
    });
    res.json(jadwal);
  } catch (e) {
    next(e);
  }
});

// POST /api/solar-jadwal/:id/batal -> batalkan centang (balik ke BELUM),
// hapus juga baris SolarTx yang otomatis kebentuk waktu dicentang.
router.post("/:id/batal", async (req, res, next) => {
  try {
    const current = await prisma.solarJadwalSetor.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Data tidak ditemukan" });

    const jadwal = await prisma.solarJadwalSetor.update({
      where: { id: req.params.id },
      data: { status: "BELUM", literSetor: null, solarTxId: null },
    });
    if (current.solarTxId) {
      await prisma.solarTx.delete({ where: { id: current.solarTxId } }).catch(() => {});
    }
    res.json(jadwal);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const current = await prisma.solarJadwalSetor.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Data tidak ditemukan" });
    await prisma.solarJadwalSetor.delete({ where: { id: req.params.id } });
    if (current.solarTxId) {
      await prisma.solarTx.delete({ where: { id: current.solarTxId } }).catch(() => {});
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
