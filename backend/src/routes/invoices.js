import { Router } from "express";
import prisma from "../prismaClient.js";
import { scopeDivisi } from "../middleware/auth.js";
import { buildInvoiceWorkbook } from "../services/invoiceXlsx.js";
import { DEFAULTS as PRINT_CALIB_DEFAULTS } from "./printCalib.js";
import { geocodeLokasi } from "../services/geocode.js";
import { cariHargaCustomer, cariHargaMaterial } from "../services/hargaCustomer.js";
import {
  r3,
  httpError,
  hitungVolume,
  cariSJByNomor,
  buatSJUntukBaris,
} from "../services/sjOtomatis.js";

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
      tensiv: true,
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

  // Harga satuan: pakai yang dikirim frontend kalau > 0. Kalau kosong/0 dan
  // baris ini dari Surat Jalan, cari otomatis dari harga customer (lalu
  // master Material sebagai cadangan). Tetap bisa diubah lewat "Update Harga".
  let hargaSatuan = Number(it.hargaSatuan) || 0;

  if (it.suratJalanId) {
    const sj = await tx.suratJalan.findUnique({
      where: { id: it.suratJalanId },
      include: { armada: true, sopirRef: true },
    });

    if (!sj) {
      throw Object.assign(new Error("Surat jalan tidak ditemukan"), {
        status: 400,
      });
    }

    keterangan = keterangan || sj.jenisBarang || sj.tujuan;
    qty = qty ?? sj.m3;
    satuan = satuan || "m3";

    if (!hargaSatuan && sj.customerId) {
      const prices = await tx.customerPrice.findMany({ where: { customerId: sj.customerId } });
      const hit = cariHargaCustomer(prices, sj);
      if (hit?.harga > 0) {
        hargaSatuan = hit.harga;
      } else {
        const materials = await tx.material.findMany({ where: { hargaSatuan: { gt: 0 } } });
        hargaSatuan = cariHargaMaterial(materials, sj)?.harga || 0;
      }
    }

    if (belanjaPasir === undefined) belanjaPasir = sj.belanjaPasir;
    if (uangMobil === undefined) uangMobil = sj.uangMobil;
    if (uangJalan === undefined) uangJalan = sj.uangJalan;
    if (uangKomisi === undefined) uangKomisi = sj.uangKomisi;
  }

  // Baris sewa alat berat ditarik dari sebuah Tensiv (Daftar Kerja Harian) ->
  // qty/kategoriAlat/unitAlat/tglPakai disalin otomatis dari rekaman jam
  // kerjanya, kecuali dikirim manual (hargaSatuan tetap wajib dikirim dari
  // frontend, sama seperti baris Surat Jalan).
  let kategoriAlat = it.kategoriAlat;
  let unitAlat = it.unitAlat;
  let tglPakai = it.tglPakai;

  if (it.tensivId) {
    const ts = await tx.tensiv.findUnique({ where: { id: it.tensivId } });

    if (!ts) {
      throw Object.assign(new Error("Tensiv tidak ditemukan"), {
        status: 400,
      });
    }

    keterangan = keterangan || [ts.unitAlat, ts.kategoriAlat].filter(Boolean).join(" - ");
    qty = qty ?? ts.totalJamKerja;
    satuan = satuan || "jam";
    kategoriAlat = kategoriAlat || ts.kategoriAlat;
    unitAlat = unitAlat || ts.unitAlat;
    tglPakai = tglPakai || ts.tanggal;
  }

  // Baris sewa alat berat (kategoriAlat + unitAlat diisi) & uangMakan belum
  // dikirim manual -> cari otomatis dari master rate UangMakanAlat.
  if (uangMakan === undefined && kategoriAlat && unitAlat) {
    const rate = await tx.uangMakanAlat.findUnique({
      where: { unitAlat_kategoriAlat: { unitAlat, kategoriAlat } },
    });
    if (rate) uangMakan = rate.nominal;
  }

  return {
    suratJalanId: it.suratJalanId || null,
    tensivId: it.tensivId || null,
    keterangan,
    qty: Number(qty) || 0,
    satuan: satuan || null,
    hargaSatuan,
    // Khusus baris SEWA ALAT BERAT (opsional). Kalau diisi, baris ini ikut
    // terhitung di menu "Rekap Sewa Alat" & statistik per kategori alat di
    // Dashboard. Invoice material/armada biasa cukup dibiarkan kosong.
    kategoriAlat: kategoriAlat || null,
    unitAlat: unitAlat || null,
    tglPakai: tglPakai ? new Date(tglPakai) : null,
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
// IMPOR INVOICE DARI EXCEL
// Frontend (utils/invoiceImport.js) membaca file .xlsx -> daftar invoice
// (1 sheet = 1 invoice = 1 customer). Dua tahap:
//   POST /api/invoices/import/preview : cek saja, TIDAK menyimpan apa-apa.
//     Status SJ per baris: ADA (tertaut), BARU (dibuatkan SJ otomatis),
//     TERTAGIH (SJ sudah di invoice lain -> error).
//   POST /api/invoices/import         : simpan. Satu invoice = satu transaksi,
//     jadi kalau satu invoice gagal, invoice lain di file yang sama tetap masuk.
// ============================================================

function divisiImpor(req, divisi) {
  if (req.user?.role === "ADMIN") return divisi;
  return req.user?.divisi || divisi;
}

function bersihkanBaris(raw) {
  const r = raw || {};
  const num = (v) => (v === "" || v == null ? 0 : Number(v) || 0);
  const row = {
    tanggal: r.tanggal || null,
    noSJ: r.noSJ == null ? "" : String(r.noSJ).trim(),
    noPolisi: r.noPolisi ? String(r.noPolisi).trim() : "",
    jenisBarang: r.jenisBarang ? String(r.jenisBarang).trim() : "",
    panjang: num(r.panjang),
    lebar: num(r.lebar),
    tinggi: num(r.tinggi),
    qty: num(r.qty),
    satuan: r.satuan ? String(r.satuan).trim() : "",
    hargaSatuan: num(r.hargaSatuan),
    tujuan: r.tujuan ? String(r.tujuan).trim() : "",
  };
  const volume = hitungVolume(row);
  if (!(row.qty > 0) && volume > 0) {
    row.qty = volume;
    if (!row.satuan) row.satuan = "m3";
  }
  if (!row.satuan && row.panjang && row.lebar && row.tinggi) row.satuan = "m3";
  return row;
}

async function periksaInvoiceImpor(tx, req, inv) {
  const customer = inv.customerId
    ? await tx.customer.findUnique({ where: { id: inv.customerId } })
    : null;
  const hasil = { key: inv.key ?? null, customer: customer ? { id: customer.id, nama: customer.nama } : null, errors: [], baris: [] };
  if (!customer) hasil.errors.push("Customer belum dipilih / tidak ditemukan");
  if (!inv.tanggal || isNaN(new Date(inv.tanggal))) hasil.errors.push("Tanggal invoice tidak valid");
  if (!divisiImpor(req, inv.divisi)) hasil.errors.push("Divisi wajib diisi");
  const items = Array.isArray(inv.items) ? inv.items : [];
  if (!items.length) hasil.errors.push("Tidak ada baris item");

  const dipakai = new Set();
  let no = 0;
  for (const raw of items) {
    no++;
    const row = bersihkanBaris(raw);
    const info = { no, ...row, sjStatus: "BARU", sjNo: null, error: null, peringatan: [] };

    if (!(row.qty > 0)) info.error = "Jumlah / ukuran (P-L-T) kosong";
    if (!row.jenisBarang && !row.noSJ) info.peringatan.push("Jenis barang kosong");
    if (!(row.hargaSatuan > 0)) info.peringatan.push("Harga kosong — dicari otomatis dari harga customer, kalau tidak ada jadi 0");

    if (customer && row.noSJ) {
      const k = row.noSJ.replace(/\D/g, "").replace(/^0+/, "") || row.noSJ;
      if (dipakai.has(k)) {
        info.error = info.error || `No SJ ${row.noSJ} muncul dua kali di invoice ini`;
      }
      dipakai.add(k);
      const sj = await cariSJByNomor(tx, customer.id, row.noSJ);
      if (sj) {
        info.sjNo = sj.no;
        if (sj.invoiceItems?.length) {
          info.sjStatus = "TERTAGIH";
          info.error = info.error || `SJ ${sj.no} sudah tertagih di invoice ${sj.invoiceItems[0].invoice.no}`;
        } else {
          info.sjStatus = "ADA";
        }
      }
    }
    hasil.baris.push(info);
  }

  hasil.total = hasil.baris.reduce((a, b) => a + (b.qty || 0) * (b.hargaSatuan || 0), 0);
  hasil.jumlahBaru = hasil.baris.filter((b) => b.sjStatus === "BARU").length;
  hasil.jumlahAda = hasil.baris.filter((b) => b.sjStatus === "ADA").length;
  hasil.bisaDisimpan = !hasil.errors.length && !hasil.baris.some((b) => b.error);
  return hasil;
}

router.post("/import/preview", async (req, res, next) => {
  try {
    const list = Array.isArray(req.body?.invoices) ? req.body.invoices : [];
    if (!list.length) return res.status(400).json({ error: "Tidak ada invoice untuk dicek" });
    const hasil = [];
    for (const inv of list) hasil.push(await periksaInvoiceImpor(prisma, req, inv));
    res.json({ invoices: hasil });
  } catch (e) {
    next(e);
  }
});

router.post("/import", async (req, res, next) => {
  try {
    const list = Array.isArray(req.body?.invoices) ? req.body.invoices : [];
    if (!list.length) return res.status(400).json({ error: "Tidak ada invoice untuk diimport" });

    const hasil = [];
    for (const inv of list) {
      const key = inv.key ?? null;
      try {
        const divisi = divisiImpor(req, inv.divisi);
        const out = await prisma.$transaction(
          async (tx) => {
            const cek = await periksaInvoiceImpor(tx, req, inv);
            if (!cek.bisaDisimpan) {
              const alasan = [...cek.errors, ...cek.baris.filter((b) => b.error).map((b) => `baris ${b.no}: ${b.error}`)];
              throw httpError(400, alasan.join("; "));
            }
            const customer = await tx.customer.findUnique({ where: { id: inv.customerId } });
            const tanggal = new Date(inv.tanggal);
            const no = await generateNomorInvoice(tx, tanggal);

            const itemsData = [];
            const rekapRows = [];
            let sjBaru = 0, sjTertaut = 0;

            for (const raw of inv.items) {
              const row = bersihkanBaris(raw);
              let sj = row.noSJ ? await cariSJByNomor(tx, customer.id, row.noSJ) : null;

              if (sj) {
                const lengkapi = {};
                if (!sj.customerId) lengkapi.customerId = customer.id;
                const vol = hitungVolume(row);
                if (!(sj.m3 > 0) && vol > 0) {
                  lengkapi.m3 = vol;
                  if (row.panjang && row.lebar && row.tinggi && !(sj.panjang && sj.lebar && sj.tinggi)) {
                    Object.assign(lengkapi, { panjang: row.panjang, lebar: row.lebar, tinggi: row.tinggi });
                  }
                }
                if (!sj.jenisBarang && row.jenisBarang) lengkapi.jenisBarang = row.jenisBarang;
                if (!sj.noPolisi && row.noPolisi) lengkapi.noPolisi = row.noPolisi.toUpperCase();
                if (Object.keys(lengkapi).length) sj = await tx.suratJalan.update({ where: { id: sj.id }, data: lengkapi });
                sjTertaut++;
              } else {
                sj = await buatSJUntukBaris(tx, { divisi, customer, sumber: "import-excel" }, row);
                sjBaru++;
              }

              const itemData = await buildItemData(
                tx,
                {
                  suratJalanId: sj.id,
                  keterangan: row.jenisBarang || sj.jenisBarang || sj.tujuan,
                  qty: row.qty,
                  satuan: row.satuan || null,
                  hargaSatuan: row.hargaSatuan,
                },
                null
              );
              itemsData.push(itemData);

              rekapRows.push({
                customerId: customer.id,
                tanggal: sj.tanggal,
                noSuratJalan: sj.no,
                noPolisi: sj.noPolisi || "-",
                jenisBarang: sj.jenisBarang || row.jenisBarang || "-",
                panjang: row.panjang,
                lebar: row.lebar,
                tinggi: row.tinggi,
                jumlah: row.qty,
                harga: itemData.hargaSatuan,
                total: r3(row.qty * itemData.hargaSatuan),
              });
            }

            const invoice = await tx.invoice.create({
              data: {
                no,
                divisi,
                customerId: customer.id,
                tanggal,
                jatuhTempo: inv.jatuhTempo ? new Date(inv.jatuhTempo) : null,
                halaman: Number(inv.halaman) || 1,
                catatan: inv.catatan || null,
                items: { create: itemsData },
              },
              include: { items: true },
            });

            let rekapBaru = 0;
            if (inv.buatRekap !== false) {
              for (const r of rekapRows) {
                const dup = await tx.rekapPenjualan.findFirst({
                  where: { customerId: r.customerId, noSuratJalan: r.noSuratJalan },
                });
                if (dup) continue;
                await tx.rekapPenjualan.create({ data: r });
                rekapBaru++;
              }
            }

            const total = invoice.items.reduce((a, x) => a + x.qty * x.hargaSatuan, 0);
            return { id: invoice.id, no: invoice.no, total, baris: invoice.items.length, sjBaru, sjTertaut, rekapBaru };
          },
          { timeout: 120000, maxWait: 10000 }
        );
        hasil.push({ key, ok: true, ...out });
      } catch (e) {
        hasil.push({
          key,
          ok: false,
          error:
            e.code === "P2002"
              ? "Nomor invoice/surat jalan bentrok dengan data yang sudah ada"
              : e.message || "Gagal menyimpan",
        });
      }
    }

    res.status(201).json({
      invoices: hasil,
      berhasil: hasil.filter((h) => h.ok).length,
      gagal: hasil.filter((h) => !h.ok).length,
    });
  } catch (e) {
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

// Item manual per customer, lintas divisi. Body (selain field item biasa):
//   divisi    : divisi baris ini (Supplier/Armada/Alat Berat/Kontraktor/Kapal);
//               default = divisi invoice. "Alat Berat" = baris sewa alat (pakai
//               kategoriAlat/unitAlat), TIDAK dibuatkan Surat Jalan.
//   noSJ, noPolisi, panjang, lebar, tinggi, tujuan : opsional, ikut ke SJ otomatis
//   buatSJ    : false = jangan buatkan SJ (default: dibuatkan untuk non-alat-berat)
router.post("/:id/items", async (req, res, next) => {
  try {
    const body = req.body || {};
    const inv = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { customer: true },
    });
    if (!inv) return res.status(404).json({ error: "Invoice tidak ditemukan" });

    const divisiBaris = body.divisi || inv.divisi;
    const lokasiGeo = body.lokasi ? await geocodeLokasi(body.lokasi) : null;

    await prisma.$transaction(async (tx) => {
      const data = { ...body };
      const barisAlat = !!(body.kategoriAlat || body.unitAlat) || divisiBaris === "Alat Berat";
      const perluSJ = !body.suratJalanId && !body.tensivId && !barisAlat && body.buatSJ !== false;

      if (perluSJ) {
        const row = {
          tanggal: body.tglPakai || body.tanggal || inv.tanggal,
          noSJ: body.noSJ,
          noPolisi: body.noPolisi,
          jenisBarang: body.keterangan,
          panjang: body.panjang,
          lebar: body.lebar,
          tinggi: body.tinggi,
          qty: body.qty,
          satuan: body.satuan,
          tujuan: body.tujuan || body.lokasi,
        };
        let sj = body.noSJ ? await cariSJByNomor(tx, inv.customerId, body.noSJ) : null;
        if (sj?.invoiceItems?.length) {
          throw httpError(409, `Surat jalan ${sj.no} sudah tertagih di invoice ${sj.invoiceItems[0].invoice.no}`);
        }
        if (!sj) {
          sj = await buatSJUntukBaris(tx, { divisi: divisiBaris, customer: inv.customer, sumber: "item-manual" }, row);
        }
        data.suratJalanId = sj.id;
        data.keterangan = data.keterangan || sj.jenisBarang || sj.tujuan;
      }

      const itemData = await buildItemData(tx, data, lokasiGeo);
      await tx.invoiceItem.create({ data: { ...itemData, invoiceId: req.params.id } });
    });

    const full = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: includeLengkap,
    });

    res.status(201).json(ringkas(full));
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({
        error: "Surat jalan/Tensiv ini sudah dipakai di invoice lain",
      });
    }
    next(e);
  }
});

// Buatkan Surat Jalan untuk SEMUA baris invoice ini yang belum punya SJ
// (mis. baris manual lama). Baris sewa alat berat dilewati (bukan pengiriman).
router.post("/:id/buat-sj-otomatis", async (req, res, next) => {
  try {
    const inv = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { customer: true, items: true },
    });
    if (!inv) return res.status(404).json({ error: "Invoice tidak ditemukan" });

    const target = inv.items.filter(
      (it) => !it.suratJalanId && !it.tensivId && !it.kategoriAlat && !it.unitAlat
    );
    if (!target.length) {
      const full0 = await prisma.invoice.findUnique({ where: { id: inv.id }, include: includeLengkap });
      return res.json({ dibuat: 0, invoice: ringkas(full0) });
    }

    await prisma.$transaction(
      async (tx) => {
        for (const it of target) {
          const sj = await buatSJUntukBaris(
            tx,
            { divisi: inv.divisi, customer: inv.customer, sumber: "invoice-lama" },
            {
              tanggal: it.tglPakai || inv.tanggal,
              jenisBarang: it.keterangan,
              qty: it.qty,
              satuan: it.satuan,
              tujuan: it.lokasi,
            }
          );
          await tx.invoiceItem.update({ where: { id: it.id }, data: { suratJalanId: sj.id } });
        }
      },
      { timeout: 60000, maxWait: 10000 }
    );

    const full = await prisma.invoice.findUnique({ where: { id: inv.id }, include: includeLengkap });
    res.json({ dibuat: target.length, invoice: ringkas(full) });
  } catch (e) {
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