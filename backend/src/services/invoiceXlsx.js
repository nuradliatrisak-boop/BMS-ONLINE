import ExcelJS from "exceljs";

// ============================================================
// EXPORT INVOICE KE EXCEL (.xlsx)
//
// Tujuan fitur ini: banyak kertas continuous form / dot matrix yang
// dipakai sudah ada kop suratnya tercetak duluan secara fisik, dan dulu
// (era Excel, sebelum sistem ini) hasil cetaknya presisi karena
// dikerjakan langsung dari Page Setup Excel (ukuran kertas & margin
// diatur manual di sana, lalu di-print dari Excel).
//
// Supaya orang yang lebih terbiasa dengan alur "buka file - atur Page
// Setup - print dari Excel" itu tetap bisa pakai cara yang sama persis
// seperti dulu (dan mesin printer-nya dianggap sudah dikenal baik oleh
// Excel/Windows), file yang dihasilkan di sini SENGAJA:
//   - Tidak ikut mencetak nama/alamat perusahaan di baris atas (supaya
//     tidak dobel sama kop surat yang sudah tercetak fisik) - baris
//     kosong di atas disisakan setinggi "topMargin" dari kalibrasi yang
//     sama dipakai di menu Kalibrasi Cetak > Invoice, supaya kalau nanti
//     kalibrasi itu diubah, hasil Excel ini otomatis ikut menyesuaikan.
//   - Margin kiri halaman ditambah offsetX dari kalibrasi yang sama.
//   - TIDAK memaksa ukuran kertas custom (biar tidak konflik dengan
//     printer driver yang berbeda-beda) - orang tinggal atur sendiri
//     "Page Setup > Paper Size" di Excel sesuai kertas fisik yang
//     dipakai (caranya sama seperti dulu), lalu print seperti biasa.
// ============================================================

const MM_TO_PT = 2.83464567; // 1 mm dalam point (satuan tinggi baris Excel)
const MM_TO_IN = 1 / 25.4; // 1 mm dalam inch (satuan margin halaman Excel)

function rupiah(n) {
  return "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
}

function fmtDateShort(v) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function fmtDateLong(v) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

const THIN = { style: "thin", color: { argb: "FF111111" } };
const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN };

export async function buildInvoiceWorkbook(inv, calib, signerName) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Invoice", {
    pageSetup: {
      orientation: "portrait",
      // Margin diambil dari kalibrasi yang sama dipakai halaman Kalibrasi
      // Cetak (mm -> inch), supaya satu sumber angka untuk dua cara cetak.
      margins: {
        top: (Number(calib?.topMargin ?? 21) + Number(calib?.offsetY || 0)) * MM_TO_IN,
        left: (8 + Number(calib?.offsetX || 0)) * MM_TO_IN,
        right: 8 * MM_TO_IN,
        bottom: 6 * MM_TO_IN,
        header: 0,
        footer: 0,
      },
      fitToPage: false,
      // Paper size sengaja tidak dipaksa di sini - atur sendiri lewat
      // Page Layout > Size di Excel sesuai kertas fisik yang dipakai
      // (persis seperti alur lama), supaya tidak bentrok dengan printer
      // yang beda-beda tiap kantor/komputer.
    },
  });

  // Kolom kira-kira sepadan dengan tabel di versi cetak browser:
  // No | Tgl Kirim | No SJ | Sopir | Alamat Kirim | P | L | T | M3 | Harga | Jumlah
  ws.columns = [
    { width: 4 }, // A No
    { width: 10 }, // B Tgl Kirim
    { width: 14 }, // C No SJ
    { width: 14 }, // D Sopir
    { width: 26 }, // E Alamat Kirim
    { width: 7 }, // F P
    { width: 7 }, // G L
    { width: 7 }, // H T
    { width: 8 }, // I M3
    { width: 13 }, // J Harga
    { width: 15 }, // K Jumlah
  ];

  const LASTCOL = 11; // kolom K

  // ---- baris kosong pengganti "topMargin" kalibrasi (tinggi disamakan
  // supaya konsisten dengan versi cetak browser - kop surat fisik sudah
  // ada di area ini, jadi sengaja tidak ditumpuk tulisan apapun) ----
  ws.addRow([]).height = Number(calib?.topMargin ?? 21) * MM_TO_PT * 0.6;

  // ---- Kepada Yth (kiri) & Halaman/No Invoice/Tanggal (kanan) ----
  const rKepada = ws.addRow(["Kepada Yth", "", "", "", "", "", "", "", "Halaman", "", inv.halaman ?? 1]);
  rKepada.getCell(1).font = { size: 9, color: { argb: "FF555555" } };
  rKepada.getCell(9).font = { size: 9, color: { argb: "FF555555" } };
  rKepada.getCell(11).font = { bold: true };

  const rNamaCust = ws.addRow([inv.customer?.nama || "", "", "", "", "", "", "", "", "No. Invoice", "", inv.no || ""]);
  rNamaCust.getCell(1).font = { bold: true };
  rNamaCust.getCell(9).font = { size: 9, color: { argb: "FF555555" } };
  rNamaCust.getCell(11).font = { bold: true };

  const rAlamatCust = ws.addRow([inv.customer?.alamat || "", "", "", "", "", "", "", "", "Tanggal", "", fmtDateShort(inv.tanggal)]);
  rAlamatCust.getCell(9).font = { size: 9, color: { argb: "FF555555" } };
  rAlamatCust.getCell(11).font = { bold: true };

  ws.addRow([]);

  // ---- Kode / Nama / Alamat customer ----
  const idRows = [
    ["Kode Customer", inv.customer?.kode || "-"],
    ["Nama Customer", inv.customer?.nama || "-"],
    ["Alamat", inv.customer?.alamat || "-"],
  ];
  for (const [label, val] of idRows) {
    const r = ws.addRow([label, "", "", ":", val]);
    r.getCell(1).font = { size: 9, color: { argb: "FF555555" } };
    r.getCell(5).font = { bold: true };
  }

  ws.addRow([]);

  // ---- tabel item ----
  const header = ["No", "Tgl Kirim", "No SJ", "Sopir", "Alamat Kirim", "P", "L", "T", "M3", "Harga", "Jumlah"];
  const rHeader = ws.addRow(header);
  rHeader.eachCell((cell, colNumber) => {
    if (colNumber > LASTCOL) return;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
    cell.border = BOX;
  });

  let totalM3 = 0;
  (inv.items || []).forEach((it, i) => {
    const sj = it.suratJalan;
    const jumlah = Number(it.qty) * Number(it.hargaSatuan);
    totalM3 += Number(sj?.m3 || 0);

    const row = ws.addRow([
      i + 1,
      sj ? fmtDateShort(sj.tanggal) : "-",
      sj ? sj.no : "-",
      sj ? sj.sopir || sj.armada?.sopir || "" : "",
      sj ? sj.tujuan : it.keterangan,
      sj ? Number(sj.panjang ?? 0) : "",
      sj ? Number(sj.lebar ?? 0) : "",
      sj ? Number(sj.tinggi ?? 0) : "",
      sj ? Number(sj.m3 || 0) : Number(it.qty),
      Number(it.hargaSatuan),
      jumlah,
    ]);
    row.eachCell((cell, colNumber) => {
      if (colNumber > LASTCOL) return;
      cell.border = BOX;
      cell.alignment = { horizontal: colNumber === 5 ? "left" : "center", vertical: "middle" };
    });
    row.getCell(10).numFmt = '"Rp" #,##0';
    row.getCell(11).numFmt = '"Rp" #,##0';
  });

  ws.addRow([]);

  // ---- total & terbilang (kiri) + kotak total tagihan (kanan) ----
  const total = inv.total ?? (inv.items || []).reduce((s, i) => s + i.qty * i.hargaSatuan, 0);

  const rTotalM3 = ws.addRow([`Total M3: ${totalM3.toFixed(3)}`]);
  rTotalM3.getCell(1).font = { bold: true };

  if (inv.catatan) {
    const rCatatan = ws.addRow([`Catatan: ${inv.catatan}`]);
    rCatatan.getCell(1).font = { size: 8, italic: true };
  }

  ws.addRow([]);

  const boxRows = [
    ["Jumlah Total Tagihan", total],
    ["Sudah Dibayar", inv.dibayar],
    ["Sisa", inv.sisaTagihan],
  ];
  for (const [label, val] of boxRows) {
    const r = ws.addRow(["", "", "", "", "", "", "", "", label, "", val]);
    r.getCell(9).border = BOX;
    r.getCell(11).border = BOX;
    r.getCell(11).numFmt = '"Rp" #,##0';
    r.getCell(11).alignment = { horizontal: "right" };
  }

  ws.addRow([]);
  ws.addRow([]);

  const rTgl = ws.addRow(["", "", "", "", "", "", "", `Jakarta, ${fmtDateLong(inv.tanggal)}`]);
  rTgl.getCell(8).alignment = { horizontal: "center" };

  ws.addRow([]);
  ws.addRow([]);

  const rSign = ws.addRow(["", "", "", "", "", "", "", signerName || "Hormat Kami"]);
  rSign.getCell(8).font = { bold: true, underline: true };
  rSign.getCell(8).alignment = { horizontal: "center" };

  return wb;
}