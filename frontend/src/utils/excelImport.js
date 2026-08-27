// Parser untuk file Excel bulanan "Pengeluaran <Bulan> <Tahun>.xlsx"
// (format laporan laba-rugi per divisi: sheet SUPPLIER, ARMADA, ALAT BERAT).
//
// Logikanya sudah divalidasi manual terhadap file asli: hasil parsing per
// divisi (Total Penjualan / Total Pengeluaran / Hasil Bersih) cocok 100%
// dengan angka "Total"/"Hasil Bersih" yang tertulis di Excel-nya.
//
// Cara baca tiap baris data di sheet-sheet ini:
//   - Judul section (mis. "LAPORAN PENJUALAN") ada di kolom A, baris lain kosong.
//   - Baris item level-1: kolom A = No urut, kolom B = nama item.
//   - Baris item level-2 (rincian per unit, mis. Uang Makan/Sparepart/Solar
//     per alat berat): kolom A kosong, kolom B = No urut lokal, kolom C = nama rincian.
//   - Baris "Total"/"Jumlah"/"Hasil Bersih" dilewati (itu subtotal, bukan data).
//   - Nominal tidak selalu di kolom yang sama (kadang G, kadang H, tergantang
//     ada tidaknya kolom qty/harga satuan) — jadi diambil dari angka PALING
//     KANAN yang terisi di baris itu. Kalau ada 3 angka (qty, harga satuan,
//     nominal), 2 angka pertama disimpan sebagai qty & hargaSatuan.
import * as XLSX from "xlsx";

// section header (persis teks di kolom A sheet) -> { kelompok, tipe }
// kelompok key HARUS sama dengan key di backend/src/config/divisiConfig.js
const SHEET_SECTION_MAP = {
  SUPPLIER: {
    divisi: "Supplier",
    sections: {
      "LAPORAN PENJUALAN": { kelompok: "penjualan", tipe: "PENJUALAN" },
      "LAPORAN PENGELUARAN": { kelompok: "pembelian", tipe: "PENGELUARAN" },
      "SEWA ARMADA DAN EXCAVATOR": { kelompok: "sewa", tipe: "PENGELUARAN" },
      "PENGELUARAN HARIAN": { kelompok: "harian", tipe: "PENGELUARAN" },
      "PENGELUARAN BULANAN": { kelompok: "bulanan", tipe: "PENGELUARAN" },
    },
  },
  ARMADA: {
    divisi: "Armada",
    sections: {
      "LAPORAN ARMADA": { kelompok: "pendapatan", tipe: "PENJUALAN" },
      "LAPORAN PENGELUARAN": { kelompok: "sparepart", tipe: "PENGELUARAN" },
      "LAPORAN PENGELUARAN BULANAN": { kelompok: "bulanan", tipe: "PENGELUARAN" },
    },
  },
  "ALAT BERAT": {
    divisi: "Alat Berat",
    sections: {
      "LAPORAN EXCAVATOR": { kelompok: "pendapatan", tipe: "PENJUALAN" },
      "LAPORAN PENGELUARAN": { kelompok: "operasional", tipe: "PENGELUARAN" },
      "LAPORAN PENGELUARAN BULANAN": { kelompok: "bulanan", tipe: "PENGELUARAN" },
    },
  },
};

const SKIP_LABELS = new Set([
  "total",
  "jumlah",
  "total pendapatan",
  "total pengeluaran",
  "hasil bersih",
]);

function isNum(v) {
  return typeof v === "number" && !isNaN(v);
}

function parseSheet(sheetName, ws, tanggal, sumberFile) {
  const cfg = SHEET_SECTION_MAP[sheetName];
  if (!cfg) return [];

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  let curSection = null; // { kelompok, tipe }
  let curKategori = null;
  const items = [];

  for (const row of rows) {
    const a = row[0], b = row[1], c = row[2];

    // Judul section
    if (typeof a === "string" && b == null) {
      const key = a.trim().toUpperCase();
      if (cfg.sections[key]) {
        curSection = cfg.sections[key];
        curKategori = null;
        continue;
      }
    }
    if (!curSection) continue;

    let label = null;
    let level = null;
    if (isNum(a) && typeof b === "string") {
      label = b.trim();
      level = 1;
    } else if (a == null && isNum(b) && typeof c === "string") {
      label = c.trim();
      level = 2;
    }
    if (!label) continue;
    if (SKIP_LABELS.has(label.toLowerCase())) continue;

    if (level === 1) curKategori = label;

    const startCol = level === 1 ? 3 : 4;
    const nums = row.slice(startCol).filter(isNum);
    if (level === 1) {
      // baris grup tanpa nominal langsung (mis. "Kobelco 05" di section
      // Pengeluaran, cuma header buat rincian di bawahnya) -> bukan data leaf
      if (!nums.length) continue;
    }
    if (!nums.length) continue;

    const nominal = nums[nums.length - 1];
    if (!nominal) continue; // 0 atau kosong, tidak perlu dicatat

    let qty = null, hargaSatuan = null;
    if (nums.length >= 3) {
      qty = nums[nums.length - 3];
      hargaSatuan = nums[nums.length - 2];
    }

    items.push({
      divisi: cfg.divisi,
      tipe: curSection.tipe,
      kelompok: curSection.kelompok,
      kategori: level === 1 ? label : curKategori || label,
      subKategori: level === 2 ? label : null,
      qty,
      hargaSatuan,
      nominal,
      tanggal,
      sumber: `Excel Import - ${sheetName} (${sumberFile})`,
    });
  }
  return items;
}

// Baca file Excel dan hasilkan daftar transaksi siap-import.
// `bulan` = "YYYY-MM" (dipilih user di form import, karena sheet-sheet ini
// cuma total bulanan, tidak ada tanggal harian per baris).
export async function parseDivisiExcel(file, bulan) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const tanggal = `${bulan}-01`;

  const all = [];
  const perSheet = {};
  for (const sheetName of Object.keys(SHEET_SECTION_MAP)) {
    if (!wb.SheetNames.includes(sheetName)) continue;
    const items = parseSheet(sheetName, wb.Sheets[sheetName], tanggal, file.name);
    perSheet[sheetName] = items;
    all.push(...items);
  }

  const perDivisi = {};
  for (const it of all) {
    if (!perDivisi[it.divisi]) perDivisi[it.divisi] = { penjualan: 0, pengeluaran: 0, items: [] };
    perDivisi[it.divisi].items.push(it);
    if (it.tipe === "PENJUALAN") perDivisi[it.divisi].penjualan += it.nominal;
    else perDivisi[it.divisi].pengeluaran += it.nominal;
  }

  return {
    sheetsFound: Object.keys(perSheet),
    sheetsMissing: Object.keys(SHEET_SECTION_MAP).filter((s) => !wb.SheetNames.includes(s)),
    items: all,
    perDivisi,
  };
}
