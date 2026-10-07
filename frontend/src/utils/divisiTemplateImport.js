// Import Laporan Divisi dari TEMPLATE BMS (format flat: 1 baris = 1 transaksi).
//
// Beda dengan utils/excelImport.js (membaca file laporan bulanan "Pengeluaran
// <Bulan> <Tahun>.xlsx" yang strukturnya khusus), template ini sederhana dan
// bisa dipakai untuk divisi/bulan/tanggal APA SAJA:
//
//   Divisi | Tanggal | Kelompok | Kategori | Rincian | Qty | Harga Satuan | Nominal | Keterangan
//
//   - Kelompok boleh ditulis kode (mis. "pendapatan") atau judulnya
//     (mis. "Laporan Armada (Pendapatan)") -- dicocokkan ke konfigurasi
//     divisi (sheet "Daftar Kelompok" di template berisi daftar yang valid).
//   - Tipe (pendapatan/pengeluaran) ditentukan otomatis dari Kelompok.
//   - Nominal kosong -> dihitung dari Qty x Harga Satuan.
//   - Kategori di luar daftar bawaan tetap boleh (hanya diberi peringatan).
//   - Baris Supplier > "Sewa Armada & Excavator" DILEWATI: baris itu terisi
//     otomatis dari pendapatan Armada & Alat Berat (kalau diisi manual akan dobel).
//   - Baris contoh di template (Keterangan diawali "contoh") dilewati otomatis.
import * as XLSX from "xlsx";
import { parseTanggal, parseAngka } from "./invoiceImport.js";

const norm = (v) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const ALIAS = {
  divisi: ["divisi"],
  tanggal: ["tanggal", "tgl"],
  kelompok: ["kelompok", "section", "bagian"],
  kategori: ["kategori", "nama item", "item"],
  subKategori: ["rincian", "sub kategori", "subkategori", "sub-kategori", "unit", "nopol"],
  qty: ["qty", "jumlah", "kuantitas"],
  hargaSatuan: ["harga satuan", "harga", "harga/satuan"],
  nominal: ["nominal", "total", "jumlah rupiah", "rupiah"],
  keterangan: ["keterangan", "catatan"],
};

function kolomDari(label) {
  const n = norm(label);
  for (const [k, list] of Object.entries(ALIAS)) if (list.includes(n)) return k;
  return null;
}

function cocokKelompok(list, teks) {
  const t = norm(teks);
  if (!t) return null;
  return (
    list.find((k) => norm(k.key) === t) ||
    list.find((k) => norm(k.label) === t) ||
    list.find((k) => norm(k.label).startsWith(t)) ||
    null
  );
}

// config = { [divisi]: { kelompok: [{ key,label,tipe,kategoriDefault,allowCustom }] } }
export async function parseDivisiTemplate(file, config) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const divisiNames = Object.keys(config);

  const items = [];
  const errors = [];
  const warnings = [];
  let sheetDibaca = 0;

  for (const name of wb.SheetNames) {
    if (/^(petunjuk|daftar kelompok)/i.test(name.trim())) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });

    // baris judul kolom: butuh minimal Divisi + Kelompok + Kategori + (Nominal atau Qty)
    let hi = -1;
    let map = null;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const m = {};
      (rows[i] || []).forEach((c, ci) => {
        const k = kolomDari(c);
        if (k && m[k] == null) m[k] = ci;
      });
      if (m.divisi != null && m.kelompok != null && m.kategori != null && (m.nominal != null || m.qty != null)) {
        hi = i;
        map = m;
        break;
      }
    }
    if (hi < 0) continue;
    sheetDibaca++;

    for (let i = hi + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const baris = i + 1;
      const get = (k) => (map[k] != null ? row[map[k]] : null);
      const teks = (k) => {
        const v = get(k);
        return v == null ? "" : String(v).trim();
      };
      if (!row.some((c) => c != null && c !== "")) continue; // baris kosong
      if (/^contoh/i.test(teks("keterangan"))) continue; // baris contoh bawaan template

      const divisi = divisiNames.find((d) => norm(d) === norm(teks("divisi")));
      if (!divisi) {
        errors.push({ sheet: name, baris, pesan: `Divisi "${teks("divisi")}" tidak dikenal (pilihan: ${divisiNames.join(", ")})` });
        continue;
      }
      const kel = cocokKelompok(config[divisi].kelompok, teks("kelompok"));
      if (!kel) {
        errors.push({ sheet: name, baris, pesan: `Kelompok "${teks("kelompok")}" tidak ada di divisi ${divisi} (lihat sheet "Daftar Kelompok")` });
        continue;
      }
      const kategori = teks("kategori");
      if (!kategori) {
        errors.push({ sheet: name, baris, pesan: "Kategori kosong" });
        continue;
      }
      const tanggal = parseTanggal(get("tanggal"));
      if (!tanggal) {
        errors.push({ sheet: name, baris, pesan: "Tanggal kosong / format tidak dikenali (pakai YYYY-MM-DD atau DD/MM/YYYY)" });
        continue;
      }
      const qty = parseAngka(get("qty"));
      const harga = parseAngka(get("hargaSatuan"));
      let nominal = parseAngka(get("nominal"));
      if ((nominal == null || nominal === 0) && qty && harga) nominal = Math.round(qty * harga);
      if (!nominal) {
        errors.push({ sheet: name, baris, pesan: "Nominal kosong (isi Nominal, atau Qty x Harga Satuan)" });
        continue;
      }

      if (divisi === "Supplier" && kel.key === "sewa") {
        warnings.push(`${name} baris ${baris}: "Sewa Armada & Excavator" dilewati (terisi otomatis dari pendapatan Armada & Alat Berat)`);
        continue;
      }
      if (kel.kategoriDefault?.length && !kel.allowCustom && !kel.kategoriDefault.some((k) => norm(k) === norm(kategori))) {
        warnings.push(`${name} baris ${baris}: kategori "${kategori}" tidak ada di daftar bawaan ${kel.label}`);
      }

      items.push({
        divisi,
        tipe: kel.tipe,
        kelompok: kel.key,
        kategori,
        subKategori: teks("subKategori") || null,
        qty: qty ?? null,
        hargaSatuan: harga ?? null,
        nominal,
        tanggal,
        keterangan: teks("keterangan") || null,
        sumber: `Import Template BMS (${file.name})`,
        sinkronMirror: true,
      });
    }
  }

  const perDivisi = {};
  for (const it of items) {
    if (!perDivisi[it.divisi]) perDivisi[it.divisi] = { penjualan: 0, pengeluaran: 0, items: [] };
    perDivisi[it.divisi].items.push(it);
    if (it.tipe === "PENJUALAN") perDivisi[it.divisi].penjualan += it.nominal;
    else perDivisi[it.divisi].pengeluaran += it.nominal;
  }

  return { sheetsFound: sheetDibaca ? [`${sheetDibaca} sheet`] : [], sheetsMissing: [], items, perDivisi, errors, warnings, sheetDibaca };
}

export function unduhTemplateDivisi(config) {
  const header = ["Divisi", "Tanggal", "Kelompok", "Kategori", "Rincian", "Qty", "Harga Satuan", "Nominal", "Keterangan"];
  const contoh = [];
  const daftar = [["Divisi", "Kelompok (kode)", "Judul Kelompok", "Tipe", "Kategori bawaan", "Boleh kategori baru?"]];
  const hariIni = new Date().toISOString().slice(0, 10);

  for (const [divisi, c] of Object.entries(config)) {
    for (const k of c.kelompok) {
      daftar.push([
        divisi,
        k.key,
        k.label,
        k.tipe === "PENJUALAN" ? "Pendapatan" : "Pengeluaran",
        (k.kategoriDefault || []).join(", "),
        k.allowCustom ? "Ya" : "Tidak",
      ]);
    }
  }
  // contoh: 1 baris pendapatan + 1 baris pengeluaran per divisi
  for (const [divisi, c] of Object.entries(config)) {
    const jual = c.kelompok.find((k) => k.tipe === "PENJUALAN" && !(divisi === "Supplier" && k.key === "sewa"));
    const keluar = c.kelompok.find((k) => k.tipe === "PENGELUARAN" && !(divisi === "Supplier" && k.key === "sewa"));
    if (jual) contoh.push([divisi, hariIni, jual.key, (jual.kategoriDefault || [])[0] || "Contoh kategori", "", "", "", 1500000, "contoh — boleh dihapus"]);
    if (keluar) contoh.push([divisi, hariIni, keluar.key, (keluar.kategoriDefault || [])[0] || "Contoh kategori", "", 2, 250000, "", "contoh: Nominal dihitung dari Qty x Harga"]);
  }

  const petunjuk = [
    ["PETUNJUK IMPOR LAPORAN DIVISI (TEMPLATE BMS)"],
    [],
    ["1. Satu baris = satu transaksi. Isi sheet \"Data\" (baris contoh yang Keterangannya diawali \"contoh\" otomatis dilewati)."],
    ["2. Divisi & Kelompok harus sesuai sheet \"Daftar Kelompok\" (Kelompok boleh ditulis kode atau judulnya)."],
    ["3. Tanggal format YYYY-MM-DD atau DD/MM/YYYY. Transaksi masuk ke laporan bulan sesuai tanggalnya."],
    ["4. Nominal boleh kosong kalau Qty dan Harga Satuan diisi (Nominal = Qty x Harga Satuan)."],
    ["5. Rincian = sub-kategori (mis. nopol kendaraan di Armada, nama unit di Alat Berat). Boleh kosong."],
    ["6. Supplier > Sewa Armada & Excavator tidak perlu diisi: otomatis dari pendapatan Armada & Alat Berat."],
    ["7. Baris yang persis sama dengan data yang sudah ada (divisi, kelompok, kategori, rincian, tanggal, nominal) dilewati, jadi aman diimport ulang."],
  ];

  const wb = XLSX.utils.book_new();
  const wsP = XLSX.utils.aoa_to_sheet(petunjuk);
  wsP["!cols"] = [{ wch: 130 }];
  const wsD = XLSX.utils.aoa_to_sheet([header, ...contoh]);
  wsD["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 28 }, { wch: 18 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 36 }];
  const wsK = XLSX.utils.aoa_to_sheet(daftar);
  wsK["!cols"] = [{ wch: 12 }, { wch: 20 }, { wch: 52 }, { wch: 12 }, { wch: 60 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsP, "Petunjuk");
  XLSX.utils.book_append_sheet(wb, wsD, "Data");
  XLSX.utils.book_append_sheet(wb, wsK, "Daftar Kelompok");
  XLSX.writeFile(wb, "Template_Import_Laporan_Divisi_BMS.xlsx");
}
