import ExcelJS from "exceljs";

// ============================================================
// EXPORT SURAT JALAN KE EXCEL (.xlsx)
//
// Tujuannya sama dengan invoiceXlsx.js: banyak kertas continuous form /
// dot matrix yang dipakai sudah ada cetakan tetapnya secara fisik (judul
// "SURAT JALAN", kotak tabel "Nomor Polisi | Ukuran Bak | M3", label
// tanda tangan, dst - lihat halaman Kalibrasi Cetak), dan cetak lewat
// Excel jauh lebih stabil print-ke-print dibanding lewat dialog print
// browser, KARENA:
//   - Page Setup (ukuran kertas, margin, scale 100%) itu tersimpan DI
//     DALAM file itu sendiri dan dikirim apa adanya ke driver printer.
//   - Browser sebaliknya sering diam-diam pakai default sendiri tiap
//     dialog print dibuka (scale "Fit to printable area", margin bawaan,
//     dst) yang menimpa hasil kalibrasi walau kalibrasinya sendiri sudah
//     benar - itulah kenapa hasilnya suka geser padahal sudah dikalibrasi.
//
// BEDA dengan Invoice: Surat Jalan tidak dicetak sebagai tabel yang
// mengalir dari atas ke bawah - tiap field (A/P Dari, Nomor Polisi, dst)
// harus jatuh PERSIS di posisi X/Y (mm) tertentu di atas kotak/label yang
// sudah tercetak fisik di kertas (sama seperti versi cetak browser di
// print.js). Jadi di sini field-field itu dipetakan ke grid baris/kolom
// Excel:
//   - Sumbu X (kolom): grid halus per ~1mm. Ini AMAN dibuat kasar karena
//     teks Excel boleh "meluber" ke kanan lewat sel kosong di sebelahnya
//     (perilaku bawaan Excel), sama seperti CSS "position:absolute" di
//     versi browser - jadi tidak perlu presisi sampai per-huruf.
//   - Sumbu Y (baris): TIDAK boleh dibuat grid sekasar itu, karena beda
//     dari lebar kolom, TINGGI baris Excel akan MEMOTONG teks kalau lebih
//     pendek dari tinggi fontnya. Jadi baris dibuat "cascading": satu
//     field dapat satu baris, dan baris SEBELUMNYA diberi tinggi persis
//     sejarak (dalam mm, dikonversi ke point - konversi ini EXACT, tidak
//     tergantung font sama sekali) ke posisi Y field berikutnya. Kalau
//     dua field dikalibrasi terlalu berdempetan (jaraknya lebih kecil
//     dari tinggi minimum fontnya), field berikutnya akan mulai sedikit
//     lebih ke bawah dari kalibrasinya (tidak pernah kepotong / tumpang
//     tindih ke atas) - ini satu-satunya kompromi kecil dari pendekatan
//     ini, dan pada kalibrasi bawaan hanya berpotensi kena di pasangan
//     "Supir" / "Hormat kami" yang memang sudah berdekatan dan beda kolom.
//
// Font dikunci ke "Courier New" (sama seperti versi cetak browser di
// print.js) supaya lebar kolom yang dipakai untuk memposisikan sumbu X
// tetap konsisten - font ini bawaan Windows sejak XP jadi selalu tersedia
// di komputer manapun file ini dibuka & diprint.
// ============================================================

const MM_TO_PT = 2.83464567; // 1 mm dalam point (satuan tinggi baris Excel - EXACT, tidak tergantung font)
const MM_TO_COLWIDTH = 0.5; // starting point lebar kolom per ~1mm untuk font Courier New - lihat catatan kalibrasi di bawah

// Definisi & posisi default tiap field - HARUS SAMA PERSIS dengan default
// di backend/src/routes/printCalib.js (DEFAULTS.sj.fields) dan dengan
// object "p" di frontend/src/services/print.js (fungsi printSJ), supaya
// tiga cara cetak ini (browser, Excel, dan halaman Kalibrasi Cetak) selalu
// merujuk ke satu sumber kalibrasi yang sama.
const FIELD_DEFS = {
  apDari: { x: 8, y: 10, size: 10, label: "A/P Dari" },
  penerima: { x: 8, y: 18, size: 10, label: "Penerima" },
  tujuan: { x: 8, y: 26, size: 10, label: "Tujuan" },
  jenisBarang: { x: 8, y: 34, size: 10, label: "Jenis Brg" },
  no: { x: 175, y: 30, size: 11, label: "Nomor" },
  tanggal: { x: 175, y: 38, size: 11, label: "Tanggal" },
  jam: { x: 175, y: 46, size: 11, label: "Jam" },
  nopol: { x: 14, y: 62, size: 13, label: null },
  ukuranBak: { x: 90, y: 62, size: 13, label: null },
  m3: { x: 200, y: 62, size: 13, label: null },
  sopirNama: { x: 150, y: 98, size: 11, label: null },
  hormatKamiNama: { x: 226, y: 102, size: 11, label: null },
};

function fmtDateShort(v) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

export async function buildSJWorkbook(sjOrList, calib, signerName) {
  const list = Array.isArray(sjOrList) ? sjOrList : [sjOrList];
  const wb = new ExcelJS.Workbook();

  const c = calib || {};
  const ox = Number(c.offsetX || 0);
  const oy = Number(c.offsetY || 0);
  const f = c.fields || {};

  const pos = (key) => {
    const d = FIELD_DEFS[key];
    return {
      x: Number(f[key]?.x ?? d.x) + ox,
      y: Number(f[key]?.y ?? d.y) + oy,
      size: Number(f[key]?.size ?? d.size),
      label: d.label,
    };
  };

  list.forEach((sj, idx) => {
    const p = {};
    for (const key of Object.keys(FIELD_DEFS)) p[key] = pos(key);

    const namaCustomer = sj.customer
      ? `${sj.customer.nama}${sj.customer.kode ? " / " + sj.customer.kode : ""}`
      : "-";
    const namaPenerima = sj.penerima || sj.customer?.nama || "-";
    const ukuran = `${Number(sj.panjang ?? sj.p ?? 0).toFixed(2)} - ${Number(
      sj.lebar ?? sj.l ?? 0
    ).toFixed(2)} - ${Number(sj.tinggi ?? sj.t ?? 0).toFixed(3)}`;

    const VAL = {
      apDari: namaCustomer,
      penerima: namaPenerima,
      tujuan: sj.tujuan || sj.customer?.alamat || "",
      jenisBarang: sj.jenisBarang || "",
      no: sj.no,
      tanggal: fmtDateShort(sj.tanggal),
      jam: sj.jam || "",
      nopol: sj.noPolisi || sj.armada?.nopol || "",
      ukuranBak: ukuran,
      m3: Number(sj.m3 || 0).toFixed(3),
      sopirNama: sj.sopir || sj.armada?.sopir || "",
      hormatKamiNama: signerName || "",
    };

    // Nama sheet Excel maksimal 31 karakter & tidak boleh duplikat.
    const sheetName = `SJ ${idx + 1} - ${sj.no || ""}`.slice(0, 31);
    const ws = wb.addWorksheet(sheetName, {
      pageSetup: {
        orientation: "landscape",
        margins: { top: 0, left: 0, right: 0, bottom: 0, header: 0, footer: 0 },
        // Sengaja TIDAK fitToPage - ini yang bikin browser suka
        // menyusutkan/membesarkan halaman otomatis dan bikin hasil geser.
        fitToPage: false,
        // Paper size custom sengaja tidak dipaksa di sini - atur sendiri
        // SEKALI lewat Page Layout > Size di Excel sesuai ukuran fisik
        // kertas continuous form (mis. 241.3mm x 108mm / 9.5" x 4.25"),
        // lalu simpan filenya sebagai TEMPLATE supaya tidak perlu diatur
        // ulang tiap generate baru.
      },
    });

    // ---- Sumbu X: grid kolom halus per ~1mm ----
    const totalWmm = Number(c.w || 241.3);
    const nCols = Math.max(1, Math.ceil(totalWmm));
    ws.columns = Array.from({ length: nCols }, () => ({ width: MM_TO_COLWIDTH }));

    // ---- Sumbu Y: baris "cascading" (lihat penjelasan panjang di atas) ----
    const fieldsByY = Object.keys(FIELD_DEFS)
      .map((key) => ({ key, ...p[key] }))
      .sort((a, b) => a.y - b.y);

    let cursorY = 0;
    let rowIdx = 1;
    const rowOfField = {};

    for (const fld of fieldsByY) {
      const gap = fld.y - cursorY;
      if (gap > 0.01) {
        // baris kosong "penyambung jarak" ke posisi Y field ini
        ws.getRow(rowIdx).height = gap * MM_TO_PT;
        rowIdx++;
        cursorY = fld.y;
      }
      // tinggi minimum supaya font tidak kepotong (baris pas-pasan bikin
      // teks terpotong di Excel, beda dari lebar kolom yang boleh meluber)
      const minNeededMm = (fld.size * 1.35) / MM_TO_PT;
      const rowHeightMm = Math.max(minNeededMm, 1);
      ws.getRow(rowIdx).height = rowHeightMm * MM_TO_PT;
      rowOfField[fld.key] = rowIdx;
      cursorY += rowHeightMm;
      rowIdx++;
    }

    // sisa tinggi kertas di bawah field terakhir, supaya tinggi halaman
    // tetap sesuai ukuran fisik kertas walau tidak ada isi di situ
    const totalHmm = Number(c.h || 108);
    if (cursorY < totalHmm) {
      ws.getRow(rowIdx).height = (totalHmm - cursorY) * MM_TO_PT;
    }

    for (const key of Object.keys(FIELD_DEFS)) {
      const fld = p[key];
      const col = Math.max(1, Math.round(fld.x));
      const row = rowOfField[key];
      const text = fld.label ? `${fld.label} : ${VAL[key] ?? "-"}` : String(VAL[key] ?? "");
      const cell = ws.getCell(row, col);
      cell.value = text;
      cell.font = { name: "Courier New", size: fld.size };
      cell.alignment = { vertical: "top", horizontal: "left" };
    }
  });

  return wb;
}
