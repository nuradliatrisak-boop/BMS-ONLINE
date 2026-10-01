import { Router } from "express";
import prisma from "../prismaClient.js";
import { bakukanNama, namaKey, namaSerupa, rapikanSpasi } from "../services/solarNama.js";

const router = Router();

// ------------------------------------------------------------
// BUKU CATATAN SOLAR vs SETORAN REAL
//
// ATURAN TANGGAL: buku yang ditulis tanggal T dicek dengan setoran real
// tanggal T+1 (besoknya). Jadi buku tgl 1 dibandingkan dengan Solar Masuk
// tgl 2. Kolom `tanggal` di hasil = tanggal SETORAN (T+1), `tanggalBuku` = T.
//
// Buku  = apa yang tertulis di buku ("si A seharusnya setor X liter").
//         Disimpan di tabel SolarBuku (diinput staf), ditambah angka
//         `literCatatan` lama yang sudah ada di baris SolarTx MASUK
//         (supaya data lama tidak terbuang).
// Real  = SolarTx tipe MASUK (stok yang benar-benar masuk).
//
// Hasil pencocokan per (tanggal + nama):
//   SESUAI        buku = real
//   KURANG        keduanya ada, real lebih sedikit dari buku
//   LEBIH         keduanya ada, real lebih banyak dari buku
//   TIDAK_SETOR   ada di buku, TIDAK ada setoran real
//   TIDAK_DI_BUKU ada setoran real, TIDAK ada di buku
//   MENUNGGU      ada di buku, real belum ada, tapi tanggal setorannya
//                 belum tiba (besok dst). Kalau tanggal setorannya HARI INI
//                 tetap TIDAK_SETOR (dengan masihBisaSetor = true).
//
// Tanggal yang bukunya belum diisi sama sekali TIDAK dianggap
// "tidak di buku" -- kalau tidak, semua setoran sebelum buku mulai
// dimasukkan akan salah ditandai. Tanggal itu dilaporkan terpisah di
// `tanggalBukuKosong`.
// ------------------------------------------------------------

const TZ = "Asia/Jakarta";
const hariIni = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const tglStr = (d) => new Date(d).toISOString().slice(0, 10);
const r2 = (x) => Math.round(x * 100) / 100;
const TGL_RE = /^\d{4}-\d{2}-\d{2}$/;
const addHari = (str, n) => {
  const d = new Date(`${str}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function bacaRentang(q) {
  const today = hariIni();
  const dari = TGL_RE.test(q.dari || "") ? q.dari : `${today.slice(0, 8)}01`;
  const sampai = TGL_RE.test(q.sampai || "") ? q.sampai : today;
  return {
    dari,
    sampai,
    gte: new Date(`${dari}T00:00:00.000Z`),
    lte: new Date(`${sampai}T23:59:59.999Z`),
  };
}

function toLiter(v) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

// ---------------- Rekonsiliasi ----------------
router.get("/rekonsiliasi", async (req, res, next) => {
  try {
    const rg = bacaRentang(req.query);
    const today = hariIni();

    const [buku, real] = await Promise.all([
      prisma.solarBuku.findMany({
        // buku tgl T -> setoran tgl T+1, jadi ambil buku sehari lebih awal
        where: {
          tanggal: {
            gte: new Date(`${addHari(rg.dari, -1)}T00:00:00.000Z`),
            lte: new Date(`${addHari(rg.sampai, -1)}T23:59:59.999Z`),
          },
        },
        orderBy: [{ tanggal: "asc" }, { createdAt: "asc" }],
      }),
      prisma.solarTx.findMany({
        where: { tipe: "MASUK", tanggal: { gte: rg.gte, lte: rg.lte } },
        orderBy: [{ tanggal: "asc" }, { createdAt: "asc" }],
      }),
    ]);

    // kelompokkan per tanggal
    const hari = new Map(); // tgl -> { buku: Map, real: Map }
    const slot = (t) => {
      if (!hari.has(t)) hari.set(t, { buku: new Map(), real: new Map() });
      return hari.get(t);
    };

    for (const b of buku) {
      const tglB = tglStr(b.tanggal);
      const m = slot(addHari(tglB, 1)).buku; // dicek dengan setoran besoknya
      const k = namaKey(b.nama);
      const cur = m.get(k) || { nama: rapikanSpasi(b.nama), liter: 0, ids: [], ket: [], sumber: "BUKU", tglBuku: tglB };
      cur.liter += b.liter;
      cur.ids.push(b.id);
      if (b.keterangan) cur.ket.push(b.keterangan);
      m.set(k, cur);
    }
    for (const t of real) {
      const m = slot(tglStr(t.tanggal)).real;
      const k = namaKey(t.nama);
      const cur = m.get(k) || { nama: rapikanSpasi(t.nama), liter: 0, ids: [], no: [], catatan: null, ket: [] };
      cur.liter += t.liter;
      cur.ids.push(t.id);
      cur.no.push(t.no);
      if (t.literCatatan != null) cur.catatan = (cur.catatan || 0) + t.literCatatan;
      if (t.keterangan) cur.ket.push(t.keterangan);
      m.set(k, cur);
    }

    const rows = [];
    const tanggalBukuKosong = [];

    for (const [tgl, { buku: bm, real: rm }] of hari) {
      // buku efektif = buku tulis (SolarBuku) + catatan lama di baris real
      // (hanya kalau nama itu belum ada di SolarBuku hari yang sama)
      const efektif = new Map(bm);
      for (const [k, r] of rm) {
        if (r.catatan != null && !efektif.has(k)) {
          efektif.set(k, { nama: r.nama, liter: r.catatan, ids: [], ket: [], sumber: "CATATAN_REAL", tglBuku: null });
        }
      }
      const bukuDiisi = efektif.size > 0;

      const realTerpakai = new Set();
      const pasangan = []; // [bukuEntry, realEntry|null]

      // 1) pasangan persis
      for (const [k, b] of efektif) {
        if (rm.has(k)) {
          pasangan.push([b, rm.get(k)]);
          realTerpakai.add(k);
        } else {
          pasangan.push([b, null]);
        }
      }
      // 2) buku yang belum ketemu -> coba nama serupa (singkatan) di real yang belum terpakai
      for (const p of pasangan) {
        if (p[1]) continue;
        for (const [k, r] of rm) {
          if (!realTerpakai.has(k) && namaSerupa(p[0].nama, r.nama)) {
            p[1] = r;
            realTerpakai.add(k);
            break;
          }
        }
      }

      for (const [b, r] of pasangan) {
        if (r) {
          const selisih = r2(r.liter - b.liter);
          rows.push({
            tanggal: tgl,
            tanggalBuku: b.tglBuku,
            nama: r.nama,
            status: selisih === 0 ? "SESUAI" : selisih < 0 ? "KURANG" : "LEBIH",
            bukuLiter: r2(b.liter),
            realLiter: r2(r.liter),
            selisih,
            bukuSumber: b.sumber,
            bukuIds: b.ids,
            realIds: r.ids,
            no: r.no,
            keterangan: [...b.ket, ...r.ket].join("; ") || null,
          });
        } else {
          rows.push({
            tanggal: tgl,
            tanggalBuku: b.tglBuku,
            nama: b.nama,
            // Hari setoran = hari ini tetap dihitung TIDAK_SETOR (staf memang mengecek
            // di hari itu); hanya tanggal yang belum tiba yang "menunggu".
            status: tgl > today ? "MENUNGGU" : "TIDAK_SETOR",
            masihBisaSetor: tgl === today,
            bukuLiter: r2(b.liter),
            realLiter: 0,
            selisih: r2(-b.liter),
            bukuSumber: b.sumber,
            bukuIds: b.ids,
            realIds: [],
            no: [],
            keterangan: b.ket.join("; ") || null,
          });
        }
      }

      // real yang tidak punya pasangan di buku
      const sisaReal = [...rm.entries()].filter(([k]) => !realTerpakai.has(k)).map(([, r]) => r);
      if (bukuDiisi) {
        for (const r of sisaReal) {
          rows.push({
            tanggal: tgl,
            tanggalBuku: addHari(tgl, -1),
            nama: r.nama,
            status: "TIDAK_DI_BUKU",
            bukuLiter: null,
            realLiter: r2(r.liter),
            selisih: r2(r.liter),
            bukuSumber: null,
            bukuIds: [],
            realIds: r.ids,
            no: r.no,
            keterangan: r.ket.join("; ") || null,
          });
        }
      } else if (sisaReal.length) {
        tanggalBukuKosong.push({
          tanggal: tgl,
          tanggalBuku: addHari(tgl, -1),
          setoran: sisaReal.length,
          liter: r2(sisaReal.reduce((s, r) => s + r.liter, 0)),
          daftar: sisaReal.map((r) => ({ nama: r.nama, liter: r2(r.liter) })),
        });
      }
    }

    rows.sort((a, b) => (a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : a.nama.localeCompare(b.nama, "id")));

    // ---- ringkasan ----
    const ringkasan = {
      sesuai: 0, kurang: 0, lebih: 0, tidakSetor: 0, tidakDiBuku: 0, menunggu: 0,
      literTidakSetor: 0, literTidakDiBuku: 0, literKurang: 0, literLebih: 0,
    };
    const perSopir = new Map();
    const sopir = (nama) => {
      const k = namaKey(nama);
      if (!perSopir.has(k)) {
        perSopir.set(k, {
          nama, hariDicek: 0, sesuai: 0,
          tidakSetor: 0, literTidakSetor: 0,
          tidakDiBuku: 0, literTidakDiBuku: 0,
          kurang: 0, kurangLiter: 0, lebih: 0, lebihLiter: 0,
          totalBuku: 0, totalReal: 0, rincian: [],
        });
      }
      return perSopir.get(k);
    };
    for (const r of rows) {
      if (r.status === "MENUNGGU") {
        ringkasan.menunggu++;
        continue;
      }
      const s = sopir(r.nama);
      s.hariDicek++;
      s.totalBuku += r.bukuLiter || 0;
      s.totalReal += r.realLiter || 0;
      if (r.status === "SESUAI") {
        ringkasan.sesuai++;
        s.sesuai++;
        continue;
      }
      s.rincian.push({ tanggal: r.tanggal, tanggalBuku: r.tanggalBuku, masihBisaSetor: !!r.masihBisaSetor, status: r.status, bukuLiter: r.bukuLiter, realLiter: r.realLiter, selisih: r.selisih });
      if (r.status === "TIDAK_SETOR") {
        ringkasan.tidakSetor++;
        ringkasan.literTidakSetor += r.bukuLiter;
        s.tidakSetor++; s.literTidakSetor += r.bukuLiter;
      } else if (r.status === "TIDAK_DI_BUKU") {
        ringkasan.tidakDiBuku++;
        ringkasan.literTidakDiBuku += r.realLiter;
        s.tidakDiBuku++; s.literTidakDiBuku += r.realLiter;
      } else if (r.status === "KURANG") {
        ringkasan.kurang++;
        ringkasan.literKurang += -r.selisih;
        s.kurang++; s.kurangLiter += -r.selisih;
      } else if (r.status === "LEBIH") {
        ringkasan.lebih++;
        ringkasan.literLebih += r.selisih;
        s.lebih++; s.lebihLiter += r.selisih;
      }
    }
    for (const k of ["literTidakSetor", "literTidakDiBuku", "literKurang", "literLebih"]) ringkasan[k] = r2(ringkasan[k]);

    res.json({
      dari: rg.dari,
      sampai: rg.sampai,
      rows,
      ringkasan,
      perSopir: [...perSopir.values()]
        .map((s) => {
          // kurang = yang seharusnya masuk tapi tidak masuk; lebih = yang masuk di luar buku
          const totalKurang = s.literTidakSetor + s.kurangLiter;
          const totalLebih = s.lebihLiter + s.literTidakDiBuku;
          return {
            ...s,
            literTidakSetor: r2(s.literTidakSetor),
            literTidakDiBuku: r2(s.literTidakDiBuku),
            kurangLiter: r2(s.kurangLiter),
            lebihLiter: r2(s.lebihLiter),
            totalBuku: r2(s.totalBuku),
            totalReal: r2(s.totalReal),
            totalKurang: r2(totalKurang),
            totalLebih: r2(totalLebih),
            selisihBersih: r2(totalLebih - totalKurang),
            bermasalah: s.tidakSetor + s.tidakDiBuku + s.kurang + s.lebih > 0,
            rincian: s.rincian.sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1)),
          };
        })
        .sort((a, b) => b.totalKurang - a.totalKurang || b.tidakDiBuku - a.tidakDiBuku || a.nama.localeCompare(b.nama, "id")),
      tanggalBukuKosong: tanggalBukuKosong.sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1)),
    });
  } catch (e) {
    next(e);
  }
});

// ---------------- CRUD isi buku ----------------
router.get("/", async (req, res, next) => {
  try {
    const rg = bacaRentang(req.query);
    const list = await prisma.solarBuku.findMany({
      where: { tanggal: { gte: rg.gte, lte: rg.lte } },
      orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }],
    });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { tanggal, nama, liter, keterangan } = req.body || {};
    const l = toLiter(liter);
    if (!TGL_RE.test(tanggal || "") || !rapikanSpasi(nama) || !Number.isFinite(l) || l <= 0) {
      return res.status(400).json({ error: "Tanggal, nama, dan liter (lebih dari 0) wajib diisi" });
    }
    const row = await prisma.solarBuku.create({
      data: { tanggal: new Date(tanggal), nama: await bakukanNama(nama), liter: l, keterangan: keterangan || null },
    });
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

// body: { tanggal: "YYYY-MM-DD", items: [{ nama, liter, keterangan? }] }
// Entri yang SAMA PERSIS (tanggal + nama + liter) dengan yang sudah ada
// dilewati, supaya salah klik "Simpan" dua kali tidak menggandakan data.
router.post("/massal", async (req, res, next) => {
  try {
    const { tanggal } = req.body || {};
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!TGL_RE.test(tanggal || "")) return res.status(400).json({ error: "Tanggal wajib diisi" });
    if (!items.length) return res.status(400).json({ error: "Tidak ada baris untuk disimpan" });

    const sudahAda = await prisma.solarBuku.findMany({ where: { tanggal: new Date(tanggal) } });
    const dilewati = [];
    const data = [];
    for (const it of items) {
      const l = toLiter(it.liter);
      const nama = rapikanSpasi(it.nama);
      if (!nama || !Number.isFinite(l) || l <= 0) {
        dilewati.push({ nama: it.nama, alasan: "Nama/liter tidak valid" });
        continue;
      }
      const baku = await bakukanNama(nama);
      const dobel =
        sudahAda.some((x) => namaKey(x.nama) === namaKey(baku) && x.liter === l) ||
        data.some((x) => namaKey(x.nama) === namaKey(baku) && x.liter === l);
      if (dobel) {
        dilewati.push({ nama: baku, alasan: "Sudah ada (sama persis)" });
        continue;
      }
      data.push({ tanggal: new Date(tanggal), nama: baku, liter: l, keterangan: it.keterangan || null });
    }
    if (data.length) await prisma.solarBuku.createMany({ data });
    res.status(201).json({ disimpan: data.length, dilewati });
  } catch (e) {
    next(e);
  }
});

// Anggap buku SAMA dengan setoran real ini (untuk baris TIDAK_DI_BUKU:
// ternyata memang sudah seharusnya ada di buku, tinggal dicatat).
router.post("/dari-real", async (req, res, next) => {
  try {
    const tx = await prisma.solarTx.findUnique({ where: { id: String(req.body?.solarTxId || "") } });
    if (!tx || tx.tipe !== "MASUK") return res.status(404).json({ error: "Setoran real tidak ditemukan" });
    const row = await prisma.solarBuku.create({
      // setoran tgl T+1 berarti di buku harusnya tertulis di tgl T
      data: { tanggal: new Date(`${addHari(tglStr(tx.tanggal), -1)}T00:00:00.000Z`), nama: tx.nama, liter: tx.liter, keterangan: "Dilengkapi dari setoran real" },
    });
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { nama, liter, keterangan, tanggal } = req.body || {};
    const data = {};
    if (nama !== undefined) data.nama = await bakukanNama(nama);
    if (liter !== undefined) {
      const l = toLiter(liter);
      if (!Number.isFinite(l) || l <= 0) return res.status(400).json({ error: "Liter harus lebih dari 0" });
      data.liter = l;
    }
    if (keterangan !== undefined) data.keterangan = keterangan || null;
    if (tanggal !== undefined) {
      if (!TGL_RE.test(tanggal)) return res.status(400).json({ error: "Format tanggal tidak valid" });
      data.tanggal = new Date(tanggal);
    }
    const row = await prisma.solarBuku.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) {
    if (e.code === "P2025") return res.status(404).json({ error: "Data buku tidak ditemukan" });
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.solarBuku.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    if (e.code === "P2025") return res.status(404).json({ error: "Data buku tidak ditemukan" });
    next(e);
  }
});

export default router;