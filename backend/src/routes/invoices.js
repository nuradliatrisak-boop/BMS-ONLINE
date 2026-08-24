import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";

const router = Router();

function hitungTotal(items) {
  return items.reduce(
    (sum, it) => sum + Number(it.qty) * Number(it.hargaSatuan),
    0
  );
}

function hitungStatus(total, sudahDibayar) {
  if (sudahDibayar <= 0) return "BELUM";
  if (sudahDibayar >= total) return "LUNAS";
  return "SEBAGIAN";
}

// ============================================================
// GENERATE NOMOR INVOICE OTOMATIS
// Format: BMS-INV-YYYYMM-0001
// Contoh: BMS-INV-202608-0001
// ============================================================

function buatPrefixInvoice(tanggal) {
  const d = new Date(tanggal);
  const tahun = d.getFullYear();
  const bulan = String(d.getMonth() + 1).padStart(2, "0");

  return `BMS-INV-${tahun}${bulan}`;
}

async function generateNomorInvoice(tx, tanggal) {
  const prefix = buatPrefixInvoice(tanggal);

  const terakhir = await tx.invoice.findFirst({
    where: {
      no: {
        startsWith: prefix,
      },
    },
    orderBy: {
      no: "desc",
    },
    select: {
      no: true,
    },
  });

  let nomorUrut = 1;

  if (terakhir?.no) {
    const bagianNomor = terakhir.no.slice(prefix.length + 1);
    const nomorTerakhir = parseInt(bagianNomor, 10);

    if (!Number.isNaN(nomorTerakhir)) {
      nomorUrut = nomorTerakhir + 1;
    }
  }

  return `${prefix}-${String(nomorUrut).padStart(4, "0")}`;
}

// Include lengkap dipakai di semua endpoint supaya cetak invoice (yang
// butuh data Surat Jalan per baris: tgl kirim, no SJ, sopir, alamat kirim,
// P L T, M3) selalu tersedia tanpa request tambahan.
const includeLengkap = {
  customer: { include: { prices: true } },
  pembayaran: true,
  items: {
    include: {
      suratJalan: {
        include: { armada: true, customer: true },
      },
    },
    orderBy: { id: "asc" },
  },
};

function ringkas(inv) {
  const total = hitungTotal(inv.items);
  const dibayar = inv.pembayaran.reduce((s, p) => s + p.nominal, 0);

  return {
    ...inv,
    total,
    dibayar,
    sisaTagihan: total - dibayar,
  };
}

// Buat data 1 item invoice. Kalau suratJalanId diisi, keterangan/qty/satuan
// otomatis ikut data Surat Jalan tsb (kecuali dikirim manual), hargaSatuan
// tetap harus dikirim dari frontend (auto-suggest dari harga customer, atau
// diketik manual, lalu masih bisa diubah lewat tombol "Update Harga").
async function buildItemData(tx, it) {
  let keterangan = it.keterangan;
  let qty = it.qty;
  let satuan = it.satuan;

  if (it.suratJalanId) {
    const sj = await tx.suratJalan.findUnique({
      where: { id: it.suratJalanId },
    });

    if (!sj) {
      throw Object.assign(new Error("Surat jalan tidak ditemukan"), {
        status: 400,
      });
    }

    keterangan = keterangan || sj.jenisBarang || sj.tujuan;
    qty = qty ?? sj.m3;
    satuan = satuan || "m3";
  }

  return {
    suratJalanId: it.suratJalanId || null,
    keterangan,
    qty: Number(qty) || 0,
    satuan: satuan || null,
    hargaSatuan: Number(it.hargaSatuan) || 0,
  };
}

// ============================================================
// DAFTAR INVOICE
// ============================================================

router.get("/", async (req, res, next) => {
  try {
    const { customerId, dari, sampai, status, divisi } = req.query;

    const where = {
      ...scopeDivisi(req),
      ...(customerId ? { customerId } : {}),
      ...(status ? { status } : {}),
      ...(divisi ? { divisi } : {}),
    };

    if (dari || sampai) {
      where.tanggal = {
        ...(dari ? { gte: new Date(dari) } : {}),
        ...(sampai ? { lte: new Date(`${sampai}T23:59:59`) } : {}),
      };
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: includeLengkap,
      orderBy: {
        tanggal: "desc",
      },
    });

    res.json(invoices.map(ringkas));
  } catch (e) {
    next(e);
  }
});

// ============================================================
// DETAIL INVOICE
// ============================================================

router.get("/:id", async (req, res, next) => {
  try {
    const inv = await prisma.invoice.findUnique({
      where: {
        id: req.params.id,
      },
      include: includeLengkap,
    });

    if (!inv) {
      return res.status(404).json({
        error: "Invoice tidak ditemukan",
      });
    }

    res.json(ringkas(inv));
  } catch (e) {
    next(e);
  }
});

// ============================================================
// BUAT INVOICE BARU
// Nomor invoice dibuat otomatis oleh backend
// ============================================================

router.post("/", async (req, res, next) => {
  try {
    const {
      divisi,
      customerId,
      tanggal,
      jatuhTempo,
      catatan,
      halaman,
      items,
    } = req.body;

    if (
      !divisi ||
      !customerId ||
      !tanggal ||
      !items?.length
    ) {
      return res.status(400).json({
        error:
          "Divisi, customer, tanggal, dan minimal 1 item wajib diisi",
      });
    }

    const invoice = await prisma.$transaction(async (tx) => {
      const no = await generateNomorInvoice(tx, tanggal);
      const itemsData = await Promise.all(
        items.map((it) => buildItemData(tx, it))
      );

      return tx.invoice.create({
        data: {
          no,
          divisi,
          customerId,
          tanggal: new Date(tanggal),
          jatuhTempo: jatuhTempo
            ? new Date(jatuhTempo)
            : null,
          halaman: Number(halaman) || 1,
          catatan,

          items: {
            create: itemsData,
          },
        },

        include: includeLengkap,
      });
    });

    res.status(201).json(ringkas(invoice));
  } catch (e) {
    // Kalau terjadi bentrok nomor invoice
    if (e.code === "P2002") {
      return res.status(409).json({
        error:
          "Nomor invoice sudah dipakai (atau salah satu surat jalan sudah tertagih di invoice lain), silakan coba lagi",
      });
    }

    next(e);
  }
});

// ============================================================
// UPDATE INVOICE (header)
// ============================================================

router.put("/:id", async (req, res, next) => {
  try {
    const {
      customerId,
      tanggal,
      jatuhTempo,
      catatan,
      halaman,
    } = req.body;

    await prisma.invoice.update({
      where: {
        id: req.params.id,
      },

      data: {
        customerId,
        tanggal: tanggal
          ? new Date(tanggal)
          : undefined,
        jatuhTempo: jatuhTempo
          ? new Date(jatuhTempo)
          : null,
        halaman: halaman !== undefined ? Number(halaman) || 1 : undefined,
        catatan,
      },
    });

    const inv = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: includeLengkap,
    });

    res.json(ringkas(inv));
  } catch (e) {
    next(e);
  }
});

// ============================================================
// ITEM INVOICE: tambah, ubah harga/qty, hapus
// ============================================================

router.post("/:id/items", async (req, res, next) => {
  try {
    const itemData = await prisma.$transaction((tx) =>
      buildItemData(tx, req.body)
    );

    await prisma.invoiceItem.create({
      data: { ...itemData, invoiceId: req.params.id },
    });

    const inv = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: includeLengkap,
    });

    res.status(201).json(ringkas(inv));
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({
        error: "Surat jalan ini sudah dipakai di invoice lain",
      });
    }
    next(e);
  }
});

// Dipakai tombol "Update Harga": ubah harga satuan / qty satu baris item
router.put("/:id/items/:itemId", async (req, res, next) => {
  try {
    const { hargaSatuan, qty, keterangan } = req.body;

    await prisma.invoiceItem.update({
      where: { id: req.params.itemId },
      data: {
        ...(hargaSatuan !== undefined ? { hargaSatuan: Number(hargaSatuan) } : {}),
        ...(qty !== undefined ? { qty: Number(qty) } : {}),
        ...(keterangan !== undefined ? { keterangan } : {}),
      },
    });

    const inv = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: includeLengkap,
    });

    res.json(ringkas(inv));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id/items/:itemId", async (req, res, next) => {
  try {
    await prisma.invoiceItem.delete({
      where: { id: req.params.itemId },
    });

    const inv = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: includeLengkap,
    });

    res.json(ringkas(inv));
  } catch (e) {
    next(e);
  }
});

// ============================================================
// HAPUS INVOICE
// ============================================================

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.invoice.delete({
      where: {
        id: req.params.id,
      },
    });

    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ============================================================
// PEMBAYARAN INVOICE
// ============================================================

router.post("/:id/pembayaran", async (req, res, next) => {
  try {
    const {
      tanggal,
      nominal,
      metode,
      catatan,
    } = req.body;

    if (!tanggal || !nominal) {
      return res.status(400).json({
        error: "Tanggal dan nominal wajib diisi",
      });
    }

    await prisma.pembayaran.create({
      data: {
        invoiceId: req.params.id,
        tanggal: new Date(tanggal),
        nominal: Number(nominal),
        metode,
        catatan,
      },
    });

    const inv = await prisma.invoice.findUnique({
      where: {
        id: req.params.id,
      },

      include: includeLengkap,
    });

    const total = hitungTotal(inv.items);

    const dibayar = inv.pembayaran.reduce(
      (s, p) => s + p.nominal,
      0
    );

    const status = hitungStatus(
      total,
      dibayar
    );

    const updated = await prisma.invoice.update({
      where: {
        id: req.params.id,
      },

      data: {
        status,
      },

      include: includeLengkap,
    });

    res.status(201).json(ringkas(updated));
  } catch (e) {
    next(e);
  }
});

export default router;
