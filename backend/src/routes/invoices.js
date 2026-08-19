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

// ============================================================
// DAFTAR INVOICE
// ============================================================

router.get("/", async (req, res, next) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: scopeDivisi(req),
      include: {
        customer: true,
        items: true,
        pembayaran: true,
      },
      orderBy: {
        tanggal: "desc",
      },
    });

    const hasil = invoices.map((inv) => {
      const total = hitungTotal(inv.items);
      const dibayar = inv.pembayaran.reduce(
        (s, p) => s + p.nominal,
        0
      );

      return {
        ...inv,
        total,
        dibayar,
        sisaTagihan: total - dibayar,
      };
    });

    res.json(hasil);
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
      include: {
        customer: true,
        items: true,
        pembayaran: true,
      },
    });

    if (!inv) {
      return res.status(404).json({
        error: "Invoice tidak ditemukan",
      });
    }

    const total = hitungTotal(inv.items);

    const dibayar = inv.pembayaran.reduce(
      (s, p) => s + p.nominal,
      0
    );

    res.json({
      ...inv,
      total,
      dibayar,
      sisaTagihan: total - dibayar,
    });
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

      return tx.invoice.create({
        data: {
          no,
          divisi,
          customerId,
          tanggal: new Date(tanggal),
          jatuhTempo: jatuhTempo
            ? new Date(jatuhTempo)
            : null,
          catatan,

          items: {
            create: items.map((it) => ({
              keterangan: it.keterangan,
              qty: Number(it.qty),
              satuan: it.satuan,
              hargaSatuan: Number(it.hargaSatuan),
            })),
          },
        },

        include: {
          items: true,
          customer: true,
        },
      });
    });

    res.status(201).json(invoice);
  } catch (e) {
    // Kalau terjadi bentrok nomor invoice
    if (e.code === "P2002") {
      return res.status(409).json({
        error:
          "Nomor invoice sudah dipakai, silakan coba lagi",
      });
    }

    next(e);
  }
});

// ============================================================
// UPDATE INVOICE
// ============================================================

router.put("/:id", async (req, res, next) => {
  try {
    const {
      customerId,
      tanggal,
      jatuhTempo,
      catatan,
    } = req.body;

    const invoice = await prisma.invoice.update({
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
        catatan,
      },
    });

    res.json(invoice);
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

      include: {
        items: true,
        pembayaran: true,
      },
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

      include: {
        items: true,
        pembayaran: true,
        customer: true,
      },
    });

    res.status(201).json({
      ...updated,
      total,
      dibayar,
      sisaTagihan: total - dibayar,
    });
  } catch (e) {
    next(e);
  }
});

export default router;