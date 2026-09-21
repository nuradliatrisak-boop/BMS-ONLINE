import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";
import { buildInvoiceWorkbook } from "../services/invoiceXlsx.js";
import { DEFAULTS as PRINT_CALIB_DEFAULTS } from "./printCalib.js";
import { geocodeLokasi } from "../services/geocode.js";

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

  // "net" per baris & totalNet invoice -- INTERNAL saja (harga jual dikurangi
  // belanja pasir/uang mobil/uang jalan/komisi/uang makan). Field ini
  // sengaja TIDAK dibaca oleh services/invoiceXlsx.js maupun print.js,
  // supaya yang tercetak/terkirim ke customer tetap harga jual biasa.
  const items = inv.items.map((it) => ({ ...it, net: netItem(it) }));
  const totalNet = items.reduce((s, it) => s + it.net, 0);

  return {
    ...inv,
    items,
    total,
    totalNet,
    dibayar,
    sisaTagihan: total - dibayar,
  };
}

// Buat data 1 item invoice. Kalau suratJalanId diisi, keterangan/qty/satuan
// otomatis ikut data Surat Jalan tsb (kecuali dikirim manual), hargaSatuan
// tetap harus dikirim dari frontend (auto-suggest dari harga customer, atau
// diketik manual, lalu masih bisa diubah lewat tombol "Update Harga").
//
// `lokasiGeo` (opsional): hasil geocoding {lat,lng} yang SUDAH DIHITUNG DI
// LUAR transaksi DB (lihat pemanggilnya) -- supaya panggilan ke layanan
// geocoding (bisa lambat/kena rate limit) tidak menahan transaksi Postgres.
async function buildItemData(tx, it, lokasiGeo = null) {
  let keterangan = it.keterangan;
  let qty = it.qty;
  let satuan = it.satuan;

  // Biaya internal (potongan buat hitung Net) -- kalau item ini dikirim
  // dengan nilainya sendiri (mis. dari form "Update Biaya"), pakai itu.
  // Kalau tidak dikirim & baris ini punya suratJalanId, DISALIN otomatis
  // dari 4 kolom biaya di SJ terkait supaya staf tidak perlu isi 2x.
  let belanjaPasir = it.belanjaPasir;
  let uangMobil = it.uangMobil;
  let uangJalan = it.uangJalan;
  let uangKomisi = it.uangKomisi;
  let uangMakan = it.uangMakan;

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

    if (belanjaPasir === undefined) belanjaPasir = sj.belanjaPasir;
    if (uangMobil === undefined) uangMobil = sj.uangMobil;
    if (uangJalan === undefined) uangJalan = sj.uangJalan;
    if (uangKomisi === undefined) uangKomisi = sj.uangKomisi;
  }

  // Baris sewa alat berat (kategoriAlat + unitAlat diisi) & uangMakan belum
  // dikirim manual -> cari otomatis dari master rate UangMakanAlat.
  if (uangMakan === undefined && it.kategoriAlat && it.unitAlat) {
    const rate = await tx.uangMakanAlat.findUnique({
      where: { unitAlat_kategoriAlat: { unitAlat: it.unitAlat, kategoriAlat: it.kategoriAlat } },
    });
    if (rate) uangMakan = rate.nominal;
  }

  return {
    suratJalanId: it.suratJalanId || null,
    keterangan,
    qty: Number(qty) || 0,
    satuan: satuan || null,
    hargaSatuan: Number(it.hargaSatuan) || 0,
    // Khusus baris SEWA ALAT BERAT (opsional). Kalau diisi, baris ini ikut
    // terhitung di menu "Rekap Sewa Alat" & statistik per kategori alat di
    // Dashboard. Invoice material/armada biasa cukup dibiarkan kosong.
    kategoriAlat: it.kategoriAlat || null,
    unitAlat: it.unitAlat || null,
    tglPakai: it.tglPakai ? new Date(it.tglPakai) : null,
    // Lokasi sewa (opsional) + koordinat hasil geocoding otomatis, dipakai
    // statistik & peta per lokasi di menu Rekap Sewa Alat / Dashboard.
    lokasi: it.lokasi || null,
    lokasiLat: lokasiGeo?.lat ?? null,
    lokasiLng: lokasiGeo?.lng ?? null,
    // Biaya (opsional) -- dipotong dari qty*hargaSatuan buat kolom "Net"
    // INTERNAL, lihat catatan di schema.prisma model InvoiceItem.
    belanjaPasir: belanjaPasir !== undefined && belanjaPasir !== null ? Number(belanjaPasir) : null,
    uangMobil: uangMobil !== undefined && uangMobil !== null ? Number(uangMobil) : null,
    uangJalan: uangJalan !== undefined && uangJalan !== null ? Number(uangJalan) : null,
    uangKomisi: uangKomisi !== undefined && uangKomisi !== null ? Number(uangKomisi) : null,
    uangMakan: uangMakan !== undefined && uangMakan !== null ? Number(uangMakan) : null,
  };
}

// Total biaya (potongan) 1 baris invoice -- jumlah semua pos yang keisi.
function totalBiayaItem(it) {
  return (
    (it.belanjaPasir || 0) +
    (it.uangMobil || 0) +
    (it.uangJalan || 0) +
    (it.uangKomisi || 0) +
    (it.uangMakan || 0)
  );
}

// Nilai "Net" INTERNAL 1 baris = harga jual baris ini dikurangi total
// biayanya. Dipakai di halaman edit invoice (internal), TIDAK PERNAH ikut
// di invoiceXlsx.js / print.js (yang dicetak/dikirim ke customer).
function netItem(it) {
  return Number(it.qty) * Number(it.hargaSatuan) - totalBiayaItem(it);
}

// Geocode field `lokasi` tiap item SEBELUM masuk transaksi DB (panggilan ke
// layanan geocoding eksternal bisa lambat -- tidak boleh menahan transaksi
// Postgres terbuka lama-lama). Aman dipakai untuk item tanpa lokasi (hasilnya
// null, tidak memanggil apa-apa).
async function geocodeItems(items) {
  return Promise.all(
    (items || []).map(async (it) => ({
      it,
      geo: it.lokasi ? await geocodeLokasi(it.lokasi) : null,
    }))
  );
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
// EXPORT INVOICE KE EXCEL (.xlsx)
// Dipakai buat orang yang lebih nyaman ngatur & print langsung dari
// Excel (seperti alur lama), daripada dari dialog print browser.
// Margin atas & kiri file ini ikut angka yang sama dengan Kalibrasi
// Cetak > Invoice supaya dua cara cetak (browser & Excel) tetap sinkron.
// ============================================================

router.get("/:id/export-xlsx", async (req, res, next) => {
  try {
    const inv = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: includeLengkap,
    });

    if (!inv) {
      return res.status(404).json({ error: "Invoice tidak ditemukan" });
    }

    const [calibRow, settingRows] = await Promise.all([
      prisma.printCalib.findUnique({ where: { jenis: "inv" } }),
      prisma.setting.findMany(),
    ]);

    const calib = { ...PRINT_CALIB_DEFAULTS.inv, ...(calibRow?.data || {}) };
    const signerName = settingRows.find((s) => s.key === "signerName")?.value || "";

    const wb = await buildInvoiceWorkbook(ringkas(inv), calib, signerName);

    const filename = `Invoice-${(inv.no || "invoice").replace(/[^a-zA-Z0-9-]/g, "_")}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();
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
      !tanggal
    ) {
      return res.status(400).json({
        error:
          "Divisi, customer, dan tanggal wajib diisi",
      });
    }

    const itemsGeo = await geocodeItems(items);

    const invoice = await prisma.$transaction(async (tx) => {
      const no = await generateNomorInvoice(tx, tanggal);
      const itemsData = await Promise.all(
        itemsGeo.map(({ it, geo }) => buildItemData(tx, it, geo))
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
    const lokasiGeo = req.body.lokasi ? await geocodeLokasi(req.body.lokasi) : null;
    const itemData = await prisma.$transaction((tx) =>
      buildItemData(tx, req.body, lokasiGeo)
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
    const {
      hargaSatuan,
      qty,
      keterangan,
      lokasi,
      belanjaPasir,
      uangMobil,
      uangJalan,
      uangKomisi,
      uangMakan,
    } = req.body;

    // Kalau lokasi ikut dikirim & berubah, geocode ulang supaya titik di
    // peta ikut pindah. Kalau lokasi dikosongkan, titiknya ikut dihapus.
    let lokasiData = {};
    if (lokasi !== undefined) {
      const geo = lokasi ? await geocodeLokasi(lokasi) : { lat: null, lng: null };
      lokasiData = { lokasi: lokasi || null, lokasiLat: geo.lat, lokasiLng: geo.lng };
    }

    await prisma.invoiceItem.update({
      where: { id: req.params.itemId },
      data: {
        ...(hargaSatuan !== undefined ? { hargaSatuan: Number(hargaSatuan) } : {}),
        ...(qty !== undefined ? { qty: Number(qty) } : {}),
        ...(keterangan !== undefined ? { keterangan } : {}),
        ...lokasiData,
        // Rincian biaya (internal) -- boleh dikosongkan (null) lagi kalau
        // memang tidak relevan buat baris ini.
        ...(belanjaPasir !== undefined ? { belanjaPasir: belanjaPasir === null || belanjaPasir === "" ? null : Number(belanjaPasir) } : {}),
        ...(uangMobil !== undefined ? { uangMobil: uangMobil === null || uangMobil === "" ? null : Number(uangMobil) } : {}),
        ...(uangJalan !== undefined ? { uangJalan: uangJalan === null || uangJalan === "" ? null : Number(uangJalan) } : {}),
        ...(uangKomisi !== undefined ? { uangKomisi: uangKomisi === null || uangKomisi === "" ? null : Number(uangKomisi) } : {}),
        ...(uangMakan !== undefined ? { uangMakan: uangMakan === null || uangMakan === "" ? null : Number(uangMakan) } : {}),
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