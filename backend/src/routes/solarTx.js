import { Router } from "express";
import fs from "fs";
import path from "path";
import prisma from "../prismaClient.js";
import { uploadBukti, UPLOAD_DIR } from "../middleware/upload.js";
import { geocodeLokasi } from "../services/geocode.js";

const router = Router();

// ------------------------------------------------------------
// Nomor otomatis PENDEK: "SM-YYMMDD-XX" (Masuk) / "SK-YYMMDD-XX" (Keluar).
// XX = urutan ke berapa di tanggal itu (reset tiap hari, cukup 2 digit
// karena dalam praktiknya tidak akan sampai 99 transaksi/hari/tipe).
// Sengaja jauh lebih pendek dari nomor Surat Jalan (BMS-SJ-YYYYMM-XXXX)
// karena ini cuma catatan internal stok, bukan dokumen yang diberikan ke
// pihak luar.
// ------------------------------------------------------------
function two(n) {
  return String(n).padStart(2, "0");
}

async function generateNoSolar(tipe, tanggal) {
  const d = new Date(tanggal);
  const yy = two(d.getFullYear() % 100);
  const mm = two(d.getMonth() + 1);
  const dd = two(d.getDate());
  const prefix = `${tipe === "MASUK" ? "SM" : "SK"}-${yy}${mm}${dd}`;

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

// ------------------------------------------------------------
// Nama: dianggap SAMA walau beda huruf besar/kecil ("aceng" == "Aceng").
// Disimpan dalam 1 ejaan baku supaya laporan/rekap per nama tidak terpecah.
// ------------------------------------------------------------
function rapikanSpasi(n) {
  return String(n || "").trim().replace(/\s+/g, " ");
}

function namaKey(n) {
  return rapikanSpasi(n).toLowerCase();
}

function titleCase(n) {
  return rapikanSpasi(n)
    .toLowerCase()
    .replace(/(^|[\s.\-'])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
}

// Kalau nama itu sudah pernah tercatat (mis. "Aceng"), pakai ejaan yang
// sudah ada supaya seragam. Kalau belum pernah ada -> Huruf Awal Kapital.
async function bakukanNama(nama) {
  const bersih = rapikanSpasi(nama);
  if (!bersih) return bersih;
  const key = namaKey(bersih);
  const rows = await prisma.solarTx.findMany({ select: { nama: true }, distinct: ["nama"] });
  const cocok = rows.map((r) => r.nama).filter((n) => namaKey(n) === key);
  const tc = titleCase(bersih);
  if (cocok.includes(tc)) return tc;
  const berkapital = cocok.find((n) => /^\p{Lu}/u.test(n));
  return berkapital || tc;
}

// ------------------------------------------------------------
// Cek keesokan hari (Solar Masuk).
// `liter`        = stok REAL yang benar-benar masuk (dipakai untuk saldo stok).
// `literCatatan` = angka di BUKU CATATAN sopir untuk tanggal itu (H); dicek
//                  keesokan harinya (H+1) dengan angka real. null = catatan
//                  buku belum diisi.
//   selisih = liter - literCatatan   (minus = KURANG setor, plus = LEBIH)
// Saldo per sopir dijumlah berurutan dari yang paling lama, jadi kelebihan
// setor otomatis menutup kekurangan sebelumnya.
// ------------------------------------------------------------
const TZ = "Asia/Jakarta";
function hariIni() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}
function tglStr(d) {
  return new Date(d).toISOString().slice(0, 10);
}
const r2 = (x) => Math.round(x * 100) / 100;

function hitungCek(list) {
  const today = hariIni();
  const asc = list
    .filter((t) => t.tipe === "MASUK")
    .sort(
      (a, b) =>
        new Date(a.tanggal) - new Date(b.tanggal) || new Date(a.createdAt) - new Date(b.createdAt)
    );
  const saldo = new Map(); // key nama -> utang berjalan (+ = masih kurang setor)
  const out = new Map();
  for (const t of asc) {
    const jatuhTempo = tglStr(t.tanggal) < today; // baru boleh dicek mulai besoknya
    if (t.literCatatan == null) {
      out.set(t.id, { statusCek: jatuhTempo ? "BELUM_DICEK" : "MENUNGGU", bisaDicek: jatuhTempo });
      continue;
    }
    const key = namaKey(t.nama);
    const sebelum = saldo.get(key) || 0;
    const selisih = r2(t.liter - t.literCatatan);
    const sesudah = r2(sebelum - selisih);
    saldo.set(key, sesudah);
    const lebih = Math.max(selisih, 0);
    const menutupUtang = r2(Math.min(lebih, Math.max(sebelum, 0)));
    out.set(t.id, {
      statusCek: selisih === 0 ? "SESUAI" : selisih < 0 ? "KURANG" : "LEBIH",
      bisaDicek: jatuhTempo,
      selisih,
      saldoSebelum: sebelum,
      saldoSesudah: sesudah,
      menutupUtang,
      lebihMurni: r2(lebih - menutupUtang),
    });
  }
  return out;
}


function serialize(tx) {
  return {
    ...tx,
    buktiUrl: tx.buktiFile ? `/uploads/solar/${tx.buktiFile}` : null,
  };
}

// GET /api/solar-tx?bulan=YYYY-MM              -> filter satu bulan
// GET /api/solar-tx?dari=YYYY-MM-DD&sampai=YYYY-MM-DD -> filter rentang tanggal (inklusif)
// GET /api/solar-tx                             -> semua waktu (tanpa filter)
router.get("/", async (req, res, next) => {
  try {
    const { bulan, dari, sampai } = req.query;
    const list = await prisma.solarTx.findMany({ orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }] });
    const cek = hitungCek(list); // dihitung dari SELURUH data (saldo per sopir berjalan)

    let filtered = list;
    if (bulan) {
      filtered = list.filter((t) => t.tanggal.toISOString().slice(0, 7) === bulan);
    } else if (dari || sampai) {
      const dariMs = dari ? new Date(dari + "T00:00:00").getTime() : -Infinity;
      const sampaiMs = sampai ? new Date(sampai + "T23:59:59.999").getTime() : Infinity;
      filtered = list.filter((t) => {
        const ms = new Date(t.tanggal).getTime();
        return ms >= dariMs && ms <= sampaiMs;
      });
    }

    const items = filtered.map((t) => ({ ...serialize(t), ...(cek.get(t.id) || {}) }));

    const masukF = filtered.filter((t) => t.tipe === "MASUK");
    const totalMasuk = masukF.reduce((s, t) => s + t.liter, 0);
    // Total menurut buku catatan sopir (hanya baris yang catatannya sudah diisi)
    const totalCatatan = masukF.reduce((s, t) => s + (t.literCatatan ?? 0), 0);
    const totalKeluar = filtered.filter((t) => t.tipe === "KELUAR").reduce((s, t) => s + t.liter, 0);
    const totalKurang = r2(masukF.reduce((s, t) => s + Math.max(-(cek.get(t.id)?.selisih || 0), 0), 0));
    const totalLebih = r2(masukF.reduce((s, t) => s + Math.max(cek.get(t.id)?.selisih || 0, 0), 0));
    const belumDicek = masukF.filter((t) => cek.get(t.id)?.statusCek === "BELUM_DICEK").length;

    // Saldo berjalan dihitung dari SELURUH data (tidak dibatasi filter bulan),
    // supaya "sisa stok saat ini" selalu akurat walau sedang lihat bulan lama.
    const totalMasukSemua = list.filter((t) => t.tipe === "MASUK").reduce((s, t) => s + t.liter, 0);
    const totalKeluarSemua = list.filter((t) => t.tipe === "KELUAR").reduce((s, t) => s + t.liter, 0);
    const belumDicekSemua = list.filter((t) => cek.get(t.id)?.statusCek === "BELUM_DICEK").length;

    res.json({
      items,
      totalMasuk,
      totalCatatan,
      totalKeluar,
      totalKurang,
      totalLebih,
      belumDicek,
      belumDicekSemua,
      saldoBulan: totalMasuk - totalKeluar,
      saldoSaatIni: totalMasukSemua - totalKeluarSemua,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/solar-tx/nama?tipe=MASUK|KELUAR -> daftar nama unik (untuk dropdown),
// nama yang sama beda huruf besar/kecil digabung jadi satu.
router.get("/nama", async (req, res, next) => {
  try {
    const tipe = String(req.query.tipe || "").toUpperCase();
    const where = ["MASUK", "KELUAR"].includes(tipe) ? { tipe } : {};
    const rows = await prisma.solarTx.findMany({ where, select: { nama: true }, distinct: ["nama"] });
    const map = new Map();
    for (const { nama } of rows) {
      const k = namaKey(nama);
      if (!k) continue;
      const cur = map.get(k);
      // ejaan berawalan kapital diutamakan
      if (!cur || (!/^\p{Lu}/u.test(cur) && /^\p{Lu}/u.test(nama))) map.set(k, rapikanSpasi(nama));
    }
    res.json([...map.values()].sort((a, b) => a.localeCompare(b, "id")));
  } catch (e) {
    next(e);
  }
});

// GET /api/solar-tx/belum-dicek -> SEMUA solar masuk yang catatan bukunya
// belum diisi dan sudah waktunya dicek (tanggal sebelum hari ini), semua
// tanggal, urut dari yang paling lama. Dipakai panel "Cek Solar Masuk":
// angka real (sudah ada) tampil berdampingan dengan kolom catatan buku.
router.get("/belum-dicek", async (req, res, next) => {
  try {
    const today = hariIni();
    const list = await prisma.solarTx.findMany({
      where: { tipe: "MASUK", literCatatan: null },
      orderBy: [{ tanggal: "asc" }, { createdAt: "asc" }],
    });
    res.json(
      list
        .filter((t) => tglStr(t.tanggal) < today)
        .map((t) => ({ id: t.id, no: t.no, tanggal: t.tanggal, nama: t.nama, liter: t.liter, keterangan: t.keterangan }))
    );
  } catch (e) {
    next(e);
  }
});

// POST /api/solar-tx/catatan-massal  body: { items: [{ id, literCatatan }] }
// Simpan banyak angka catatan buku sekaligus. Baris yang tidak valid dilewati
// dan dilaporkan di `dilewati`.
router.post("/catatan-massal", async (req, res, next) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: "Tidak ada data untuk disimpan" });
    const rows = await prisma.solarTx.findMany({ where: { id: { in: items.map((i) => String(i.id)) } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ops = [];
    const dilewati = [];
    for (const it of items) {
      const cur = byId.get(String(it.id));
      const catatan = Number(it.literCatatan);
      if (!cur || cur.tipe !== "MASUK") { dilewati.push({ id: it.id, alasan: "Data tidak ditemukan" }); continue; }
      if (it.literCatatan === "" || it.literCatatan == null || !Number.isFinite(catatan) || catatan < 0) {
        dilewati.push({ id: it.id, alasan: "Angka catatan tidak valid" });
        continue;
      }
      ops.push(prisma.solarTx.update({ where: { id: cur.id }, data: { literCatatan: catatan } }));
    }
    if (ops.length) await prisma.$transaction(ops);
    res.json({ disimpan: ops.length, dilewati });
  } catch (e) {
    next(e);
  }
});

// GET /api/solar-tx/utang -> rekap per sopir dari SEMUA solar masuk yang sudah
// dicek. saldo > 0 = masih kurang setor (utang), saldo <= 0 = lunas/lebih.
router.get("/utang", async (req, res, next) => {
  try {
    const list = await prisma.solarTx.findMany({
      where: { tipe: "MASUK" },
      orderBy: [{ tanggal: "asc" }, { createdAt: "asc" }],
    });
    const cek = hitungCek(list);
    const map = new Map();
    for (const t of list) {
      const key = namaKey(t.nama);
      const r = map.get(key) || { nama: rapikanSpasi(t.nama), totalDicatat: 0, totalReal: 0, saldo: 0, jumlahCek: 0, belumDicek: 0 };
      r.nama = rapikanSpasi(t.nama); // ejaan terbaru
      if (t.literCatatan != null) {
        r.totalDicatat += t.literCatatan;
        r.totalReal += t.liter;
        r.jumlahCek += 1;
      } else if (cek.get(t.id)?.statusCek === "BELUM_DICEK") {
        r.belumDicek += 1;
      }
      map.set(key, r);
    }
    const rekap = [...map.values()]
      .map((r) => ({ ...r, totalDicatat: r2(r.totalDicatat), totalReal: r2(r.totalReal), saldo: r2(r.totalDicatat - r.totalReal) }))
      .filter((r) => r.jumlahCek > 0 || r.belumDicek > 0)
      .sort((a, b) => b.saldo - a.saldo || a.nama.localeCompare(b.nama, "id"));
    res.json(rekap);
  } catch (e) {
    next(e);
  }
});

// GET /api/solar-tx/peta -> titik lokasi Solar Keluar (lat/lng) + total liter,
// buat "Peta Solar". Terima filter waktu yang sama dengan GET / (bulan ATAU
// dari/sampai). Lokasi yang belum ketemu koordinatnya (geocoding gagal/belum
// sempat jalan) dikumpulkan terpisah di `tanpaKoordinat`.
router.get("/peta", async (req, res, next) => {
  try {
    const { bulan, dari, sampai } = req.query;
    const list = await prisma.solarTx.findMany({ where: { tipe: "KELUAR" } });

    let filtered = list;
    if (bulan) {
      filtered = list.filter((t) => t.tanggal.toISOString().slice(0, 7) === bulan);
    } else if (dari || sampai) {
      const dariMs = dari ? new Date(dari + "T00:00:00").getTime() : -Infinity;
      const sampaiMs = sampai ? new Date(sampai + "T23:59:59.999").getTime() : Infinity;
      filtered = list.filter((t) => {
        const ms = new Date(t.tanggal).getTime();
        return ms >= dariMs && ms <= sampaiMs;
      });
    }

    const map = new Map();
    for (const t of filtered) {
      if (!t.lokasi || t.lokasiLat == null || t.lokasiLng == null) continue;
      const p = map.get(t.lokasi) || { lokasi: t.lokasi, lat: t.lokasiLat, lng: t.lokasiLng, liter: 0, jumlah: 0 };
      p.liter += t.liter;
      p.jumlah += 1;
      map.set(t.lokasi, p);
    }
    const tanpaKoordinat = [
      ...new Set(filtered.filter((t) => t.lokasi && (t.lokasiLat == null || t.lokasiLng == null)).map((t) => t.lokasi)),
    ];

    res.json({ titik: [...map.values()].sort((a, b) => b.liter - a.liter), tanpaKoordinat });
  } catch (e) {
    next(e);
  }
});

// POST /api/solar-tx  (multipart/form-data, field "bukti" opsional untuk file)
router.post("/", uploadBukti.single("bukti"), async (req, res, next) => {
  try {
    const { tipe, tanggal, nama, liter, lokasi, keterangan, literCatatan } = req.body;

    if (!tipe || !["MASUK", "KELUAR"].includes(String(tipe).toUpperCase())) {
      return res.status(400).json({ error: "Tipe wajib diisi (MASUK/KELUAR)" });
    }
    if (!tanggal || !nama || liter === undefined || liter === "") {
      return res.status(400).json({ error: "Tanggal, nama, dan jumlah liter wajib diisi" });
    }
    const literNum = toNum(liter);
    if (literNum <= 0) {
      return res.status(400).json({ error: "Jumlah liter harus lebih dari 0" });
    }

    const tipeUp = String(tipe).toUpperCase();
    const namaFinal = await bakukanNama(nama);
    let catatanFinal = null;
    if (tipeUp === "MASUK" && literCatatan !== undefined && literCatatan !== null && literCatatan !== "") {
      catatanFinal = Number(literCatatan);
      if (!Number.isFinite(catatanFinal) || catatanFinal < 0) {
        return res.status(400).json({ error: "Catatan buku harus berupa angka 0 atau lebih" });
      }
    }
    const no = await generateNoSolar(tipeUp, tanggal);
    const lokasiFinal = tipeUp === "KELUAR" ? lokasi || null : null;
    // Geocode otomatis dari teks lokasi (opsional) -> titik langsung muncul
    // di Peta Solar tanpa staf perlu menandai manual. Gagal geocode tidak
    // menggagalkan penyimpanan transaksinya.
    const geo = lokasiFinal ? await geocodeLokasi(lokasiFinal) : { lat: null, lng: null };

    const tx = await prisma.solarTx.create({
      data: {
        no,
        tipe: tipeUp,
        tanggal: new Date(tanggal),
        nama: namaFinal,
        liter: literNum,
        literCatatan: catatanFinal,
        lokasi: lokasiFinal,
        lokasiLat: geo.lat,
        lokasiLng: geo.lng,
        keterangan: keterangan || null,
        buktiFile: req.file ? req.file.filename : null,
        buktiNama: req.file ? req.file.originalname : null,
      },
    });
    res.status(201).json(serialize(tx));
  } catch (e) {
    next(e);
  }
});

// PUT /api/solar-tx/:id (multipart juga, supaya bisa ganti/tambah bukti saat edit)
router.put("/:id", uploadBukti.single("bukti"), async (req, res, next) => {
  try {
    const current = await prisma.solarTx.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Data tidak ditemukan" });

    const { tanggal, nama, liter, lokasi, keterangan, hapusBukti, literCatatan } = req.body;
    if (!tanggal || !nama || liter === undefined || liter === "") {
      return res.status(400).json({ error: "Tanggal, nama, dan jumlah liter wajib diisi" });
    }
    const literNum = toNum(liter);
    if (literNum <= 0) {
      return res.status(400).json({ error: "Jumlah liter harus lebih dari 0" });
    }

    // Catatan buku: tidak dikirim = tetap; dikirim kosong = dihapus (null).
    let catatanFinal = current.literCatatan;
    if (current.tipe === "MASUK" && literCatatan !== undefined) {
      if (literCatatan === "" || literCatatan === null) {
        catatanFinal = null;
      } else {
        catatanFinal = Number(literCatatan);
        if (!Number.isFinite(catatanFinal) || catatanFinal < 0) {
          return res.status(400).json({ error: "Catatan buku harus berupa angka 0 atau lebih" });
        }
      }
    }

    let buktiFile = current.buktiFile;
    let buktiNama = current.buktiNama;

    // Ganti/upload bukti baru -> hapus file lama dari disk
    if (req.file) {
      if (current.buktiFile) {
        const old = path.join(UPLOAD_DIR, "solar", current.buktiFile);
        fs.unlink(old, () => {});
      }
      buktiFile = req.file.filename;
      buktiNama = req.file.originalname;
    } else if (String(hapusBukti) === "true") {
      if (current.buktiFile) {
        const old = path.join(UPLOAD_DIR, "solar", current.buktiFile);
        fs.unlink(old, () => {});
      }
      buktiFile = null;
      buktiNama = null;
    }

    const lokasiFinal = current.tipe === "KELUAR" ? lokasi || null : null;
    // Geocode ulang hanya kalau teks lokasinya berubah, supaya tidak
    // memanggil layanan geocoding setiap kali baris ini diedit (mis. cuma
    // ganti keterangan/bukti).
    let geo = { lat: current.lokasiLat, lng: current.lokasiLng };
    if (lokasiFinal !== current.lokasi) {
      geo = lokasiFinal ? await geocodeLokasi(lokasiFinal) : { lat: null, lng: null };
    }

    const tx = await prisma.solarTx.update({
      where: { id: req.params.id },
      data: {
        tanggal: new Date(tanggal),
        nama: await bakukanNama(nama),
        liter: literNum,
        literCatatan: catatanFinal,
        lokasi: lokasiFinal,
        lokasiLat: geo.lat,
        lokasiLng: geo.lng,
        keterangan: keterangan || null,
        buktiFile,
        buktiNama,
      },
    });
    res.json(serialize(tx));
  } catch (e) {
    next(e);
  }
});

// POST /api/solar-tx/:id/catatan  -> isi catatan buku sopir untuk 1 baris Solar
// Masuk. Body: { literCatatan? }. Tanpa literCatatan = dianggap SESUAI (sama
// dengan angka real yang sudah tercatat).
router.post("/:id/catatan", async (req, res, next) => {
  try {
    const current = await prisma.solarTx.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Data tidak ditemukan" });
    if (current.tipe !== "MASUK") {
      return res.status(400).json({ error: "Catatan buku hanya untuk Solar Masuk" });
    }
    const { literCatatan } = req.body || {};
    let catatan = current.liter;
    if (literCatatan !== undefined && literCatatan !== null && literCatatan !== "") {
      catatan = Number(literCatatan);
      if (!Number.isFinite(catatan) || catatan < 0) {
        return res.status(400).json({ error: "Catatan buku harus berupa angka 0 atau lebih" });
      }
    }
    const tx = await prisma.solarTx.update({ where: { id: req.params.id }, data: { literCatatan: catatan } });
    res.json(serialize(tx));
  } catch (e) {
    next(e);
  }
});

// POST /api/solar-tx/:id/hapus-catatan -> kosongkan lagi catatan buku
router.post("/:id/hapus-catatan", async (req, res, next) => {
  try {
    const current = await prisma.solarTx.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Data tidak ditemukan" });
    const tx = await prisma.solarTx.update({ where: { id: req.params.id }, data: { literCatatan: null } });
    res.json(serialize(tx));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const current = await prisma.solarTx.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: "Data tidak ditemukan" });
    await prisma.solarTx.delete({ where: { id: req.params.id } });
    if (current.buktiFile) {
      const old = path.join(UPLOAD_DIR, "solar", current.buktiFile);
      fs.unlink(old, () => {});
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
