// Konfigurasi struktur "Laporan Divisi" (Laba Rugi per Divisi per Bulan),
// dibuat mengikuti persis bentuk laporan Excel bulanan perusahaan
// (sheet SUPPLIER, ARMADA, ALAT BERAT pada file "Pengeluaran Bulan ...").
//
// Tiap divisi punya daftar "kelompok" (section laporan, sesuai urutan
// tampil di Excel). Tiap kelompok punya:
//   - key            : kode unik dipakai untuk menyimpan di DivisiTx.kelompok
//   - label          : judul section yang ditampilkan (mis. "Sewa Armada & Excavator")
//   - tipe           : "PENJUALAN" (pendapatan) atau "PENGELUARAN"
//   - kategoriDefault: daftar baris/nama item bawaan (persis seperti di Excel),
//                      tetap tampil di laporan walau nominalnya masih 0
//   - subKategoriDefault (opsional): rincian per kategori (mis. Alat Berat:
//                      Uang Makan / Sparepart / Solar per unit alat)
//   - hasQty (opsional): true kalau item ini biasanya dihitung qty x harga satuan
//                      (mis. Tenaga Harian = jumlah hari x nominal/hari)
//   - allowCustom (opsional): true kalau user boleh menambah kategori baru
//                      di luar daftar default (mis. Pengeluaran Bulanan yang
//                      isinya bisa beda-beda tiap bulan: cicilan mobil baru, dst)
// Divisi Armada & Alat Berat "menyewakan" kendaraan/excavator ke Divisi
// Supplier -- persis seperti sheet COLD DIESEL/TRONTON di Excel yang
// rumusnya (='COLD DIESEL'!P27 dst) otomatis menjumlahkan Uang Jalan +
// Hasil Mobil per kendaraan menjadi baris "Sewa Armada & Excavator" di
// sheet SUPPLIER. Supaya perilaku itu sama persis di aplikasi, tiap kali
// ada transaksi PENDAPATAN dicatat di Armada/Alat Berat, backend otomatis
// membuat/mengubah/menghapus baris "cerminan"-nya (mirror) di kelompok
// "sewa" milik Supplier -- lihat fungsi getMirrorTarget() di divisiTx.js.
// Baris mirror ini ditandai lewat kolom `sumber` (diawali "AUTO_MIRROR_OF:")
// dan tidak boleh diedit/dihapus manual dari sisi Supplier; harus dari
// transaksi asalnya di Armada/Alat Berat.
export function getMirrorTarget(tx) {
  if (tx.kelompok !== "pendapatan") return null;
  if (tx.divisi === "Armada") {
    const kat = (tx.kategori || "").toLowerCase();
    let kategori = tx.kategori;
    if (kat.includes("tronton")) kategori = "Tronton";
    else if (kat.includes("diesel")) kategori = "Cold Diesel";
    return { kategori, subKategori: tx.subKategori || null };
  }
  if (tx.divisi === "Alat Berat") {
    // Semua unit excavator digabung jadi satu baris "Excavator" di Supplier
    // (di Excel angka ini malah statis/manual, tapi disini kita otomatiskan
    // supaya selalu sinkron dengan pendapatan Alat Berat yang sebenarnya).
    return { kategori: "Excavator", subKategori: tx.kategori || null };
  }
  return null;
}

export const MIRROR_SOURCE_PREFIX = "AUTO_MIRROR_OF:";

export const DIVISI_LIST = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

export const DIVISI_CONFIG = {
  Supplier: {
    kelompok: [
      {
        key: "penjualan",
        label: "Laporan Penjualan",
        tipe: "PENJUALAN",
        kategoriDefault: ["Invoice Harian", "Penjualan Cash"],
        allowCustom: true,
      },
      {
        key: "pembelian",
        label: "Laporan Pengeluaran (Pembelian Material)",
        tipe: "PENGELUARAN",
        kategoriDefault: [
          "Pasir Cilegon",
          "Pasir Bangka",
          "Pasir Pulpis",
          "Batu Belah",
          "Abu Batu",
          "Batu Split",
          "Makadam",
          "Basecose",
          "Sirdam",
          "Belanja Pasir Bangka",
        ],
        allowCustom: true,
      },
      {
        key: "sewa",
        label: "Sewa Armada & Excavator",
        tipe: "PENGELUARAN",
        kategoriDefault: ["Tronton", "Cold Diesel", "Excavator"],
        allowCustom: true,
      },
      {
        key: "harian",
        label: "Pengeluaran Harian",
        tipe: "PENGELUARAN",
        kategoriDefault: ["Tenaga Harian", "Uang Makan Staff"],
        hasQty: true,
        allowCustom: true,
      },
      {
        key: "bulanan",
        label: "Pengeluaran Bulanan",
        tipe: "PENGELUARAN",
        kategoriDefault: [
          "Pengeluaran Kantor",
          "Gaji Staff",
          "Biaya Operasional",
          "Pinjaman BRI",
          "Pinjaman DKI",
        ],
        allowCustom: true,
      },
    ],
  },

  Armada: {
    kelompok: [
      {
        key: "pendapatan",
        label: "Laporan Armada (Pendapatan)",
        tipe: "PENJUALAN",
        kategoriDefault: [
          "Hasil Mobil Tronton",
          "Uang Jalan Tronton",
          "Hasil Mobil Cold Diesel",
          "Uang Jalan Cold Diesel",
        ],
        allowCustom: true,
        // Rincian per kelompok ini diisi per KENDARAAN (nomor polisi), bukan
        // teks bebas -- persis seperti sheet COLD DIESEL / TRONTON di Excel
        // yang mendata tiap mobil (nopol) satu-satu. Frontend akan menampilkan
        // dropdown nopol yang diambil dari data master Armada (menu "Armada"),
        // difilter sesuai kategori (Tronton / Cold Diesel), plus opsi ketik
        // manual untuk nopol yang belum terdaftar di master.
        subKategoriKendaraan: true,
      },
      {
        key: "sparepart",
        label: "Laporan Pengeluaran Sparepart",
        tipe: "PENGELUARAN",
        kategoriDefault: ["Sparepart Tronton", "Sparepart Cold Diesel"],
        allowCustom: true,
        subKategoriKendaraan: true,
      },
      {
        key: "bulanan",
        label: "Pengeluaran Bulanan",
        tipe: "PENGELUARAN",
        kategoriDefault: [
          "Uang Makan Mekanik",
          "Koordinasi SIGAP",
          "Gaji Mekanik",
          "Pengeluaran Kantor",
          "Biaya Operasional",
        ],
        hasQty: true,
        allowCustom: true,
      },
    ],
  },

  "Alat Berat": {
    kelompok: [
      {
        key: "pendapatan",
        label: "Laporan Excavator (Pendapatan)",
        tipe: "PENJUALAN",
        kategoriDefault: [
          "Komatsu 01",
          "Komatsu 04",
          "Kobelco 05",
          "Kobelco 07",
          "Hitachi",
          "Rental Alat PC-100 Srengseng",
        ],
        allowCustom: true,
      },
      {
        key: "operasional",
        label: "Laporan Pengeluaran Operasional",
        tipe: "PENGELUARAN",
        kategoriDefault: [
          "Komatsu 01",
          "Komatsu 04",
          "Kobelco 05",
          "Kobelco 07",
          "Hitachi",
          "Rental Alat PC-100 Srengseng",
        ],
        subKategoriDefault: ["Uang Makan", "Sparepart", "Solar"],
        hasQty: true,
        allowCustom: true,
      },
      {
        key: "bulanan",
        label: "Pengeluaran Bulanan",
        tipe: "PENGELUARAN",
        kategoriDefault: ["Kantor", "Gaji Operator", "Biaya Operasional"],
        allowCustom: true,
      },
    ],
  },

  // Belum ada rincian dari Excel untuk 2 divisi ini, jadi disediakan generik
  // (bebas tambah kategori sendiri) sampai formatnya dikonfirmasi.
  Kontraktor: {
    kelompok: [
      { key: "penjualan", label: "Penjualan", tipe: "PENJUALAN", kategoriDefault: [], allowCustom: true },
      { key: "pengeluaran", label: "Pengeluaran", tipe: "PENGELUARAN", kategoriDefault: [], allowCustom: true },
    ],
  },
  Kapal: {
    kelompok: [
      { key: "penjualan", label: "Penjualan", tipe: "PENJUALAN", kategoriDefault: [], allowCustom: true },
      { key: "pengeluaran", label: "Pengeluaran", tipe: "PENGELUARAN", kategoriDefault: [], allowCustom: true },
    ],
  },
};

// Tambahan: kelompok "Lainnya" (Pendapatan Lainnya & Pengeluaran Lainnya) di
// SETIAP divisi yang strukturnya sudah baku mengikuti Excel (Supplier, Armada,
// Alat Berat) -- supaya kalau ada transaksi yang beneran di luar semua
// kelompok/kategori yang sudah ada, tetap bisa dicatat tanpa maksa masuk ke
// kelompok yang gak pas. Kategori di kelompok ini bebas diketik manual.
// Kontraktor & Kapal tidak perlu ditambah karena strukturnya memang sudah
// generik/bebas dari awal (kategori kosong + boleh isi manual).
const DIVISI_DENGAN_KELOMPOK_LAINNYA = ["Supplier", "Armada", "Alat Berat"];
for (const d of DIVISI_DENGAN_KELOMPOK_LAINNYA) {
  DIVISI_CONFIG[d].kelompok.push(
    {
      key: "lainnya-pendapatan",
      label: "Pendapatan Lainnya",
      tipe: "PENJUALAN",
      kategoriDefault: [],
      allowCustom: true,
    },
    {
      key: "lainnya-pengeluaran",
      label: "Pengeluaran Lainnya",
      tipe: "PENGELUARAN",
      kategoriDefault: [],
      allowCustom: true,
    }
  );
}
