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

// Font dibuat eksplisit "Courier New" di SEMUA sel (bukan dibiarkan pakai
// font bawaan Excel/Calibri) karena inilah alasan tulisan invoice hasil
// export kelihatan kecil & kurang jelas kalau dicetak lewat printer dot
// matrix: Calibri garisnya tipis dan gampang putus-putus di hasil dot
// matrix, sedangkan Courier New goresannya rata (monospace, mirip huruf
// mesin ketik/dot matrix asli) jadi lebih tebal & jelas kebaca. Ukuran juga
// dinaikkan dari sebelumnya supaya tidak kekecilan.
const FONT_NAME = "Courier New";
const FONT_BASE = { name: FONT_NAME, size: 11 };
const FONT_LABEL = { name: FONT_NAME, size: 9.5, color: { argb: "FF555555" } };
const FONT_BOLD = { name: FONT_NAME, size: 11, bold: true };

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

// Perkiraan tinggi baris (dalam point) yang dibutuhkan supaya teks dengan
// wrapText tetap kebaca penuh (tidak kepotong tinggi barisnya), berdasarkan
// panjang teks dibagi kira-kira jumlah karakter yang muat per baris untuk
// lebar kolom (dalam satuan "lebar kolom Excel") yang diberikan. Excel/Google
// Sheets tidak selalu auto-fit tinggi baris untuk sel yang tingginya sudah
// di-set eksplisit dari kode, jadi tinggi ini sengaja dihitung manual supaya
// aman di kedua aplikasi tersebut, bukan cuma mengandalkan auto-fit Excel.
//
// lineHeightPt dinaikkan (14 -> 16) dan colWidthChars yang dikirim pemanggil
// fungsi ini sekarang dipangkas ~20% oleh pemanggilnya sebelum sampai sini -
// karena sejak semua sel dipaksa pakai font "Courier New" (monospace, demi
// kejelasan cetak dot matrix), goresan hurufnya lebih LEBAR dibanding font
// bawaan Excel (Calibri) yang dipakai waktu angka-angka ambang ini pertama
// dikalibrasi. Kalau ambangnya tidak disesuaikan, teks yang wrap 2 baris
// bisa kehitung cuma butuh 1 baris tinggi, lalu sebagian kepotong.
function estimateWrapHeight(text, colWidthChars, lineHeightPt = 16) {
  const len = String(text ?? "").length;
  if (!len) return lineHeightPt;
  const charsPerLine = Math.max(5, Math.floor(colWidthChars * 0.8));
  const lines = Math.max(1, Math.ceil(len / charsPerLine));
  return lines * lineHeightPt;
}

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
      // Kolom A-K (11 kolom) totalnya kadang sedikit lebih lebar dari
      // area cetak efektif kertas yang dipakai - kalau dibiarkan
      // fitToPage:false, Excel akan memotong kolom I-K itu ke HALAMAN
      // BARU (bukan ke kanan, tapi ke kertas berikutnya karena urutan
      // cetak default "ke bawah dulu"), jadi boros kertas continuous
      // form. fitToWidth:1 + fitToHeight:0 memaksa SEMUA kolom (A-K)
      // selalu muat di satu halaman lebar kertas (Excel yang otomatis
      // sedikit menyusutkan skalanya kalau perlu), sementara tinggi
      // tetap bebas mengalir apa adanya (tidak dipaksa 1 halaman tinggi)
      // - jadi tidak akan lagi ada halaman baru gara-gara kolom kepotong.
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      // Paper size sengaja tidak dipaksa di sini - atur sendiri lewat
      // Page Layout > Size di Excel sesuai kertas fisik yang dipakai
      // (persis seperti alur lama), supaya tidak bentrok dengan printer
      // yang beda-beda tiap kantor/komputer.
    },
  });

  // Kolom kira-kira sepadan dengan tabel di versi cetak browser:
  // No | Tgl Kirim | No SJ | Sopir | Alamat Kirim | P | L | T | M3 | Harga | Jumlah
  //
  // Total lebar 11 kolom ini SENGAJA dijaga cukup sempit (~108 satuan
  // lebar Excel) supaya secara fisik sudah muat di satu halaman lebar
  // kertas TANPA harus mengandalkan scaling "fit to page" (yang di
  // atas sudah diaktifkan juga sebagai lapis kedua) - karena scaling
  // itu kadang tidak konsisten kebaca di semua versi Excel / printer
  // driver yang berbeda-beda tiap komputer/kantor. Kolom yang isinya
  // sudah wrapText (No SJ, Sopir, Alamat Kirim) aman disempitkan
  // karena teks panjang akan turun ke bawah, bukan kepotong.
  ws.columns = [
    { width: 4 }, // A No
    { width: 9 }, // B Tgl Kirim
    { width: 12 }, // C No SJ
    { width: 11 }, // D Sopir
    { width: 22 }, // E Alamat Kirim
    { width: 6 }, // F P
    { width: 6 }, // G L
    { width: 6 }, // H T
    { width: 7 }, // I M3
    { width: 12 }, // J Harga
    { width: 13 }, // K Jumlah
  ];

  const LASTCOL = 11; // kolom K

  // ---- baris kosong pengganti "topMargin" kalibrasi (tinggi disamakan
  // supaya konsisten dengan versi cetak browser - kop surat fisik sudah
  // ada di area ini, jadi sengaja tidak ditumpuk tulisan apapun) ----
  ws.addRow([]).height = Number(calib?.topMargin ?? 21) * MM_TO_PT * 0.6;

  // ---- Kepada Yth (kiri) & Halaman/No Invoice/Tanggal (kanan) ----
  // Label-label ini digabung (merge) A:D biar dapat ruang lebar sendiri -
  // TIDAK mengandalkan "teks meluber ke kolom kosong sebelahnya", karena
  // kolom A sengaja dibuat sempit (lebar 4) untuk nomor urut tabel item
  // di bawah, jadi kalau cuma mengandalkan overflow, label panjang di
  // sini bisa kepotong (terutama di Google Sheets yang penanganan
  // overflow-nya kadang beda dari Excel).
  // Label di kolom I ("Halaman" / "No. Invoice" / "Tanggal") di-merge I:J
  // (bukan cuma mengandalkan overflow ke kolom J yang kosong), karena kalau
  // kolom J kebetulan tetap "ada isinya" (walau cuma string kosong "") teks
  // label yang lebih panjang dari lebar kolom I saja (mis. "No. Invoice")
  // akan KEPOTONG persis di batas kolom I/J - itulah yang bikin sebelumnya
  // muncul sebagai "No. Invoic" di hasil export.
  const rKepada = ws.addRow(["Kepada Yth", "", "", "", "", "", "", "", "Halaman", "", inv.halaman ?? 1]);
  ws.mergeCells(`A${rKepada.number}:D${rKepada.number}`);
  ws.mergeCells(`I${rKepada.number}:J${rKepada.number}`);
  rKepada.getCell(1).font = FONT_LABEL;
  rKepada.getCell(9).font = FONT_LABEL;
  rKepada.getCell(11).font = FONT_BOLD;

  const rNamaCust = ws.addRow([inv.customer?.nama || "", "", "", "", "", "", "", "", "No. Invoice", "", inv.no || ""]);
  ws.mergeCells(`A${rNamaCust.number}:D${rNamaCust.number}`);
  ws.mergeCells(`I${rNamaCust.number}:J${rNamaCust.number}`);
  rNamaCust.getCell(1).font = FONT_BOLD;
  rNamaCust.getCell(9).font = FONT_LABEL;
  rNamaCust.getCell(11).font = FONT_BOLD;

  const rAlamatCust = ws.addRow([inv.customer?.alamat || "", "", "", "", "", "", "", "", "Tanggal", "", fmtDateShort(inv.tanggal)]);
  ws.mergeCells(`A${rAlamatCust.number}:D${rAlamatCust.number}`);
  ws.mergeCells(`I${rAlamatCust.number}:J${rAlamatCust.number}`);
  rAlamatCust.getCell(1).font = FONT_BASE;
  rAlamatCust.getCell(9).font = FONT_LABEL;
  rAlamatCust.getCell(11).font = FONT_BOLD;

  ws.addRow([]);

  // ---- Kode / Nama / Alamat customer ----
  const idRows = [
    ["Kode Customer", inv.customer?.kode || "-"],
    ["Nama Customer", inv.customer?.nama || "-"],
    ["Alamat", inv.customer?.alamat || "-"],
  ];
  for (const [label, val] of idRows) {
    const r = ws.addRow([label, "", "", ":", val]);
    ws.mergeCells(`A${r.number}:C${r.number}`); // label dapat ruang A:C, kolom D tetap buat ":"
    // Nilainya (terutama Alamat) di-merge E:K & wrapText, bukan mengandalkan
    // overflow saja - alamat yang panjang bisa lebih lebar dari kolom E (26)
    // ditambah sisa kolom kosong di kanannya, jadi perlu wrap + tinggi baris
    // yang menyesuaikan supaya tidak ada bagian teks yang hilang dari tampilan.
    ws.mergeCells(`E${r.number}:K${r.number}`);
    r.getCell(1).font = FONT_LABEL;
    r.getCell(5).font = FONT_BOLD;
    r.getCell(5).alignment = { wrapText: true, vertical: "middle" };
    r.height = Math.max(r.height || 0, estimateWrapHeight(val, 83));
  }

  ws.addRow([]);

  // ---- tabel item ----
  const header = ["No", "Tgl Kirim", "No SJ", "Sopir", "Alamat Kirim", "P", "L", "T", "M3", "Harga", "Jumlah"];
  const rHeader = ws.addRow(header);
  rHeader.eachCell((cell, colNumber) => {
    if (colNumber > LASTCOL) return;
    cell.font = FONT_BOLD;
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
      cell.font = FONT_BASE;
      cell.border = BOX;
      cell.alignment = {
        horizontal: colNumber === 5 ? "left" : "center",
        vertical: "middle",
        // "No SJ" (3), "Sopir" (4) & "Alamat Kirim" (5) boleh panjang -
        // wrap TURUN ke bawah di kolom yang sama, jangan sampai kepotong
        // kiri/kanan (sebelumnya "No SJ" & label tanggal/tanda tangan di
        // bawah rawan kepotong di KEDUA sisi karena rata tengah & kolom
        // kiri-kanannya sama-sama terisi, jadi tidak bisa meluber sama sekali).
        wrapText: colNumber === 3 || colNumber === 4 || colNumber === 5,
      };
    });
    row.getCell(10).numFmt = '"Rp" #,##0';
    row.getCell(11).numFmt = '"Rp" #,##0';
    // Tinggi baris dihitung dari kolom TERPANJANG di antara No SJ / Sopir /
    // Alamat Kirim (bukan cuma Alamat Kirim saja) - supaya No SJ yang
    // panjang & wrap 2 baris juga tetap kebaca penuh, bukan cuma datanya
    // yang lengkap tapi tampilannya kepotong karena barisnya kependekan.
    row.height = Math.max(
      row.height || 0,
      estimateWrapHeight(row.getCell(3).value, 14),
      estimateWrapHeight(row.getCell(4).value, 14),
      estimateWrapHeight(row.getCell(5).value, 26)
    );
  });

  ws.addRow([]);

  // ---- total & terbilang (kiri) + kotak total tagihan (kanan) ----
  const total = inv.total ?? (inv.items || []).reduce((s, i) => s + i.qty * i.hargaSatuan, 0);

  const rTotalM3 = ws.addRow([`Total M3: ${totalM3.toFixed(3)}`]);
  rTotalM3.getCell(1).font = FONT_BOLD;

  if (inv.catatan) {
    const rCatatan = ws.addRow([`Catatan: ${inv.catatan}`]);
    rCatatan.getCell(1).font = { name: FONT_NAME, size: 9.5, italic: true };
  }

  ws.addRow([]);

  const boxRows = [
    ["Jumlah Total Tagihan", total],
    ["Sudah Dibayar", inv.dibayar],
    ["Sisa", inv.sisaTagihan],
  ];
  for (const [label, val] of boxRows) {
    const r = ws.addRow(["", "", "", "", "", "", "", "", label, "", val]);
    // Sama seperti label "No. Invoice" di atas: "Jumlah Total Tagihan" &
    // "Sudah Dibayar" lebih panjang dari lebar kolom I saja, jadi di-merge
    // I:J supaya tidak kepotong (sebelumnya muncul sebagai "Jumlah T" /
    // "Sudah Di"). Border kotaknya diikutkan ke kolom J juga biar kotaknya
    // menyatu, bukan cuma mengelilingi kolom I.
    ws.mergeCells(`I${r.number}:J${r.number}`);
    r.getCell(9).font = FONT_BASE;
    r.getCell(9).border = BOX;
    r.getCell(10).border = BOX;
    r.getCell(9).alignment = { horizontal: "left", vertical: "middle" };
    r.getCell(11).font = FONT_BOLD;
    r.getCell(11).border = BOX;
    r.getCell(11).numFmt = '"Rp" #,##0';
    r.getCell(11).alignment = { horizontal: "right" };
  }

  ws.addRow([]);
  ws.addRow([]);

  // Sama seperti kasus "No SJ" di atas: teks ini rata TENGAH (center), jadi
  // butuh ruang kosong di KEDUA sisi supaya bisa meluber tanpa kepotong.
  // Sebelumnya cuma ditaruh di 1 sel (kolom H) dengan kolom G diisi "" -
  // itu menutup jalur meluber ke kiri, jadi bagian awal teksnya
  // ("Jakarta, ") kepotong hilang. Di-merge F:K supaya dapat ruang pasti,
  // tidak bergantung sama sekali ke sel tetangga.
  const rTgl = ws.addRow(["", "", "", "", "", `Jakarta, ${fmtDateLong(inv.tanggal)}`]);
  ws.mergeCells(`F${rTgl.number}:K${rTgl.number}`);
  rTgl.getCell(6).font = FONT_BASE;
  rTgl.getCell(6).alignment = { horizontal: "center" };

  ws.addRow([]);
  ws.addRow([]);

  const rSign = ws.addRow(["", "", "", "", "", signerName || "Hormat Kami"]);
  ws.mergeCells(`F${rSign.number}:K${rSign.number}`);
  rSign.getCell(6).font = { name: FONT_NAME, size: 11, bold: true, underline: true };
  rSign.getCell(6).alignment = { horizontal: "center" };

  return wb;
}