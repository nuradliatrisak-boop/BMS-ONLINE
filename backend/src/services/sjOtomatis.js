// =============================================================================
// SURAT JALAN OTOMATIS untuk baris invoice yang belum punya Surat Jalan.
//
// Dipakai oleh:
//   - POST /api/invoices/import            (impor Excel: baris tanpa SJ dibuatkan SJ)
//   - POST /api/invoices/:id/items         (tambah item manual non-alat-berat)
//   - POST /api/invoices/:id/buat-sj-otomatis (rapikan invoice lama yang itemnya tanpa SJ)
//
// Aturan nomor:
//   - Baris punya "No Surat Jalan" dari kertas -> nomor SJ = "BM-<angka>" (sama
//     persis dengan cara Scan Surat Jalan/Invoice, supaya tidak dobel).
//   - Baris tanpa nomor -> nomor sistem "SJ-YYMM-XXX" (urutan per bulan).
// SJ yang dibuat otomatis ditandai di kolom `detail` ({ otomatis: true, sumber })
// supaya gampang dilacak/dicari kalau perlu dikoreksi.
// =============================================================================

export const r3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;
export const digitsOnly = (s) => String(s || "").replace(/\D/g, "");
export const stripZero = (s) => digitsOnly(s).replace(/^0+/, "");

export function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

// Nomor SJ dari angka di kertas. Kurang dari 3 digit dianggap bukan nomor SJ
// kertas yang valid -> dipakai apa adanya (atau dibuatkan nomor sistem).
export function nomorSJDariKertas(noSJ) {
  const raw = String(noSJ ?? "").trim();
  const dg = digitsOnly(raw);
  if (dg.length >= 3) return `BM-${dg}`;
  return raw;
}

// Nomor sistem pendek "SJ-YYMM-XXX" berdasarkan TANGGAL baris (bukan hari ini),
// supaya SJ hasil impor data lama tetap masuk bulan yang benar.
export async function nomorSJSistem(tx, tanggal) {
  const d = tanggal ? new Date(tanggal) : new Date();
  const dd = isNaN(d) ? new Date() : d;
  const prefix = `SJ-${String(dd.getFullYear()).slice(-2)}${String(dd.getMonth() + 1).padStart(2, "0")}`;
  const last = await tx.suratJalan.findFirst({
    where: { no: { startsWith: `${prefix}-` } },
    orderBy: { no: "desc" },
    select: { no: true },
  });
  let urut = 1;
  const m = last?.no?.match(/-(\d+)$/);
  if (m) urut = Number(m[1]) + 1;
  return `${prefix}-${String(urut).padStart(3, "0")}`;
}

// Volume baris: P x L x T kalau lengkap; kalau tidak, qty hanya dihitung
// sebagai m3 bila satuannya memang m3.
export function hitungVolume(row) {
  const p = Number(row.panjang) || 0, l = Number(row.lebar) || 0, t = Number(row.tinggi) || 0;
  if (p && l && t) return r3(p * l * t);
  const sat = String(row.satuan || "").trim().toLowerCase();
  if (sat === "m3" || sat === "m³" || sat === "kubik") return r3(row.qty);
  return 0;
}

// Cari SJ yang sudah ada untuk nomor kertas tertentu (abaikan awalan BM- dan
// nol di depan). Hanya SJ milik customer yang sama ATAU yang belum punya customer.
export async function cariSJByNomor(tx, customerId, noSJ) {
  const target = stripZero(noSJ);
  if (!target) return null;
  const list = await tx.suratJalan.findMany({
    where: {
      OR: [{ customerId }, { customerId: null }],
      isDraft: false,
      no: { contains: target },
    },
    include: { invoiceItems: { include: { invoice: { select: { no: true } } } } },
  });
  const exact = list.find((s) => s.no === String(noSJ).trim());
  return exact || list.find((s) => stripZero(s.no) === target) || null;
}

// Buat 1 Surat Jalan untuk sebuah baris invoice.
// ctx: { divisi, customer: {id,nama,alamat}, sumber }
// row: { tanggal, noSJ, noPolisi, jenisBarang, panjang, lebar, tinggi, qty, satuan, tujuan, penerima }
export async function buatSJUntukBaris(tx, ctx, row) {
  const tanggal = row.tanggal ? new Date(row.tanggal) : new Date();
  let no = nomorSJDariKertas(row.noSJ);
  if (!no) no = await nomorSJSistem(tx, tanggal);

  const p = Number(row.panjang) || 0, l = Number(row.lebar) || 0, t = Number(row.tinggi) || 0;
  const customer = ctx.customer;

  // nomor kertas bisa bentrok dengan SJ customer lain -> beri nomor sistem
  // baru daripada menggagalkan seluruh impor (nomor kertas asli dicatat di detail).
  let catatanNo = null;
  const bentrok = await tx.suratJalan.findUnique({ where: { no } });
  if (bentrok) {
    catatanNo = no;
    no = await nomorSJSistem(tx, tanggal);
  }

  // noPolisi cocok dengan master Armada -> SJ ikut terkait ke armada (sopirId
  // sengaja TIDAK diisi supaya tidak masuk buku komisi). Best-effort.
  let armada = null;
  const nopolNorm = String(row.noPolisi || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (nopolNorm) {
    const semua = await tx.armada.findMany({ select: { id: true, nopol: true, sopir: true } });
    armada = semua.find((a) => String(a.nopol || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === nopolNorm) || null;
  }

  return tx.suratJalan.create({
    data: {
      no,
      divisi: ctx.divisi,
      customerId: customer.id,
      armadaId: armada?.id || null,
      sopir: armada?.sopir || null,
      tujuan: String(row.tujuan || customer.alamat || customer.nama || "-").trim(),
      penerima: row.penerima || customer.nama || null,
      jenisBarang: row.jenisBarang ? String(row.jenisBarang).trim() : null,
      noPolisi: row.noPolisi ? String(row.noPolisi).trim().toUpperCase() : null,
      panjang: p,
      lebar: l,
      tinggi: t,
      m3: hitungVolume(row),
      tanggal,
      isDraft: false,
      detail: { otomatis: true, sumber: ctx.sumber || "invoice", ...(catatanNo ? { noKertas: catatanNo } : {}) },
    },
  });
}
