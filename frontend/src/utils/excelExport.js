// ============================================================
// EXPORT EXCEL -- dipakai oleh halaman "Laporan Divisi" dan
// "Rekap Keseluruhan". Library "xlsx" sudah jadi dependency proyek
// ini (dipakai juga oleh utils/excelImport.js), jadi tinggal dipakai
// ulang di sini, tanpa nambah dependency baru.
// ============================================================
import * as XLSX from "xlsx";

function rupiahNum(n) {
  return Math.round(Number(n) || 0);
}

function fmtDateID(v) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

// Susun baris-baris satu "kelompok" (mis. "Penjualan", "Sparepart", dst)
// jadi array-of-arrays yang siap ditulis ke sheet.
function kelompokRows(k) {
  const adaRincian = k.hasQty || k.rows.some((r) => r.subKategori);
  const rows = [];
  rows.push([`${k.label} (${k.tipe === "PENJUALAN" ? "Pendapatan" : "Pengeluaran"})`]);
  rows.push(adaRincian ? ["No", "Kategori", "Rincian", "Nominal"] : ["No", "Kategori", "Nominal"]);
  if (!k.rows.length) {
    rows.push(["", "Belum ada data.", ...(adaRincian ? [""] : [])]);
  } else {
    k.rows.forEach((r, i) => {
      rows.push(
        adaRincian
          ? [i + 1, r.kategori, r.subKategori || "-", rupiahNum(r.nominal)]
          : [i + 1, r.kategori, rupiahNum(r.nominal)]
      );
    });
  }
  rows.push([adaRincian ? "" : "", `Total ${k.label}`, ...(adaRincian ? [""] : []), rupiahNum(k.subtotal)]);
  rows.push([]); // baris kosong pemisah
  return rows;
}

function sheetNameFor(name) {
  // Nama sheet Excel maksimal 31 karakter & tidak boleh ada karakter : \ / ? * [ ]
  return String(name || "Sheet").replace(/[:\\/?*\[\]]/g, "-").slice(0, 31);
}

function autoWidth(aoa) {
  const widths = [];
  aoa.forEach((row) => {
    row.forEach((cell, i) => {
      const len = String(cell ?? "").length;
      widths[i] = Math.max(widths[i] || 8, Math.min(len + 2, 45));
    });
  });
  return widths.map((w) => ({ wch: w }));
}

// ------------------------------------------------------------
// Laporan Divisi (satu divisi, satu bulan)
// ------------------------------------------------------------
export function exportLaporanDivisiExcel({ divisi, bulanLabel, laporan }) {
  const aoa = [
    ["PT. BINTANG MUARA SEJATI"],
    [`LAPORAN LABA RUGI - DIVISI ${String(divisi).toUpperCase()}`],
    [`Bulan ${bulanLabel}`],
    [],
  ];
  laporan.kelompok.forEach((k) => aoa.push(...kelompokRows(k)));
  aoa.push(
    ["Total Penjualan / Pendapatan", "", "", rupiahNum(laporan.totalPenjualan)],
    ["Total Pengeluaran", "", "", rupiahNum(laporan.totalPengeluaran)],
    ["Hasil Bersih (Laba / Rugi)", "", "", rupiahNum(laporan.labaBersih)]
  );

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = autoWidth(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetNameFor(divisi));

  const namaFile = `laporan-divisi-${String(divisi).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${bulanLabel
    .toLowerCase()
    .replace(/\s+/g, "-")}.xlsx`;
  XLSX.writeFile(wb, namaFile);
}

// ------------------------------------------------------------
// Rekap Keseluruhan (bisa beberapa divisi sekaligus + total gabungan)
// ------------------------------------------------------------
export function exportRekapKeseluruhanExcel(data) {
  if (!data) return;
  const periode = `${fmtDateID(data.dari)} - ${fmtDateID(data.sampai)}`;
  const wb = XLSX.utils.book_new();

  data.divisi.forEach((d) => {
    const aoa = [
      ["PT. BINTANG MUARA SEJATI"],
      [`REKAP LAPORAN - DIVISI ${d.divisi.toUpperCase()}`],
      [`Periode ${periode}`],
      [],
    ];
    d.kelompok.forEach((k) => aoa.push(...kelompokRows(k)));
    aoa.push(
      ["Total Penjualan / Pendapatan", "", "", rupiahNum(d.totalPenjualan)],
      ["Total Pengeluaran", "", "", rupiahNum(d.totalPengeluaran)],
      ["Hasil Bersih (Laba / Rugi)", "", "", rupiahNum(d.labaBersih)]
    );
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = autoWidth(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sheetNameFor(d.divisi));
  });

  if (data.divisi.length > 1) {
    const aoa = [
      ["PT. BINTANG MUARA SEJATI"],
      ["REKAP KESELURUHAN SEMUA DIVISI"],
      [`Periode ${periode}`],
      [],
      ["Divisi", "Pendapatan", "Pengeluaran", "Hasil Bersih"],
      ...data.divisi.map((d) => [d.divisi, rupiahNum(d.totalPenjualan), rupiahNum(d.totalPengeluaran), rupiahNum(d.labaBersih)]),
      [],
      ["Total Pendapatan Seluruh Divisi", "", "", rupiahNum(data.grandTotal.totalPenjualan)],
      ["Total Pengeluaran Seluruh Divisi", "", "", rupiahNum(data.grandTotal.totalPengeluaran)],
      ["Hasil Bersih Keseluruhan", "", "", rupiahNum(data.grandTotal.labaBersih)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = autoWidth(aoa);
    XLSX.utils.book_append_sheet(wb, ws, "Total Gabungan");
  }

  const namaFile = `rekap-keseluruhan-${(data.dari || "").slice(0, 10)}_${(data.sampai || "").slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, namaFile);
}

// ------------------------------------------------------------
// Stok Solar (BBM) - halaman Laporan Divisi tab "Stok Solar"
// ------------------------------------------------------------
export function exportSolarStokExcel({ bulanLabel, items, totalMasuk, totalKeluar, saldoSaatIni }) {
  const masuk = items.filter((t) => t.tipe === "MASUK");
  const keluar = items.filter((t) => t.tipe === "KELUAR");

  const aoa = [
    ["PT. BINTANG MUARA SEJATI"],
    ["REKAP STOK SOLAR (BBM) - ALAT BERAT"],
    [`Bulan ${bulanLabel}`],
    [],
    ["SOLAR MASUK"],
    ["No", "Tanggal", "Nama Sopir", "Liter", "Keterangan"],
    ...(masuk.length
      ? masuk.map((t) => [t.no, fmtDateID(t.tanggal), t.nama, t.liter, t.keterangan || "-"])
      : [["", "Belum ada data.", "", "", ""]]),
    ["", "", "Total Masuk", totalMasuk, ""],
    [],
    ["SOLAR KELUAR"],
    ["No", "Tanggal", "Nama Operator", "Liter", "Lokasi", "Keterangan"],
    ...(keluar.length
      ? keluar.map((t) => [t.no, fmtDateID(t.tanggal), t.nama, t.liter, t.lokasi || "-", t.keterangan || "-"])
      : [["", "Belum ada data.", "", "", "", ""]]),
    ["", "", "Total Keluar", totalKeluar, "", ""],
    [],
    ["Sisa Stok Saat Ini (Liter)", "", "", saldoSaatIni],
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = autoWidth(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stok Solar");

  const namaFile = `stok-solar-${bulanLabel.toLowerCase().replace(/\s+/g, "-")}.xlsx`;
  XLSX.writeFile(wb, namaFile);
}
