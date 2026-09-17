import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";
import { DIVISI_LIST } from "../config/divisiConfig.js";

const router = Router();

// Ringkasan angka untuk halaman Dashboard.
// Selain angka lama (total invoice/tagihan/piutang/surat jalan), sekarang
// ditambah statistik yang diminta: piutang per customer, pemakaian alat per
// kategori (Bucket/Breker/Mobilisasi), tren tagihan vs pembayaran per bulan,
// dan pengeluaran uang makan operator (yang sengaja TIDAK ditagih ke customer).
router.get("/", async (req, res, next) => {
  try {
    const where = scopeDivisi(req);

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        items: true,
        pembayaran: true,
        customer: { select: { id: true, nama: true } },
      },
    });

    const nilaiItem = (it) => Number(it.qty) * Number(it.hargaSatuan);

    let totalTagihan = 0;
    let totalDibayar = 0;
    const perCustomer = new Map();
    const perKategoriAlat = new Map();
    const perBulan = new Map();

    for (const inv of invoices) {
      const tagihan = inv.items.reduce((s, it) => s + nilaiItem(it), 0);
      const dibayar = inv.pembayaran.reduce((s, p) => s + Number(p.nominal), 0);
      totalTagihan += tagihan;
      totalDibayar += dibayar;

      const nama = inv.customer?.nama || "(tanpa customer)";
      const c = perCustomer.get(nama) || {
        customerId: inv.customer?.id || null,
        nama,
        tagihan: 0,
        dibayar: 0,
        jumlahInvoice: 0,
      };
      c.tagihan += tagihan;
      c.dibayar += dibayar;
      c.jumlahInvoice += 1;
      perCustomer.set(nama, c);

      for (const it of inv.items) {
        if (!it.kategoriAlat) continue;
        const k = perKategoriAlat.get(it.kategoriAlat) || {
          kategori: it.kategoriAlat,
          nilai: 0,
          jam: 0,
        };
        k.nilai += nilaiItem(it);
        if (it.satuan === "jam") k.jam += Number(it.qty);
        perKategoriAlat.set(it.kategoriAlat, k);
      }

      const bk = `${inv.tanggal.getFullYear()}-${String(inv.tanggal.getMonth() + 1).padStart(2, "0")}`;
      const b = perBulan.get(bk) || { bulan: bk, tagihan: 0, dibayar: 0 };
      b.tagihan += tagihan;
      perBulan.set(bk, b);

      for (const p of inv.pembayaran) {
        const pk = `${p.tanggal.getFullYear()}-${String(p.tanggal.getMonth() + 1).padStart(2, "0")}`;
        const pb = perBulan.get(pk) || { bulan: pk, tagihan: 0, dibayar: 0 };
        pb.dibayar += Number(p.nominal);
        perBulan.set(pk, pb);
      }
    }

    const belumLunas = invoices.filter((i) => i.status !== "LUNAS").length;

    const suratJalanDraft = await prisma.suratJalan.count({
      where: { ...where, isDraft: true },
    });
    const suratJalanBelumTTD = await prisma.suratJalan.count({
      where: { ...where, statusTTD: "BELUM_TTD" },
    });

    // Uang makan operator = pengeluaran internal, bukan tagihan ke customer.
    // Ditampilkan terpisah supaya jelas kenapa dia tidak menambah omzet.
    const uangMakan = await prisma.divisiTx.aggregate({
      where: { ...where, kelompok: "Uang Makan Operator" },
      _sum: { nominal: true },
      _count: true,
    });

    const topCustomer = [...perCustomer.values()]
      .map((c) => ({ ...c, sisa: c.tagihan - c.dibayar }))
      .sort((a, b) => b.sisa - a.sisa)
      .slice(0, 10);

    // ------------------------------------------------------------
    // Statistik tambahan: ringkasan SEMUA KATEGORI/DIVISI BISNIS bulan ini
    // (gabungan Invoice + transaksi manual divisi, bukan cuma dari Invoice
    // seperti angka-angka di atas), dan data harian buat kalender aktivitas
    // di Dashboard.
    // ------------------------------------------------------------
    const now = new Date();
    const bulanIni = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const awalBulan = new Date(now.getFullYear(), now.getMonth(), 1);
    const akhirBulan = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [invoicesBulanIni, txBulanIni, suratJalanBulanIni] = await Promise.all([
      prisma.invoice.findMany({
        where: { ...where, tanggal: { gte: awalBulan, lte: akhirBulan } },
        include: { items: true },
      }),
      prisma.divisiTx.findMany({
        where: { ...where, tanggal: { gte: awalBulan, lte: akhirBulan } },
      }),
      prisma.suratJalan.findMany({
        where: { ...where, tanggal: { gte: awalBulan, lte: akhirBulan } },
        select: { id: true, tanggal: true },
      }),
    ]);

    // Ringkasan per divisi bulan ini (Pendapatan = Invoice + transaksi
    // manual bertipe PENJUALAN, Pengeluaran = transaksi manual bertipe
    // PENGELUARAN) -- ini yang bikin Dashboard nampilin SEMUA kategori
    // bisnis, bukan cuma yang lewat Invoice.
    const perDivisiBulanIni = DIVISI_LIST.map((divisi) => {
      const invDivisi = invoicesBulanIni.filter((i) => i.divisi === divisi);
      const penjualanInvoice = invDivisi.reduce(
        (s, i) => s + i.items.reduce((a, it) => a + Number(it.qty) * Number(it.hargaSatuan), 0),
        0
      );
      const txDivisi = txBulanIni.filter((t) => t.divisi === divisi);
      const penjualanTx = txDivisi.filter((t) => t.tipe === "PENJUALAN").reduce((s, t) => s + t.nominal, 0);
      const pengeluaranTx = txDivisi.filter((t) => t.tipe === "PENGELUARAN").reduce((s, t) => s + t.nominal, 0);
      const totalPenjualan = penjualanInvoice + penjualanTx;
      return {
        divisi,
        totalPenjualan,
        totalPengeluaran: pengeluaranTx,
        labaBersih: totalPenjualan - pengeluaranTx,
      };
    }).filter((d) => d.totalPenjualan || d.totalPengeluaran);

    // Data harian bulan ini buat kalender aktivitas: tiap tanggal yang ada
    // kegiatannya (invoice terbit, transaksi manual dicatat, atau surat
    // jalan dibuat) dikumpulkan jumlah & nilainya, dipakai frontend buat
    // menandai tanggal ramai di kalender.
    const kalenderMap = new Map();
    function tambahKalender(tgl, field, nilai) {
      const key = tgl.toISOString().slice(0, 10);
      const h = kalenderMap.get(key) || {
        tanggal: key,
        invoiceCount: 0,
        invoiceTotal: 0,
        txCount: 0,
        txTotal: 0,
        suratJalanCount: 0,
      };
      h[field] += nilai;
      kalenderMap.set(key, h);
    }
    for (const inv of invoicesBulanIni) {
      const total = inv.items.reduce((s, it) => s + Number(it.qty) * Number(it.hargaSatuan), 0);
      tambahKalender(inv.tanggal, "invoiceCount", 1);
      tambahKalender(inv.tanggal, "invoiceTotal", total);
    }
    for (const t of txBulanIni) {
      tambahKalender(t.tanggal, "txCount", 1);
      tambahKalender(t.tanggal, "txTotal", t.tipe === "PENJUALAN" ? t.nominal : -t.nominal);
    }
    for (const sj of suratJalanBulanIni) {
      tambahKalender(sj.tanggal, "suratJalanCount", 1);
    }
    const kalender = [...kalenderMap.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal));

    res.json({
      totalInvoice: invoices.length,
      totalTagihan,
      totalDibayar,
      sisaPiutang: totalTagihan - totalDibayar,
      invoiceBelumLunas: belumLunas,
      suratJalanDraft,
      suratJalanBelumTTD,
      // --- statistik tambahan ---
      topCustomer,
      perKategoriAlat: [...perKategoriAlat.values()].sort((a, b) => b.nilai - a.nilai),
      perBulan: [...perBulan.values()].sort((a, b) => a.bulan.localeCompare(b.bulan)).slice(-12),
      uangMakanOperator: {
        total: uangMakan._sum.nominal || 0,
        jumlahTransaksi: uangMakan._count || 0,
      },
      // --- statistik tambahan v2: semua kategori + kalender ---
      bulanIni,
      perDivisiBulanIni,
      kalender,
    });
  } catch (e) {
    next(e);
  }
});

export default router;