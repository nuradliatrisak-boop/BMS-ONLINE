import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";
import { DIVISI_LIST, DIVISI_CONFIG, getMirrorTarget, MIRROR_SOURCE_PREFIX } from "../config/divisiConfig.js";

const router = Router();

// --- Sinkronisasi otomatis Armada/Alat Berat -> Supplier ("Sewa Armada &
// Excavator"), mengikuti rumus di Excel. Lihat komentar di divisiConfig.js.
function isAutoMirror(tx) {
  return !!tx?.sumber && tx.sumber.startsWith(MIRROR_SOURCE_PREFIX);
}

async function syncMirrorTx(sourceTx) {
  const target = getMirrorTarget(sourceTx);
  const tagSumber = `${MIRROR_SOURCE_PREFIX}${sourceTx.id}`;
  const existing = await prisma.divisiTx.findFirst({ where: { sumber: tagSumber } });

  if (!target) {
    if (existing) await prisma.divisiTx.delete({ where: { id: existing.id } });
    return;
  }

  const data = {
    divisi: "Supplier",
    tipe: "PENGELUARAN",
    kelompok: "sewa",
    kategori: target.kategori,
    subKategori: target.subKategori,
    keterangan: `Otomatis dari ${sourceTx.divisi} \u2014 ${sourceTx.kategori}${
      sourceTx.subKategori ? ` (${sourceTx.subKategori})` : ""
    }`,
    nominal: sourceTx.nominal,
    tanggal: sourceTx.tanggal,
    sumber: tagSumber,
  };

  if (existing) {
    await prisma.divisiTx.update({ where: { id: existing.id }, data });
  } else {
    await prisma.divisiTx.create({ data });
  }
}

async function deleteMirrorOf(sourceId) {
  await prisma.divisiTx.deleteMany({ where: { sumber: `${MIRROR_SOURCE_PREFIX}${sourceId}` } });
}

// Konfigurasi kelompok/kategori per divisi (dipakai frontend untuk membangun
// form "Catat Transaksi" dan urutan section pada Laporan Divisi).
router.get("/config", (req, res) => {
  res.json({ divisiList: DIVISI_LIST, config: DIVISI_CONFIG });
});

router.get("/", async (req, res, next) => {
  try {
    const { bulan } = req.query; // format "YYYY-MM", opsional
    const where = scopeDivisi(req);
    const list = await prisma.divisiTx.findMany({
      where,
      orderBy: { tanggal: "desc" },
    });
    const filtered = bulan
      ? list.filter((t) => t.tanggal.toISOString().slice(0, 7) === bulan)
      : list;
    res.json(filtered);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const {
      divisi,
      tipe,
      kelompok,
      kategori,
      subKategori,
      keterangan,
      qty,
      hargaSatuan,
      nominal,
      tanggal,
    } = req.body;

    if (!divisi || !tipe || !kelompok || !kategori || !tanggal) {
      return res
        .status(400)
        .json({ error: "Divisi, tipe, kelompok, kategori, dan tanggal wajib diisi" });
    }

    const pakaiQty = qty !== undefined && qty !== null && qty !== "" &&
      hargaSatuan !== undefined && hargaSatuan !== null && hargaSatuan !== "";
    const nominalFinal = pakaiQty ? Number(qty) * Number(hargaSatuan) : Number(nominal);

    if (!nominalFinal || nominalFinal <= 0) {
      return res
        .status(400)
        .json({ error: "Nominal (atau Qty x Harga Satuan) wajib diisi dan lebih dari 0" });
    }

    const tx = await prisma.divisiTx.create({
      data: {
        divisi,
        tipe: tipe.toUpperCase(),
        kelompok,
        kategori,
        subKategori: subKategori || null,
        keterangan: keterangan || null,
        qty: pakaiQty ? Number(qty) : null,
        hargaSatuan: pakaiQty ? Number(hargaSatuan) : null,
        nominal: nominalFinal,
        tanggal: new Date(tanggal),
      },
    });
    await syncMirrorTx(tx);
    res.status(201).json(tx);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const current = await prisma.divisiTx.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Transaksi tidak ditemukan" });

    if (isAutoMirror(current)) {
      return res.status(400).json({
        error:
          "Transaksi ini otomatis mengikuti input Pendapatan di divisi Armada/Alat Berat (Sewa Armada & Excavator). Ubah dari transaksi asalnya di divisi tersebut.",
      });
    }

    const {
      divisi = current.divisi,
      tipe = current.tipe,
      kelompok,
      kategori,
      subKategori,
      keterangan,
      qty,
      hargaSatuan,
      nominal,
      tanggal,
    } = req.body;

    if (!divisi || !tipe || !kelompok || !kategori || !tanggal) {
      return res.status(400).json({ error: "Divisi, tipe, kelompok, kategori, dan tanggal wajib diisi" });
    }

    const pakaiQty = qty !== undefined && qty !== null && qty !== "" &&
      hargaSatuan !== undefined && hargaSatuan !== null && hargaSatuan !== "";
    const nominalFinal = pakaiQty ? Number(qty) * Number(hargaSatuan) : Number(nominal);
    if (!Number.isFinite(nominalFinal) || nominalFinal <= 0) {
      return res.status(400).json({ error: "Nominal (atau Qty x Harga Satuan) wajib diisi dan lebih dari 0" });
    }

    const tx = await prisma.divisiTx.update({
      where: { id: req.params.id },
      data: {
        divisi,
        tipe: String(tipe).toUpperCase(),
        kelompok,
        kategori,
        subKategori: subKategori || null,
        keterangan: keterangan || null,
        qty: pakaiQty ? Number(qty) : null,
        hargaSatuan: pakaiQty ? Number(hargaSatuan) : null,
        nominal: nominalFinal,
        tanggal: new Date(tanggal),
      },
    });
    await syncMirrorTx(tx);
    res.json(tx);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const current = await prisma.divisiTx.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Transaksi tidak ditemukan" });

    if (isAutoMirror(current)) {
      return res.status(400).json({
        error:
          "Transaksi ini otomatis mengikuti input Pendapatan di divisi Armada/Alat Berat (Sewa Armada & Excavator). Hapus dari transaksi asalnya di divisi tersebut.",
      });
    }

    await prisma.divisiTx.delete({ where: { id: req.params.id } });
    await deleteMirrorOf(current.id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Rekap per unit Excavator/Alat Berat untuk satu bulan (pendapatan dari
// kelompok "pendapatan", pengeluaran operasional dari kelompok "operasional"
// -- uang makan/sparepart/solar digabung jadi satu total per unit). Sama
// polanya dengan /armada/rekap/:bulan, dipakai halaman "Alat Berat".
router.get("/alat-berat/rekap/:bulan", async (req, res, next) => {
  try {
    const { bulan } = req.params;
    const scope = scopeDivisi(req);
    if (scope.divisi && scope.divisi !== "Alat Berat") {
      return res.json({ bulan, unit: [], total: { pendapatan: 0, pengeluaran: 0, hasilBersih: 0 } });
    }

    const config = DIVISI_CONFIG["Alat Berat"];
    const kelPendapatan = config.kelompok.find((k) => k.key === "pendapatan");
    const kelOperasional = config.kelompok.find((k) => k.key === "operasional");

    const txAll = await prisma.divisiTx.findMany({ where: { divisi: "Alat Berat" } });
    const tx = txAll.filter((t) => t.tanggal.toISOString().slice(0, 7) === bulan);

    const unitNames = new Set([
      ...(kelPendapatan?.kategoriDefault || []),
      ...(kelOperasional?.kategoriDefault || []),
      ...tx.filter((t) => t.kelompok === "pendapatan" || t.kelompok === "operasional").map((t) => t.kategori),
    ]);

    const unit = Array.from(unitNames).map((nama) => {
      const pendapatan = tx
        .filter((t) => t.kelompok === "pendapatan" && t.kategori === nama)
        .reduce((s, t) => s + t.nominal, 0);
      const pengeluaranTx = tx.filter((t) => t.kelompok === "operasional" && t.kategori === nama);
      const pengeluaran = pengeluaranTx.reduce((s, t) => s + t.nominal, 0);
      const rincian = ["Uang Makan", "Sparepart", "Solar"].map((sub) => ({
        subKategori: sub,
        nominal: pengeluaranTx.filter((t) => t.subKategori === sub).reduce((s, t) => s + t.nominal, 0),
      }));
      return { nama, pendapatan, pengeluaran, hasilBersih: pendapatan - pengeluaran, rincian };
    });

    const total = {
      pendapatan: unit.reduce((s, u) => s + u.pendapatan, 0),
      pengeluaran: unit.reduce((s, u) => s + u.pengeluaran, 0),
    };
    total.hasilBersih = total.pendapatan - total.pengeluaran;

    res.json({ bulan, unit, total });
  } catch (e) {
    next(e);
  }
});

// Laporan Laba Rugi per divisi per bulan, dikelompokkan persis seperti
// Excel: tiap "kelompok" (section) berisi baris-baris "kategori" yang
// dijumlah dari semua transaksi bulan itu. Penjualan dari Invoice sistem
// otomatis dimasukkan sebagai baris tambahan di kelompok Penjualan/Pendapatan
// pertama, supaya tidak perlu dicatat ulang manual.
router.get("/laporan/:divisi/:bulan", async (req, res, next) => {
  try {
    const { divisi, bulan } = req.params; // bulan = "YYYY-MM"
    const config = DIVISI_CONFIG[divisi] || { kelompok: [] };

    const invoices = await prisma.invoice.findMany({
      where: { divisi },
      include: { items: true },
    });
    const penjualanInvoice = invoices
      .filter((i) => i.tanggal.toISOString().slice(0, 7) === bulan)
      .reduce((s, i) => s + i.items.reduce((a, it) => a + it.qty * it.hargaSatuan, 0), 0);

    const txAll = await prisma.divisiTx.findMany({ where: { divisi } });
    const tx = txAll.filter((t) => t.tanggal.toISOString().slice(0, 7) === bulan);

    let invoiceRowUsed = false;

    const kelompokResult = config.kelompok.map((k) => {
      const items = tx.filter((t) => t.kelompok === k.key);
      const map = new Map();
      for (const it of items) {
        const rowKey = `${it.kategori}||${it.subKategori || ""}`;
        if (!map.has(rowKey)) {
          map.set(rowKey, { kategori: it.kategori, subKategori: it.subKategori || null, nominal: 0 });
        }
        map.get(rowKey).nominal += it.nominal;
      }

      // Baris default tetap tampil walau nominal masih 0, biar bentuknya
      // konsisten seperti template Excel.
      for (const defKat of k.kategoriDefault || []) {
        if (!map.has(`${defKat}||`)) {
          map.set(`${defKat}||`, { kategori: defKat, subKategori: null, nominal: 0 });
        }
      }

      let rows = Array.from(map.values());

      // Selipkan pendapatan dari Invoice sistem ke kelompok Penjualan/Pendapatan pertama.
      if (!invoiceRowUsed && k.tipe === "PENJUALAN" && penjualanInvoice > 0) {
        rows.unshift({ kategori: "Invoice (Sistem)", subKategori: null, nominal: penjualanInvoice });
        invoiceRowUsed = true;
      }

      const order = k.kategoriDefault || [];
      rows.sort((a, b) => {
        const ia = order.indexOf(a.kategori);
        const ib = order.indexOf(b.kategori);
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });

      const subtotal = rows.reduce((s, r) => s + r.nominal, 0);
      return { key: k.key, label: k.label, tipe: k.tipe, hasQty: !!k.hasQty, rows, subtotal };
    });

    // Kalau tidak ada satupun kelompok Penjualan (mis. divisi belum dikonfigurasi)
    // tapi ada pendapatan dari invoice, tetap tampilkan biar tidak hilang.
    if (!invoiceRowUsed && penjualanInvoice > 0) {
      kelompokResult.unshift({
        key: "penjualan-sistem",
        label: "Penjualan (Sistem)",
        tipe: "PENJUALAN",
        hasQty: false,
        rows: [{ kategori: "Invoice (Sistem)", subKategori: null, nominal: penjualanInvoice }],
        subtotal: penjualanInvoice,
      });
    }

    const totalPenjualan = kelompokResult
      .filter((k) => k.tipe === "PENJUALAN")
      .reduce((s, k) => s + k.subtotal, 0);
    const totalPengeluaran = kelompokResult
      .filter((k) => k.tipe === "PENGELUARAN")
      .reduce((s, k) => s + k.subtotal, 0);

    res.json({
      divisi,
      bulan,
      kelompok: kelompokResult,
      totalPenjualan,
      totalPengeluaran,
      labaBersih: totalPenjualan - totalPengeluaran,
    });
  } catch (e) {
    next(e);
  }
});

// Rekap Keseluruhan: laporan laba-rugi per divisi dengan filter RENTANG
// TANGGAL bebas (bukan cuma satu bulan seperti /laporan/:divisi/:bulan),
// dan bisa dipilih "semua divisi sekaligus" (untuk dicetak keseluruhan)
// ATAU satu divisi saja (untuk dicetak per-divisi) -- dipakai halaman
// "Rekap Keseluruhan" di frontend.
// Query: ?dari=YYYY-MM-DD&sampai=YYYY-MM-DD&divisi=<nama divisi | ALL>
router.get("/rekap-keseluruhan", async (req, res, next) => {
  try {
    const { dari, sampai } = req.query;
    const divisiFilter = req.query.divisi && req.query.divisi !== "ALL" ? req.query.divisi : null;
    if (!dari || !sampai) {
      return res.status(400).json({ error: "Parameter dari dan sampai wajib diisi" });
    }

    const scope = scopeDivisi(req);
    const divisiList = divisiFilter
      ? [divisiFilter]
      : DIVISI_LIST.filter((d) => !scope.divisi || scope.divisi === d);

    // Rentang tanggal inklusif: "sampai" digenapkan ke akhir hari itu.
    const tglMulai = new Date(`${dari}T00:00:00`);
    const tglAkhir = new Date(`${sampai}T23:59:59.999`);

    const invoices = await prisma.invoice.findMany({
      where: { ...scope, tanggal: { gte: tglMulai, lte: tglAkhir } },
      include: { items: true },
    });
    const txAll = await prisma.divisiTx.findMany({
      where: { ...scope, tanggal: { gte: tglMulai, lte: tglAkhir } },
    });

    const hasil = divisiList.map((divisi) => {
      const config = DIVISI_CONFIG[divisi] || { kelompok: [] };
      const tx = txAll.filter((t) => t.divisi === divisi);
      const penjualanInvoice = invoices
        .filter((i) => i.divisi === divisi)
        .reduce((s, i) => s + i.items.reduce((a, it) => a + it.qty * it.hargaSatuan, 0), 0);

      let invoiceRowUsed = false;
      const kelompok = config.kelompok.map((k) => {
        const items = tx.filter((t) => t.kelompok === k.key);
        const map = new Map();
        for (const it of items) {
          const rowKey = `${it.kategori}||${it.subKategori || ""}`;
          if (!map.has(rowKey)) {
            map.set(rowKey, { kategori: it.kategori, subKategori: it.subKategori || null, nominal: 0 });
          }
          map.get(rowKey).nominal += it.nominal;
        }
        for (const defKat of k.kategoriDefault || []) {
          if (!map.has(`${defKat}||`)) {
            map.set(`${defKat}||`, { kategori: defKat, subKategori: null, nominal: 0 });
          }
        }
        let rows = Array.from(map.values()).filter((r) => r.nominal !== 0 || (k.kategoriDefault || []).includes(r.kategori));

        if (!invoiceRowUsed && k.tipe === "PENJUALAN" && penjualanInvoice > 0) {
          rows.unshift({ kategori: "Invoice (Sistem)", subKategori: null, nominal: penjualanInvoice });
          invoiceRowUsed = true;
        }

        const order = k.kategoriDefault || [];
        rows.sort((a, b) => {
          const ia = order.indexOf(a.kategori);
          const ib = order.indexOf(b.kategori);
          if (ia === -1 && ib === -1) return 0;
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        });

        const subtotal = rows.reduce((s, r) => s + r.nominal, 0);
        return { key: k.key, label: k.label, tipe: k.tipe, hasQty: !!k.hasQty, rows, subtotal };
      });

      if (!invoiceRowUsed && penjualanInvoice > 0) {
        kelompok.unshift({
          key: "penjualan-sistem",
          label: "Penjualan (Sistem)",
          tipe: "PENJUALAN",
          hasQty: false,
          rows: [{ kategori: "Invoice (Sistem)", subKategori: null, nominal: penjualanInvoice }],
          subtotal: penjualanInvoice,
        });
      }

      const totalPenjualan = kelompok.filter((k) => k.tipe === "PENJUALAN").reduce((s, k) => s + k.subtotal, 0);
      const totalPengeluaran = kelompok.filter((k) => k.tipe === "PENGELUARAN").reduce((s, k) => s + k.subtotal, 0);

      return {
        divisi,
        kelompok,
        totalPenjualan,
        totalPengeluaran,
        labaBersih: totalPenjualan - totalPengeluaran,
      };
    });

    const grandTotal = {
      totalPenjualan: hasil.reduce((s, d) => s + d.totalPenjualan, 0),
      totalPengeluaran: hasil.reduce((s, d) => s + d.totalPengeluaran, 0),
    };
    grandTotal.labaBersih = grandTotal.totalPenjualan - grandTotal.totalPengeluaran;

    res.json({ dari, sampai, divisi: hasil, grandTotal });
  } catch (e) {
    next(e);
  }
});

// Import massal dari Excel (dipakai oleh parser di frontend, lihat
// frontend/src/utils/excelImport.js). Body: { items: [{ divisi, tipe,
// kelompok, kategori, subKategori, qty, hargaSatuan, nominal, tanggal,
// sumber }, ...] }
//
// Duplikat (kombinasi divisi+kelompok+kategori+subKategori+tanggal+nominal
// yang sama persis) dilewati otomatis, supaya file yang sama aman
// diimport ulang tanpa membuat data dobel.
router.post("/import", async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Tidak ada data untuk diimport" });
    }

    const divisiScope = req.user.role === "ADMIN" ? null : req.user.divisi;
    const divisiDiluarAkses = new Set();

    let dilewati = 0;
    let dibuat = 0;
    const dibuatList = [];

    for (const raw of items) {
      const divisi = String(raw.divisi || "").trim();
      const kelompok = String(raw.kelompok || "").trim();
      const kategori = String(raw.kategori || "").trim();
      const subKategori = raw.subKategori ? String(raw.subKategori).trim() : null;
      const tipe = String(raw.tipe || "").toUpperCase();
      const nominal = Number(raw.nominal);
      const tanggal = raw.tanggal ? new Date(raw.tanggal) : null;

      if (!divisi || !kelompok || !kategori || !tipe || !nominal || !tanggal || isNaN(tanggal)) {
        continue; // baris tidak lengkap/valid, lewati diam-diam
      }
      if (divisiScope && divisi !== divisiScope) {
        divisiDiluarAkses.add(divisi);
        continue;
      }

      const existing = await prisma.divisiTx.findFirst({
        where: { divisi, kelompok, kategori, subKategori, tanggal, nominal },
      });
      if (existing) {
        dilewati++;
        continue;
      }

      const tx = await prisma.divisiTx.create({
        data: {
          divisi,
          tipe,
          kelompok,
          kategori,
          subKategori,
          qty: raw.qty != null && raw.qty !== "" ? Number(raw.qty) : null,
          hargaSatuan: raw.hargaSatuan != null && raw.hargaSatuan !== "" ? Number(raw.hargaSatuan) : null,
          nominal,
          tanggal,
          sumber: raw.sumber ? String(raw.sumber).slice(0, 255) : null,
        },
      });
      dibuat++;
      dibuatList.push(tx);
    }

    res.status(201).json({
      dibuat,
      dilewati,
      divisiDiluarAkses: [...divisiDiluarAkses],
      items: dibuatList,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
