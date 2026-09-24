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

// ------------------------------------------------------------
// PENGINDAT / REMINDER -- daftar hal penting yang perlu segera ditindak,
// dikumpulkan dari beberapa sumber sekaligus supaya admin tidak perlu
// buka satu-satu menu Invoice/Dokumen/Jadwal Setor tiap hari:
//   - Invoice belum lunas yang jatuh temponya sudah lewat atau <= 7 hari lagi
//   - Dokumen aset (STNK/KIR/dll) yang sudah/akan kadaluarsa dalam 30 hari
//   - Jadwal Setor Solar hari ini yang belum direalisasi
// Diurutkan dari yang paling mendesak (lewat/expired dulu).
// ------------------------------------------------------------
router.get("/reminder", async (req, res, next) => {
  try {
    const where = scopeDivisi(req);
    const now = new Date();
    const H7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const H30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const todayStr = now.toISOString().slice(0, 10);

    const reminder = [];

    // --- Invoice jatuh tempo (belum lunas, <= 7 hari lagi atau sudah lewat) ---
    const invoicesJT = await prisma.invoice.findMany({
      where: { ...where, status: { not: "LUNAS" }, jatuhTempo: { lte: H7 } },
      include: { customer: { select: { nama: true } }, items: true, pembayaran: true },
      orderBy: { jatuhTempo: "asc" },
      take: 30,
    });
    for (const inv of invoicesJT) {
      if (!inv.jatuhTempo) continue;
      const total = inv.items.reduce((s, it) => s + Number(it.qty) * Number(it.hargaSatuan), 0);
      const dibayar = inv.pembayaran.reduce((s, p) => s + Number(p.nominal), 0);
      const sisa = total - dibayar;
      if (sisa <= 0) continue;
      const terlambat = inv.jatuhTempo < now;
      reminder.push({
        jenis: "invoice_jatuh_tempo",
        tingkat: terlambat ? "urgent" : "peringatan",
        judul: `Invoice ${inv.no} — ${inv.customer?.nama || "(tanpa customer)"}`,
        detail: terlambat
          ? `Sudah lewat jatuh tempo (${inv.jatuhTempo.toISOString().slice(0, 10)}), sisa tagihan Rp ${Math.round(sisa).toLocaleString("id-ID")}`
          : `Jatuh tempo ${inv.jatuhTempo.toISOString().slice(0, 10)}, sisa tagihan Rp ${Math.round(sisa).toLocaleString("id-ID")}`,
        tanggal: inv.jatuhTempo.toISOString().slice(0, 10),
        link: `/invoices/${inv.id}`,
      });
    }

    // --- Dokumen aset kadaluarsa/segera kadaluarsa (<= 30 hari) ---
    const dokumenJT = await prisma.dokumen.findMany({
      where: { berlakuSampai: { lte: H30 } },
      orderBy: { berlakuSampai: "asc" },
      take: 30,
    });
    if (dokumenJT.length) {
      const idArmada = dokumenJT.filter((d) => d.asetTipe === "MOBIL").map((d) => d.asetId);
      const idKapal = dokumenJT.filter((d) => d.asetTipe === "KAPAL").map((d) => d.asetId);
      const idAlat = dokumenJT.filter((d) => d.asetTipe === "ALAT_BERAT").map((d) => d.asetId);
      const [armadaList, kapalList, alatList] = await Promise.all([
        idArmada.length ? prisma.armada.findMany({ where: { id: { in: idArmada } } }) : [],
        idKapal.length ? prisma.kapal.findMany({ where: { id: { in: idKapal } } }) : [],
        idAlat.length ? prisma.alatBeratUnit.findMany({ where: { id: { in: idAlat } } }) : [],
      ]);
      const namaAset = new Map();
      for (const a of armadaList) namaAset.set(`MOBIL:${a.id}`, a.nopol);
      for (const k of kapalList) namaAset.set(`KAPAL:${k.id}`, k.nama);
      for (const u of alatList) namaAset.set(`ALAT_BERAT:${u.id}`, u.nama);

      for (const d of dokumenJT) {
        if (!d.berlakuSampai) continue;
        const nama = namaAset.get(`${d.asetTipe}:${d.asetId}`) || "(aset tidak ditemukan)";
        const terlambat = d.berlakuSampai < now;
        reminder.push({
          jenis: "dokumen_kadaluarsa",
          tingkat: terlambat ? "urgent" : "peringatan",
          judul: `${d.label} — ${nama}`,
          detail: terlambat
            ? `Sudah kadaluarsa sejak ${d.berlakuSampai.toISOString().slice(0, 10)}`
            : `Berlaku sampai ${d.berlakuSampai.toISOString().slice(0, 10)}`,
          tanggal: d.berlakuSampai.toISOString().slice(0, 10),
          link: null,
        });
      }
    }

    // --- Solar Masuk yang belum dicek (dicek keesokan harinya) ---
    // Catatan sopir tanggal H baru bisa dicocokkan dengan catatan real mulai
    // H+1, jadi yang dihitung hanya yang tanggalnya sebelum hari ini (WIB).
    const hariIniWib = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const solarBelumDicek = await prisma.solarTx.count({
      where: { tipe: "MASUK", literReal: null, tanggal: { lt: new Date(`${hariIniWib}T00:00:00.000Z`) } },
    });
    if (solarBelumDicek > 0) {
      reminder.push({
        jenis: "solar_belum_dicek",
        tingkat: "peringatan",
        judul: "Solar Masuk belum dicek",
        detail: `${solarBelumDicek} catatan solar masuk belum dicocokkan dengan catatan real`,
        tanggal: todayStr,
        link: "/laporan-divisi?tab=solar",
      });
    }

    const urutan = { urgent: 0, peringatan: 1, info: 2 };
    reminder.sort((a, b) => (urutan[a.tingkat] - urutan[b.tingkat]) || a.tanggal.localeCompare(b.tanggal));

    res.json({ reminder });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------
// PETA STRATEGIS -- gabungan titik lokasi Sewa Alat Berat & Solar Keluar
// dalam satu daftar, ditandai `jenis` supaya frontend bisa kasih warna
// beda per jenis di satu peta yang sama (Dashboard).
// Filter opsional: dari/sampai (YYYY-MM-DD), berlaku untuk kedua jenis data.
// ------------------------------------------------------------
router.get("/peta", async (req, res, next) => {
  try {
    const invoiceWhere = scopeDivisi(req);
    const { dari, sampai } = req.query;

    const tglFilter = {};
    if (dari) tglFilter.gte = new Date(dari);
    if (sampai) {
      const akhir = new Date(sampai);
      akhir.setHours(23, 59, 59, 999);
      tglFilter.lte = akhir;
    }

    const [itemAlat, txSolar] = await Promise.all([
      prisma.invoiceItem.findMany({
        where: {
          kategoriAlat: { not: null },
          lokasi: { not: null },
          ...(dari || sampai ? { tglPakai: tglFilter } : {}),
          invoice: invoiceWhere,
        },
        select: { lokasi: true, lokasiLat: true, lokasiLng: true, qty: true, hargaSatuan: true },
      }),
      prisma.solarTx.findMany({
        where: {
          tipe: "KELUAR",
          lokasi: { not: null },
          ...(dari || sampai ? { tanggal: tglFilter } : {}),
        },
        select: { lokasi: true, lokasiLat: true, lokasiLng: true, liter: true },
      }),
    ]);

    const alatMap = new Map();
    for (const it of itemAlat) {
      if (it.lokasiLat == null || it.lokasiLng == null) continue;
      const p = alatMap.get(it.lokasi) || {
        jenis: "alat_berat",
        lokasi: it.lokasi,
        lat: it.lokasiLat,
        lng: it.lokasiLng,
        nilai: 0,
        baris: 0,
      };
      p.nilai += Number(it.qty) * Number(it.hargaSatuan);
      p.baris += 1;
      alatMap.set(it.lokasi, p);
    }

    const solarMap = new Map();
    for (const t of txSolar) {
      if (t.lokasiLat == null || t.lokasiLng == null) continue;
      const p = solarMap.get(t.lokasi) || {
        jenis: "solar",
        lokasi: t.lokasi,
        lat: t.lokasiLat,
        lng: t.lokasiLng,
        liter: 0,
        baris: 0,
      };
      p.liter += t.liter;
      p.baris += 1;
      solarMap.set(t.lokasi, p);
    }

    res.json({ titik: [...alatMap.values(), ...solarMap.values()] });
  } catch (e) {
    next(e);
  }
});

export default router;