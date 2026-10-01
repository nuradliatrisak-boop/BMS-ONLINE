import { Router } from "express";
import prisma from "../prismaClient.js";
import { buildDefaultDokumenData } from "../config/dokumenConfig.js";

const router = Router();

// Kalau sopirId diisi (pilih dari master Sopir), nama sopirnya "dicache"
// juga ke kolom teks `sopir` supaya tampilan lama (kartu armada, search,
// dsb) yang masih baca kolom teks tetap ikut sinkron tanpa perlu diubah.
// Kalau sopirId dikosongkan, kolom teks tetap dipakai apa adanya (manual).
async function resolveSopirText(sopirId, sopirManual) {
  if (sopirId) {
    const s = await prisma.sopir.findUnique({ where: { id: sopirId } });
    return s ? s.nama : sopirManual || null;
  }
  return sopirManual || null;
}

router.get("/", async (req, res, next) => {
  try {
    // Daftar master kendaraan sengaja TIDAK dibatasi per-divisi (beda dengan
    // data keuangan seperti DivisiTx/rekap): armada dipakai lintas divisi --
    // mis. Supplier perlu lihat kendaraan Armada untuk mencatat sewa, dan
    // dropdown nopol di Laporan Divisi (kelompok "pendapatan") butuh lihat
    // semua kendaraan divisi "Armada" apa pun divisi akun yang login.
    const armada = await prisma.armada.findMany({
      orderBy: { nopol: "asc" },
      include: { sopirRef: true },
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
//
// Perbaikan sinkronisasi:
//  - Surat Jalan dikaitkan ke kendaraan lewat armadaId ATAU (kalau armadaId
//    kosong, mis. nopol cuma diketik manual di SJ) lewat kecocokan nopol
//    yang sudah dinormalisasi. Sebelumnya hanya armadaId, jadi ritasi/m3
//    kendaraan itu terbaca 0.
//  - Pemilahan bulan memakai zona WIB (UTC+7), bukan UTC, supaya data
//    tanggal 1 / akhir bulan tidak meleset ke bulan lain.
//  - Ada ringkasan per SOPIR (perSopir) yang dihitung dari Surat Jalan
//    (sopirId), bukan dari "sopir yang sedang memegang kendaraan" -- sopir
//    bisa pindah-pindah kendaraan, jadi ritasi & komisinya melekat ke orang.
//  - Transaksi/SJ yang tidak cocok ke kendaraan manapun dilaporkan di
//    `tidakCocok` supaya kelihatan kalau ada nopol yang salah ketik.
const WIB_MS = 7 * 60 * 60 * 1000;
const bulanWIB = (d) => new Date(new Date(d).getTime() + WIB_MS).toISOString().slice(0, 7);
const normNopol = (s) => (s || "").toString().toUpperCase().replace(/\s+/g, "");
const normNama = (s) => (s || "").toString().trim().toLowerCase().replace(/\s+/g, " ");

// Rentang query dilebarkan 1 hari di kedua sisi, lalu disaring ulang pakai
// bulanWIB() -- aman baik tanggal tersimpan sebagai 00:00 UTC maupun 00:00 WIB.
function rentangBulan(bulan) {
  const [y, m] = bulan.split("-").map(Number);
  return {
    gte: new Date(Date.UTC(y, m - 1, 1) - 24 * 60 * 60 * 1000),
    lt: new Date(Date.UTC(y, m, 1) + 24 * 60 * 60 * 1000),
  };
}

router.get("/rekap/:bulan", async (req, res, next) => {
  try {
    const { bulan } = req.params; // "YYYY-MM"
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan)) {
      return res.status(400).json({ error: "Format bulan harus YYYY-MM" });
    }
    // Rekap Armada sengaja TIDAK dibatasi per-divisi login: halaman ini
    // memang untuk melihat gambaran lintas-divisi (kendaraan "Armada" yang
    // disewa "Supplier" dst harus tetap kelihatan sinkron apa pun divisi
    // akun yang sedang login) -- beda dengan Laporan Divisi (kerja harian
    // per divisi) yang memang sengaja dibatasi.
    const range = rentangBulan(bulan);

    const [armadaList, sopirList, sjRaw, txRaw] = await Promise.all([
      prisma.armada.findMany({ orderBy: { nopol: "asc" } }),
      prisma.sopir.findMany({ select: { id: true, nama: true } }),
      prisma.suratJalan.findMany({
        where: { isDraft: false, tanggal: range },
        select: {
          id: true,
          tanggal: true,
          armadaId: true,
          noPolisi: true,
          sopirId: true,
          sopir: true,
          m3: true,
          statusTTD: true,
          uangKomisi: true,
          komisiDiambil: true,
        },
      }),
      prisma.divisiTx.findMany({ where: { divisi: "Armada", tanggal: range } }),
    ]);
    const sjBulan = sjRaw.filter((s) => bulanWIB(s.tanggal) === bulan);
    const txBulan = txRaw.filter((t) => t.subKategori && bulanWIB(t.tanggal) === bulan);

    // --- kunci sopir: pakai id master kalau ada; kalau cuma teks, coba
    // cocokkan nama ke master supaya "Wartono" di Armada & SJ jadi 1 orang.
    const sopirNama = new Map(sopirList.map((s) => [s.id, s.nama]));
    const namaKeId = new Map(sopirList.map((s) => [normNama(s.nama), s.id]));
    const sopirKey = (id, teks) => {
      const sid = id || namaKeId.get(normNama(teks));
      if (sid) return `id:${sid}`;
      return normNama(teks) ? `nama:${normNama(teks)}` : "-";
    };

    // --- kaitkan tiap SJ ke 1 kendaraan: armadaId dulu, lalu nopol.
    const armadaIds = new Set(armadaList.map((a) => a.id));
    const armadaByNopol = new Map();
    for (const a of armadaList) {
      const k = normNopol(a.nopol);
      if (k && !armadaByNopol.has(k)) armadaByNopol.set(k, a.id);
    }
    const tripsByArmada = new Map();
    const sjTanpaKendaraan = [];
    for (const s of sjBulan) {
      const aid =
        (s.armadaId && armadaIds.has(s.armadaId) && s.armadaId) ||
        armadaByNopol.get(normNopol(s.noPolisi)) ||
        null;
      if (!aid) {
        sjTanpaKendaraan.push(s);
        continue;
      }
      if (!tripsByArmada.has(aid)) tripsByArmada.set(aid, []);
      tripsByArmada.get(aid).push(s);
    }

    const rekap = armadaList.map((a) => {
      const trips = tripsByArmada.get(a.id) || [];
      const ritasi = trips.length;
      const totalM3 = trips.reduce((s, t) => s + (t.m3 || 0), 0);

      const txNopol = txBulan.filter((t) => normNopol(t.subKategori) === normNopol(a.nopol));
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
        sopirId: a.sopirId,
        sopirKey: sopirKey(a.sopirId, a.sopir),
        divisi: a.divisi,
        volume: a.volume,
        ritasi,
        totalM3,
        pendapatan,
        sparepart,
        hasilBersih: pendapatan - sparepart,
      };
    });

    // --- ringkasan per sopir (dari Surat Jalan)
    const armadaNopol = new Map(armadaList.map((a) => [a.id, a.nopol]));
    const perSopirMap = new Map();
    for (const [aid, trips] of tripsByArmada) {
      for (const s of trips) addSopir(s, armadaNopol.get(aid));
    }
    for (const s of sjTanpaKendaraan) addSopir(s, s.noPolisi);
    function addSopir(s, nopol) {
      const key = sopirKey(s.sopirId, s.sopir);
      if (!perSopirMap.has(key)) {
        const sid = key.startsWith("id:") ? key.slice(3) : null;
        perSopirMap.set(key, {
          sopirKey: key,
          sopirId: sid,
          sopir: (sid && sopirNama.get(sid)) || s.sopir || "(Tanpa Sopir)",
          ritasi: 0,
          totalM3: 0,
          komisi: 0, // hanya tugas selesai (TTD lengkap) -- sama dengan Buku komisi
          komisiBelumDiambil: 0,
          nopol: new Set(),
        });
      }
      const acc = perSopirMap.get(key);
      acc.ritasi += 1;
      acc.totalM3 += s.m3 || 0;
      if (nopol) acc.nopol.add(nopol);
      if (s.statusTTD === "LENGKAP") {
        const k = Number(s.uangKomisi || 0);
        acc.komisi += k;
        if (!s.komisiDiambil) acc.komisiBelumDiambil += k;
      }
    }
    const perSopir = Array.from(perSopirMap.values())
      .map((r) => ({ ...r, nopol: Array.from(r.nopol) }))
      .sort((a, b) => a.sopir.localeCompare(b.sopir));

    // --- transaksi yang subKategorinya tidak cocok ke kendaraan manapun
    const nopolSet = new Set(armadaList.map((a) => normNopol(a.nopol)));
    const txTidakCocok = txBulan.filter((t) => !nopolSet.has(normNopol(t.subKategori)));

    const totalRitasi = rekap.reduce((s, r) => s + r.ritasi, 0);
    const totalPendapatan = rekap.reduce((s, r) => s + r.pendapatan, 0);
    const totalSparepart = rekap.reduce((s, r) => s + r.sparepart, 0);

    res.json({
      bulan,
      rekap,
      perSopir,
      tidakCocok: {
        sjJumlah: sjTanpaKendaraan.length,
        txJumlah: txTidakCocok.length,
        txNopol: Array.from(new Set(txTidakCocok.map((t) => t.subKategori))),
        txPendapatan: txTidakCocok.filter((t) => t.tipe === "PENJUALAN").reduce((s, t) => s + t.nominal, 0),
        txPengeluaran: txTidakCocok.filter((t) => t.tipe === "PENGELUARAN").reduce((s, t) => s + t.nominal, 0),
      },
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
    const { nopol, jenis, sopir, sopirId, divisi, panjang, lebar, tinggi, volume } = req.body;
    if (!nopol || !jenis || !divisi) {
      return res.status(400).json({ error: "Nopol, jenis, dan divisi wajib diisi" });
    }
    const armada = await prisma.armada.create({
      data: {
        nopol,
        jenis,
        sopir: await resolveSopirText(sopirId, sopir),
        sopirId: sopirId || null,
        divisi,
        panjang: panjang !== undefined && panjang !== "" ? Number(panjang) : null,
        lebar: lebar !== undefined && lebar !== "" ? Number(lebar) : null,
        tinggi: tinggi !== undefined && tinggi !== "" ? Number(tinggi) : null,
        volume: volume !== undefined && volume !== "" ? Number(volume) : null,
      },
    });

    // Bikinin baris dokumen kelengkapan wajib (kosong dulu): STNK, KIR, Foto Mobil.
    await prisma.dokumen.createMany({
      data: buildDefaultDokumenData("MOBIL", armada.id),
    });

    res.status(201).json(armada);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { nopol, jenis, sopir, sopirId, divisi, panjang, lebar, tinggi, volume } = req.body;
    const armada = await prisma.armada.update({
      where: { id: req.params.id },
      data: {
        nopol,
        jenis,
        sopir: await resolveSopirText(sopirId, sopir),
        sopirId: sopirId || null,
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
    // Dokumen kelengkapan (STNK/KIR/dst) bukan foreign key (relasi
    // polimorfik), jadi harus ikut dihapus manual biar tidak jadi sampah.
    await prisma.dokumen.deleteMany({ where: { asetTipe: "MOBIL", asetId: req.params.id } });
    await prisma.armada.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
