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
//
// PENGATURAN TAMPILAN TERKINI:
//   - Font seragam Times New Roman 12pt di seluruh invoice.
//   - Ada judul "INVOICE" rata tengah di bagian atas.
//   - Tabel item dibuat polos (tanpa garis pembatas antar kolom),
//     cuma garis horizontal di atas/bawah header & penutup baris
//     item terakhir. Box total tagihan tetap pakai kotak penuh.
//   - Lebar kolom & tinggi baris disesuaikan supaya teks 12pt tetap
//     kebaca penuh (tidak kepotong / ke-wrap kependekan).
//   - Tidak mengubah struktur kolom, merge, margin, atau data invoice.
// ============================================================

const MM_TO_PT = 2.83464567; // 1 mm dalam point
const MM_TO_IN = 1 / 25.4; // 1 mm dalam inch

// ------------------------------------------------------------
// FONT KHUSUS DOT MATRIX
// ------------------------------------------------------------
// Courier New dipilih karena karakter memiliki lebar yang konsisten
// dan bentuknya sederhana, sehingga relatif mudah dibaca pada hasil
// cetak dot matrix Windows/Excel.
//
// Jangan terlalu besar karena invoice menggunakan continuous form.
// 10 pt untuk isi dan 11 pt untuk bagian penting adalah kompromi
// antara keterbacaan dan menjaga layout tetap muat.
// ------------------------------------------------------------
const DOT_FONT = "Times New Roman";
// FONT_BODY (isi tabel item) sedikit digedein dibanding sebelumnya
// (12pt) supaya tetap kebaca jelas, tapi tinggi baris & lebar kolom
// dijaga cukup supaya sampai 6 baris tagihan tetap muat rapi.
const FONT_BODY = 13;
const FONT_SMALL = 12;
const FONT_IMPORTANT = 12;
const FONT_TOTAL = 13;
const FONT_TITLE = 16; // Judul "INVOICE" di tengah atas

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

// Terbilang (angka rupiah -> teks) - disamakan persis dengan versi
// cetak browser (lihat terbilang() di frontend/src/services/print.js)
// supaya hasil Excel & cetak langsung selalu menampilkan teks yang sama.
function terbilang(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return "Nol";
  const s = [
    "",
    "Satu",
    "Dua",
    "Tiga",
    "Empat",
    "Lima",
    "Enam",
    "Tujuh",
    "Delapan",
    "Sembilan",
    "Sepuluh",
    "Sebelas",
  ];
  const f = (x) =>
    x < 12
      ? s[x]
      : x < 20
      ? f(x - 10) + " Belas"
      : x < 100
      ? f(Math.floor(x / 10)) + " Puluh" + (x % 10 ? " " + f(x % 10) : "")
      : x < 200
      ? "Seratus" + (x % 100 ? " " + f(x % 100) : "")
      : x < 1000
      ? f(Math.floor(x / 100)) + " Ratus" + (x % 100 ? " " + f(x % 100) : "")
      : x < 2000
      ? "Seribu" + (x % 1000 ? " " + f(x % 1000) : "")
      : x < 1e6
      ? f(Math.floor(x / 1000)) + " Ribu" + (x % 1000 ? " " + f(x % 1000) : "")
      : x < 1e9
      ? f(Math.floor(x / 1e6)) + " Juta" + (x % 1e6 ? " " + f(x % 1e6) : "")
      : f(Math.floor(x / 1e9)) + " Miliar" + (x % 1e9 ? " " + f(x % 1e9) : "");
  return f(n);
}

// Border pakai gaya "medium" (bukan "thin") - alasannya sama seperti
// garis di versi cetak HTML: garis "thin" itu garis paling tipis di
// Excel, dan di printer dot-matrix garis setipis itu sering kecetak
// putus-putus/titik-titik, bukan garis solid. "medium" jauh lebih
// aman kecetak solid di DPI berapapun.
const THIN = {
  style: "medium",
  color: { argb: "FF111111" },
};

const BOX = {
  top: THIN,
  bottom: THIN,
  left: THIN,
  right: THIN,
};

// Tabel item dibuat polos (tanpa garis pembatas antar kolom) - cuma
// garis horizontal di atas & bawah header, dan garis penutup di baris
// item paling bawah. Box total tagihan (boxRows) tetap pakai BOX biasa
// karena itu memang dimaksudkan tampil sebagai kotak.
const ROW_BOTTOM = { bottom: THIN };
const ROW_TOP_BOTTOM = { top: THIN, bottom: THIN };

// ------------------------------------------------------------
// Helper font
// ------------------------------------------------------------
// Menghindari penggantian properti font yang sudah ada.
// Jadi bold / italic / underline yang sudah dipakai di invoice
// tetap dipertahankan.
// ------------------------------------------------------------
function applyFont(cell, options = {}) {
  cell.font = {
    name: DOT_FONT,
    size: options.size ?? FONT_BODY,
    bold: options.bold ?? false,
    italic: options.italic ?? false,
    underline: options.underline ?? false,
    color: options.color,
  };
}

// Perkiraan tinggi baris berdasarkan panjang teks.
// Tetap dipertahankan agar teks wrap tidak kepotong.
function estimateWrapHeight(
  text,
  colWidthChars,
  lineHeightPt = 15
) {
  const len = String(text ?? "").length;

  if (!len) return lineHeightPt;

  const charsPerLine = Math.max(
    6,
    Math.floor(colWidthChars)
  );

  const lines = Math.max(
    1,
    Math.ceil(len / charsPerLine)
  );

  return lines * lineHeightPt;
}

export async function buildInvoiceWorkbook(
  inv,
  calib,
  signerName
) {
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet("Invoice", {
    pageSetup: {
      orientation: "portrait",

      // Margin diambil dari kalibrasi yang sama dipakai halaman
      // Kalibrasi Cetak (mm -> inch).
      margins: {
        top:
          (
            Number(calib?.topMargin ?? 21) +
            Number(calib?.offsetY || 0)
          ) * MM_TO_IN,

        left:
          (
            8 +
            Number(calib?.offsetX || 0)
          ) * MM_TO_IN,

        right: 8 * MM_TO_IN,
        bottom: 6 * MM_TO_IN,

        header: 0,
        footer: 0,
      },

      // Tetap 1 halaman lebar agar kolom A-K tidak terlempar
      // ke halaman berikutnya.
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  // ============================================================
  // KOLOM
  // ============================================================
  //
  // TIDAK DIUBAH supaya posisi horizontal invoice tetap sama.
  //
  // Lebar sedikit dinaikkan dibanding versi Courier New 10pt supaya
  // teks Times New Roman 12pt tetap muat & tidak kepotong (proporsi
  // antar kolom dijaga tetap sama).
  ws.columns = [
    { width: 5 },  // A No
    { width: 11 }, // B Tgl Kirim
    { width: 15 }, // C No SJ
    { width: 16 }, // D Sopir
    { width: 30 }, // E Alamat Kirim
    { width: 7 },  // F P
    { width: 7 },  // G L
    { width: 7 },  // H T
    { width: 9 },  // I M3
    { width: 14 }, // J Harga
    { width: 16 }, // K Jumlah
  ];

  const LASTCOL = 11;

  // ============================================================
  // BARIS KOSONG UNTUK AREA KOP SURAT
  // ============================================================

  const topBlank = ws.addRow([]);

  topBlank.height =
    Number(calib?.topMargin ?? 21) *
    MM_TO_PT *
    0.6;

  // ============================================================
  // JUDUL "INVOICE" (rata tengah)
  // ============================================================

  const rTitle = ws.addRow(["INVOICE"]);

  ws.mergeCells(
    `A${rTitle.number}:K${rTitle.number}`
  );

  applyFont(rTitle.getCell(1), {
    size: FONT_TITLE,
    bold: true,
  });

  rTitle.getCell(1).alignment = {
    horizontal: "center",
    vertical: "middle",
  };

  rTitle.height = 26;

  ws.addRow([]).height = 6;

  // ============================================================
  // KEPADA YTH + INFORMASI INVOICE
  // ============================================================

  const rKepada = ws.addRow([
    "Kepada Yth",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Halaman",
    "",
    inv.halaman ?? 1,
  ]);

  ws.mergeCells(
    `A${rKepada.number}:D${rKepada.number}`
  );

  ws.mergeCells(
    `I${rKepada.number}:J${rKepada.number}`
  );

  applyFont(rKepada.getCell(1), {
    size: FONT_SMALL,
    color: "FF444444",
  });

  applyFont(rKepada.getCell(9), {
    size: FONT_SMALL,
    color: "FF444444",
  });

  applyFont(rKepada.getCell(11), {
    size: FONT_IMPORTANT,
    bold: true,
  });

  rKepada.height = 18;

  // ------------------------------------------------------------

  const rNamaCust = ws.addRow([
    inv.customer?.nama || "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "No. Invoice",
    "",
    inv.no || "",
  ]);

  ws.mergeCells(
    `A${rNamaCust.number}:D${rNamaCust.number}`
  );

  ws.mergeCells(
    `I${rNamaCust.number}:J${rNamaCust.number}`
  );

  applyFont(rNamaCust.getCell(1), {
    size: FONT_IMPORTANT,
    bold: true,
  });

  applyFont(rNamaCust.getCell(9), {
    size: FONT_SMALL,
    color: "FF444444",
  });

  applyFont(rNamaCust.getCell(11), {
    size: FONT_IMPORTANT,
    bold: true,
  });

  rNamaCust.height = 19;

  // ------------------------------------------------------------

  const rAlamatCust = ws.addRow([
    inv.customer?.alamat || "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Tanggal",
    "",
    fmtDateShort(inv.tanggal),
  ]);

  ws.mergeCells(
    `A${rAlamatCust.number}:D${rAlamatCust.number}`
  );

  ws.mergeCells(
    `I${rAlamatCust.number}:J${rAlamatCust.number}`
  );

  applyFont(rAlamatCust.getCell(1), {
    size: FONT_BODY,
  });

  applyFont(rAlamatCust.getCell(9), {
    size: FONT_SMALL,
    color: "FF444444",
  });

  applyFont(rAlamatCust.getCell(11), {
    size: FONT_IMPORTANT,
    bold: true,
  });

  rAlamatCust.getCell(1).alignment = {
    vertical: "middle",
    wrapText: true,
  };

  rAlamatCust.height = Math.max(
    19,
    estimateWrapHeight(
      inv.customer?.alamat || "",
      28,
      17
    )
  );

  // Spasi
  ws.addRow([]).height = 8;

  // ============================================================
  // KODE / NAMA / ALAMAT CUSTOMER
  // ============================================================

  const idRows = [
    ["Kode Customer", inv.customer?.kode || "-"],
    ["Nama Customer", inv.customer?.nama || "-"],
    ["Alamat", inv.customer?.alamat || "-"],
  ];

  for (const [label, val] of idRows) {
    const r = ws.addRow([
      label,
      "",
      "",
      ":",
      val,
    ]);

    ws.mergeCells(
      `A${r.number}:C${r.number}`
    );

    ws.mergeCells(
      `E${r.number}:K${r.number}`
    );

    // Label
    applyFont(r.getCell(1), {
      size: FONT_SMALL,
      color: "FF444444",
    });

    // Nilai
    applyFont(r.getCell(5), {
      size: FONT_BODY,
      bold: true,
    });

    r.getCell(5).alignment = {
      wrapText: true,
      vertical: "middle",
    };

    r.getCell(4).alignment = {
      horizontal: "center",
      vertical: "middle",
    };

    r.height = Math.max(
      19,
      estimateWrapHeight(
        val,
        75,
        17
      )
    );
  }

  // Spasi
  ws.addRow([]).height = 8;

  // ============================================================
  // TABEL ITEM
  // ============================================================

  const header = [
    "No",
    "Tgl Kirim",
    "No SJ",
    "Sopir",
    "Alamat Kirim",
    "P",
    "L",
    "T",
    "M3",
    "Harga",
    "Jumlah",
  ];

  const rHeader = ws.addRow(header);

  rHeader.eachCell(
    (cell, colNumber) => {
      if (colNumber > LASTCOL) return;

      applyFont(cell, {
        size: FONT_IMPORTANT,
        bold: true,
      });

      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };

      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: "FFEEEEEE",
        },
      };

      // Hanya garis atas & bawah header (tanpa pembatas antar kolom).
      cell.border = ROW_TOP_BOTTOM;
    }
  );

  // Tinggi header dinaikkan supaya font 12 pt Times New Roman tidak
  // terlalu rapat.
  rHeader.height = 26;

  // ============================================================
  // DATA ITEM
  // ============================================================

  let totalM3 = 0;
  let lastItemRow = null;

  (inv.items || []).forEach(
    (it, i) => {
      const sj = it.suratJalan;

      const jumlah =
        Number(it.qty) *
        Number(it.hargaSatuan);

      totalM3 += Number(
        sj?.m3 || 0
      );

      const row = ws.addRow([
        i + 1,
        sj
          ? fmtDateShort(sj.tanggal)
          : "-",
        sj
          ? sj.no
          : "-",
        sj
          ? sj.sopir ||
            sj.armada?.sopir ||
            ""
          : "",
        sj
          ? sj.tujuan
          : it.keterangan,
        sj
          ? Number(
              sj.panjang ?? 0
            )
          : "",
        sj
          ? Number(
              sj.lebar ?? 0
            )
          : "",
        sj
          ? Number(
              sj.tinggi ?? 0
            )
          : "",
        sj
          ? Number(
              sj.m3 || 0
            )
          : Number(it.qty),
        Number(it.hargaSatuan),
        jumlah,
      ]);

      lastItemRow = row;

      row.eachCell(
        (cell, colNumber) => {
          if (colNumber > LASTCOL) return;

          applyFont(cell, {
            size: FONT_BODY,
          });

          // Tabel dibuat polos, tanpa pembatas antar kolom. Garis
          // penutup bawah ditambahkan belakangan di baris item
          // terakhir saja.
          cell.border = undefined;

          cell.alignment = {
            horizontal:
              colNumber === 5
                ? "left"
                : "center",

            vertical: "middle",

            wrapText:
              colNumber === 3 ||
              colNumber === 4 ||
              colNumber === 5,
          };
        }
      );

      // Harga
      row.getCell(10).numFmt =
        '"Rp" #,##0';

      // Jumlah
      row.getCell(11).numFmt =
        '"Rp" #,##0';

      // Harga dan jumlah dibuat sedikit lebih tegas.
      applyFont(
        row.getCell(10),
        {
          size: FONT_BODY,
          bold: true,
        }
      );

      applyFont(
        row.getCell(11),
        {
          size: FONT_BODY,
          bold: true,
        }
      );

      // Tinggi baris mengikuti teks terpanjang. Angka "chars per
      // line" & tinggi baris dinaikkan dibanding versi Courier New
      // 10pt supaya teks Times New Roman 12pt yang lebih besar tetap
      // kebaca penuh, tidak terpotong.
      row.height = Math.max(
        22,

        estimateWrapHeight(
          row.getCell(3).value,
          12,
          17
        ),

        estimateWrapHeight(
          row.getCell(4).value,
          13,
          17
        ),

        estimateWrapHeight(
          row.getCell(5).value,
          24,
          17
        )
      );
    }
  );

  // Garis penutup bawah tabel item (hanya di baris item terakhir).
  if (lastItemRow) {
    lastItemRow.eachCell((cell, colNumber) => {
      if (colNumber > LASTCOL) return;
      cell.border = ROW_BOTTOM;
    });
  }

  // ============================================================
  // BARIS TOTAL - sejajar dengan kolom tabel item di atas: "Total M3"
  // sejajar kolom Alamat Kirim (E), angka Total M3-nya sejajar kolom
  // M3 (I), dan jumlah total tagihan sejajar kolom Jumlah (K) - semua
  // dalam satu baris. Menggantikan kotak "Jumlah Total Tagihan /
  // Sudah Dibayar / Sisa" yang lama (field itu tidak lagi ditampilkan
  // di invoice cetak - lihat juga printInvoice() di frontend).
  // ============================================================

  const total =
    inv.total ??
    (inv.items || []).reduce(
      (s, i) =>
        s +
        i.qty *
          i.hargaSatuan,
      0
    );

  const rTotal = ws.addRow([
    "",
    "",
    "",
    "",
    "Total M3",
    "",
    "",
    "",
    totalM3.toFixed(3),
    "",
    total,
  ]);

  rTotal.eachCell(
    (cell, colNumber) => {
      if (colNumber > LASTCOL) return;
      cell.border = { top: THIN };
    }
  );

  // Label "Total M3" - sejajar kolom Alamat Kirim.
  applyFont(rTotal.getCell(5), {
    size: FONT_IMPORTANT,
    bold: true,
  });

  rTotal.getCell(5).alignment = {
    horizontal: "left",
    vertical: "middle",
  };

  // Angka Total M3 - sejajar kolom M3.
  applyFont(rTotal.getCell(9), {
    size: FONT_BODY,
    bold: true,
  });

  rTotal.getCell(9).alignment = {
    horizontal: "center",
    vertical: "middle",
  };

  // Jumlah Total Tagihan - sejajar kolom Jumlah.
  applyFont(rTotal.getCell(11), {
    size: FONT_TOTAL,
    bold: true,
  });

  rTotal.getCell(11).numFmt =
    '"Rp" #,##0';

  rTotal.getCell(11).alignment = {
    horizontal: "right",
    vertical: "middle",
  };

  rTotal.height = 24;

  // ============================================================
  // TERBILANG (+ CATATAN)
  // ============================================================

  const terbilangText = `Terbilang: ${terbilang(
    total
  )} Rupiah${
    inv.catatan
      ? `      Catatan: ${inv.catatan}`
      : ""
  }`;

  const rTerbilang = ws.addRow([
    terbilangText,
  ]);

  ws.mergeCells(
    `A${rTerbilang.number}:K${rTerbilang.number}`
  );

  applyFont(
    rTerbilang.getCell(1),
    {
      size: FONT_SMALL,
      bold: true,
    }
  );

  rTerbilang.getCell(1).alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: true,
  };

  rTerbilang.height = Math.max(
    18,
    estimateWrapHeight(
      terbilangText,
      100,
      16
    )
  );

  // Spasi
  ws.addRow([]).height = 8;

  // ============================================================
  // TANGGAL
  // ============================================================

  ws.addRow([]).height = 8;
  ws.addRow([]).height = 8;

  const rTgl = ws.addRow([
    "",
    "",
    "",
    "",
    "",
    `Jakarta, ${fmtDateLong(
      inv.tanggal
    )}`,
  ]);

  ws.mergeCells(
    `F${rTgl.number}:K${rTgl.number}`
  );

  applyFont(
    rTgl.getCell(6),
    {
      size: FONT_BODY,
    }
  );

  rTgl.getCell(6).alignment = {
    horizontal: "center",
    vertical: "middle",
  };

  rTgl.height = 20;

  // ============================================================
  // TANDA TANGAN
  // ============================================================

  ws.addRow([]).height = 8;
  ws.addRow([]).height = 8;

  const rSign = ws.addRow([
    "",
    "",
    "",
    "",
    "",
    signerName ||
      "Hormat Kami",
  ]);

  ws.mergeCells(
    `F${rSign.number}:K${rSign.number}`
  );

  applyFont(
    rSign.getCell(6),
    {
      size: FONT_IMPORTANT,
      bold: true,
      underline: true,
    }
  );

  rSign.getCell(6).alignment = {
    horizontal: "center",
    vertical: "middle",
  };

  rSign.height = 22;

  // ============================================================
  // PENGATURAN PRINT
  // ============================================================
  //
  // Penting:
  // Jangan mengubah ukuran kertas dari kode.
  //
  // User tetap memilih:
  // Page Layout > Size
  //
  // sesuai ukuran continuous form pada PC Windows XP
  // dan printer dot matrix yang digunakan.
  //
  // fitToWidth tetap 1 agar kolom A-K tidak pindah ke halaman
  // berikutnya.
  // ============================================================

  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0;

  return wb;
}