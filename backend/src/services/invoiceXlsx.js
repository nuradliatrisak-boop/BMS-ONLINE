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
// PERUBAHAN KHUSUS DOT MATRIX:
//   - Font utama menggunakan Courier New agar bentuk karakter jelas
//     pada printer dot matrix.
//   - Ukuran font isi dinaikkan menjadi 10 pt.
//   - Header tabel dibuat 10 pt bold.
//   - Informasi invoice penting dibuat 10-11 pt.
//   - Total tagihan dibuat 11 pt bold.
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
const DOT_FONT = "Courier New";
const FONT_BODY = 12;
const FONT_SMALL = 10;
const FONT_IMPORTANT = 12;
const FONT_TOTAL = 13;

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

const THIN = {
  style: "thin",
  color: { argb: "FF111111" },
};

const BOX = {
  top: THIN,
  bottom: THIN,
  left: THIN,
  right: THIN,
};

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

function terbilang(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return "Nol";

  const s = [
    "", "Satu", "Dua", "Tiga", "Empat", "Lima",
    "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas",
  ];

  function f(x) {
    if (x < 12) return s[x];
    if (x < 20) return f(x - 10) + " Belas";
    if (x < 100) return f(Math.floor(x / 10)) + " Puluh" + (x % 10 ? " " + f(x % 10) : "");
    if (x < 200) return "Seratus" + (x - 100 ? " " + f(x - 100) : "");
    if (x < 1000) return f(Math.floor(x / 100)) + " Ratus" + (x % 100 ? " " + f(x % 100) : "");
    if (x < 2000) return "Seribu" + (x - 1000 ? " " + f(x - 1000) : "");
    if (x < 1000000) return f(Math.floor(x / 1000)) + " Ribu" + (x % 1000 ? " " + f(x % 1000) : "");
    if (x < 1000000000) return f(Math.floor(x / 1000000)) + " Juta" + (x % 1000000 ? " " + f(x % 1000000) : "");
    if (x < 1000000000000) return f(Math.floor(x / 1000000000)) + " Miliar" + (x % 1000000000 ? " " + f(x % 1000000000) : "");
    return f(Math.floor(x / 1000000000000)) + " Triliun" + (x % 1000000000000 ? " " + f(x % 1000000000000) : "");
  }

  return f(n);
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
  ws.columns = [
    { width: 4 },  // A No
    { width: 10 }, // B Tgl Kirim
    { width: 14 }, // C No SJ
    { width: 14 }, // D Sopir
    { width: 26 }, // E Alamat Kirim
    { width: 7 },  // F P
    { width: 7 },  // G L
    { width: 7 },  // H T
    { width: 8 },  // I M3
    { width: 13 }, // J Harga
    { width: 15 }, // K Jumlah
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

  // Judul invoice dibuat jelas dan benar-benar berada di tengah atas.
  const rTitle = ws.addRow(["INVOICE"]);
  ws.mergeCells(`A${rTitle.number}:K${rTitle.number}`);
  applyFont(rTitle.getCell(1), { size: 16, bold: true });
  rTitle.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  rTitle.height = 24;

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

  rKepada.height = 16;

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

  rNamaCust.height = 17;

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
    17,
    estimateWrapHeight(
      inv.customer?.alamat || "",
      32,
      15
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
      17,
      estimateWrapHeight(
        val,
        83,
        15
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

      cell.border = BOX;
    }
  );

  // Tinggi header sedikit dinaikkan supaya font 10 pt
  // tidak terlalu rapat pada printer dot matrix.
  rHeader.height = 24;

  // ============================================================
  // DATA ITEM
  // ============================================================

  let totalM3 = 0;

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

      row.eachCell(
        (cell, colNumber) => {
          if (colNumber > LASTCOL) return;

          applyFont(cell, {
            size: FONT_BODY,
          });

          cell.border = BOX;

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

      // Tinggi baris mengikuti teks terpanjang.
      row.height = Math.max(
        19,

        estimateWrapHeight(
          row.getCell(3).value,
          14,
          15
        ),

        estimateWrapHeight(
          row.getCell(4).value,
          14,
          15
        ),

        estimateWrapHeight(
          row.getCell(5).value,
          26,
          15
        )
      );
    }
  );

  // ============================================================
  // TOTAL M3 + TOTAL TAGIHAN + TERBILANG
  // ============================================================

  ws.addRow([]).height = 6;

  const total =
    inv.total ??
    (inv.items || []).reduce(
      (sum, i) => sum + i.qty * i.hargaSatuan,
      0
    );

  const rSummary = ws.addRow([
    `Total M3: ${totalM3.toFixed(3)}`,
    "",
    "",
    "",
    "",
    "",
    "",
    "Jumlah Total Tagihan",
    "",
    "",
    total,
  ]);

  // Total tagihan dimulai dari kolom H = T (Tinggi), bukan terlalu ke kanan.
  ws.mergeCells(`A${rSummary.number}:G${rSummary.number}`);
  ws.mergeCells(`H${rSummary.number}:J${rSummary.number}`);

  applyFont(rSummary.getCell(1), {
    size: FONT_IMPORTANT,
    bold: true,
  });
  applyFont(rSummary.getCell(8), {
    size: FONT_IMPORTANT,
    bold: true,
  });
  applyFont(rSummary.getCell(11), {
    size: FONT_TOTAL,
    bold: true,
  });

  rSummary.getCell(1).alignment = {
    horizontal: "left",
    vertical: "middle",
  };
  rSummary.getCell(8).alignment = {
    horizontal: "left",
    vertical: "middle",
  };
  rSummary.getCell(11).alignment = {
    horizontal: "right",
    vertical: "middle",
  };

  rSummary.getCell(8).border = BOX;
  rSummary.getCell(9).border = BOX;
  rSummary.getCell(10).border = BOX;
  rSummary.getCell(11).border = BOX;
  rSummary.getCell(11).numFmt = '"Rp" #,##0';
  rSummary.height = 24;

  const rTerbilang = ws.addRow([
    `Terbilang: ${terbilang(total)} Rupiah`,
  ]);
  ws.mergeCells(`A${rTerbilang.number}:K${rTerbilang.number}`);
  applyFont(rTerbilang.getCell(1), {
    size: FONT_BODY,
    italic: true,
  });
  rTerbilang.getCell(1).alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: true,
  };
  rTerbilang.height = Math.max(
    20,
    estimateWrapHeight(`Terbilang: ${terbilang(total)} Rupiah`, 95, 16)
  );

  // ============================================================
  // CATATAN
  // ============================================================

  if (inv.catatan) {
    const rCatatan = ws.addRow([
      `Catatan: ${inv.catatan}`,
    ]);

    applyFont(
      rCatatan.getCell(1),
      {
        size: FONT_SMALL,
        italic: true,
      }
    );

    rCatatan.getCell(1).alignment = {
      wrapText: true,
      vertical: "middle",
    };

    rCatatan.height = Math.max(
      17,
      estimateWrapHeight(
        `Catatan: ${inv.catatan}`,
        80,
        14
      )
    );
  }

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

  rTgl.height = 18;

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

  rSign.height = 20;

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