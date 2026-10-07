// Parser & template Excel untuk IMPOR INVOICE.
//
// Aturan umum: 1 sheet = 1 invoice = 1 customer (sama seperti file
// "Rekap Invoice" lama yang sheet-nya per customer).
//
// Format template BMS (tombol "Unduh Template" di dialog impor):
//   Baris atas (label di kolom A, nilai di kolom B):
//     Customer | Divisi | Tanggal Invoice | Jatuh Tempo | No. Rekapan / Catatan
//   Lalu tabel dengan judul kolom (urutan bebas, nama kolom dicari lewat label):
//     No | Tanggal | No Surat Jalan | No Polisi | Jenis Barang | P | L | T |
//     Jumlah | Satuan | Harga Satuan | Tujuan / Lokasi | Total
//
// Parser sengaja LONGGAR supaya file lama ikut terbaca:
//   - nama kolom boleh variasi ("No Pol", "Nopol", "No. Polisi", "Harga", ...)
//   - kolom "Jenis Barang" boleh tidak ada -> judul seksi di atas baris
//     (mis. "PASIR PASANG", "BATU SPLIT") dipakai sebagai jenis barang
//   - tanggal kosong = ikut tanggal baris di atasnya (kebiasaan di Excel lama)
//   - baris TOTAL / JUMLAH TOTAL dilewati; kolom Total tidak dipakai
//     (dihitung ulang dari Jumlah x Harga)
//   - kalau ada beberapa blok tabel berdampingan dalam satu sheet, hanya blok
//     PERTAMA yang dibaca (diberi peringatan) -> pisahkan per invoice ke sheet sendiri.
import * as XLSX from "xlsx";

const ALIAS = {
  tanggal: ["tanggal", "tgl", "tanggal kirim", "tgl kirim", "tanggal giro"],
  noSJ: ["no surat jalan", "no. surat jalan", "nomor surat jalan", "no sj", "no. sj", "surat jalan", "sj"],
  noPolisi: ["no pol", "no. pol", "nopol", "no polisi", "no. polisi", "nomor polisi", "plat", "plat nomor"],
  jenisBarang: ["jenis barang", "barang", "nama barang", "uraian", "keterangan", "deskripsi"],
  panjang: ["p", "panjang"],
  lebar: ["l", "lebar"],
  tinggi: ["t", "tinggi"],
  qty: ["jumlah", "qty", "kuantitas", "volume", "m3", "m³", "kubikasi"],
  satuan: ["satuan", "sat"],
  hargaSatuan: ["harga", "harga satuan", "harga/satuan", "hrg"],
  tujuan: ["tujuan", "lokasi", "tujuan / lokasi", "tujuan/lokasi", "alamat kirim", "proyek"],
  total: ["total", "jumlah harga", "subtotal"],
  no: ["no", "no."],
};

const norm = (v) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function kolomDari(label) {
  const n = norm(label);
  if (!n) return null;
  for (const [key, list] of Object.entries(ALIAS)) {
    if (list.includes(n)) return key;
  }
  return null;
}

const isNum = (v) => typeof v === "number" && !isNaN(v);

export function parseAngka(v) {
  if (isNum(v)) return v;
  if (v == null || v === "") return null;
  let s = String(v).trim().replace(/[^\d,.\-]/g, "");
  if (!s) return null;
  // "1.234.567" / "1.234,5" (format Indonesia) vs "1234.5"
  if (/,\d{1,3}$/.test(s) && /\./.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? null : n;
}

const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseTanggal(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) {
    // SheetJS cellDates kadang meleset beberapa detik/menit dari tengah malam
    // karena konversi zona waktu -> geser 12 jam supaya tanggalnya tidak mundur sehari.
    return isoDate(new Date(v.getTime() + 12 * 3600 * 1000));
  }
  if (isNum(v) && v > 20000 && v < 80000) {
    // serial Excel -> tanggal (basis 1899-12-30)
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${pad(m[2])}-${pad(m[1])}`;
  }
  const BULAN = { januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12 };
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s);
  if (m && BULAN[m[2].toLowerCase()]) return `${m[3]}-${pad(BULAN[m[2].toLowerCase()])}-${pad(m[1])}`;
  return null;
}

// Petakan judul kolom pada 1 baris -> { map, dikenal, blok }.
function petaKolom(row, end = Infinity) {
  const map = {};
  let dikenal = 0;
  let blok = 0;
  (row || []).forEach((cell, c) => {
    if (c >= end) return;
    const k = kolomDari(cell);
    if (!k) return;
    if (k === "noSJ" && map.noSJ != null) blok++;
    if (map[k] == null) {
      map[k] = c;
      if (k !== "no" && k !== "total") dikenal++;
    }
  });
  return { map, dikenal, blok };
}

// Baris judul kolom yang valid untuk tabel invoice: >= 3 label dikenal, ada
// Jumlah (atau P-L-T) DAN kolom Harga. Kolom Harga wajib supaya sheet lain
// (mis. rekap pembayaran/giro) tidak ikut terbaca sebagai invoice.
function headerValid({ map, dikenal }) {
  const adaJumlah = map.qty != null || (map.panjang != null && map.lebar != null && map.tinggi != null);
  return dikenal >= 3 && adaJumlah && map.hargaSatuan != null;
}

// Kalau judul kolom muncul berulang ke kanan (beberapa tabel berdampingan),
// blok pertama dibatasi sampai kolom awal blok kedua (`end`).
function batasBlok(row) {
  const cols = (row || []).map((c, i) => (kolomDari(c) === "no" ? i : -1)).filter((i) => i >= 0);
  if (cols.length > 1) return { start: cols[0], end: cols[1], banyakBlok: true };
  const tgl = (row || []).map((c, i) => (kolomDari(c) === "tanggal" ? i : -1)).filter((i) => i >= 0);
  if (tgl.length > 1) return { start: Math.max(tgl[0] - 1, 0), end: tgl[1] - 1, banyakBlok: true };
  return { start: 0, end: Infinity, banyakBlok: false };
}

function cariHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const penuh = petaKolom(rows[i]);
    if (!headerValid(penuh) && penuh.dikenal < 3) continue;
    const b = batasBlok(rows[i]);
    const h = petaKolom(rows[i], b.end);
    if (headerValid(h)) return { index: i, map: h.map, end: b.end, start: b.start, banyakBlok: b.banyakBlok };
  }
  return null;
}

const INFO_LABEL = [
  { key: "customer", re: /^(customer|nama customer|pelanggan|kepada|rekapan)$/i },
  { key: "divisi", re: /^divisi$/i },
  { key: "tanggal", re: /^(tanggal invoice|tgl invoice|tanggal)$/i },
  { key: "jatuhTempo", re: /^(jatuh tempo|tgl jatuh tempo)$/i },
  { key: "catatan", re: /^(no\.? ?rekapan( ?\/ ?catatan)?|catatan|no\.? rekapan)$/i },
];

function bacaInfoAtas(rows, sampai) {
  const info = {};
  for (let i = 0; i < sampai; i++) {
    const cells = (rows[i] || []).map((c) => (c == null ? "" : c));
    for (let c = 0; c < cells.length; c++) {
      const raw = cells[c];
      if (typeof raw !== "string" || !raw.trim()) continue;
      // "Rekapan : PT. Rais Pasir Putih" dalam satu sel
      const gabung = /^([^:]{2,30})\s*:\s*(.+)$/.exec(raw.trim());
      let label = raw.trim().replace(/\s*:\s*$/, "");
      let nilai = null;
      if (gabung) {
        label = gabung[1].trim();
        nilai = gabung[2].trim();
      } else {
        for (let d = c + 1; d < cells.length; d++) {
          const v = cells[d];
          if (v === "" || v == null) continue;
          nilai = v instanceof Date || isNum(v) ? v : String(v).replace(/^\s*:\s*/, "").trim();
          break;
        }
      }
      const hit = INFO_LABEL.find((x) => x.re.test(label));
      if (hit && nilai != null && nilai !== "" && info[hit.key] == null) info[hit.key] = nilai;
      break; // satu label per baris cukup
    }
  }
  return info;
}

function parseSheet(sheetName, ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const warnings = [];
  const header = cariHeader(rows);
  if (!header) return { sheetName, dilewati: true, alasan: "Judul kolom tidak ditemukan (butuh minimal Tanggal/No Surat Jalan/Jumlah/Harga)." };

  let map = header.map;
  const { start, end } = header;
  if (header.banyakBlok) {
    warnings.push("Ada beberapa blok tabel berdampingan — hanya blok pertama yang dibaca. Pisahkan tiap invoice ke sheet sendiri.");
  }
  const info = bacaInfoAtas(rows, header.index);

  const items = [];
  let tglTerakhir = null;
  let seksi = ""; // judul seksi, mis. "PASIR PASANG" -> dipakai jika tidak ada kolom Jenis Barang
  let barisAsli = header.index + 1;

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = (rows[i] || []).slice(0, end);
    barisAsli = i + 1;
    // header ulang di tengah sheet (seksi baru, mis. "BATU SPLIT" dengan kolom
    // P-L-T tanpa Jenis Barang) -> pakai pemetaan kolom baru untuk baris-baris berikutnya.
    // Dicek SEBELUM baris TOTAL karena judul kolom juga memuat kata "Total".
    const hBaru = petaKolom(row, end);
    if (hBaru.dikenal >= 3) {
      if (headerValid(hBaru)) map = hBaru.map;
      continue;
    }

    const teks = row.filter((c) => typeof c === "string").map((c) => c.trim().toLowerCase());
    if (teks.some((t) => /^(jumlah )?total\b|^total tagihan|^hormat kami/.test(t))) {
      continue; // baris TOTAL / penutup: lewati
    }

    const get = (k) => (map[k] != null ? row[map[k]] : null);
    const qtyRaw = parseAngka(get("qty"));
    const p = parseAngka(get("panjang")) || 0;
    const l = parseAngka(get("lebar")) || 0;
    const t = parseAngka(get("tinggi")) || 0;
    const harga = parseAngka(get("hargaSatuan"));
    const jenisCell = get("jenisBarang");
    const adaAngka = (qtyRaw && qtyRaw > 0) || (p && l && t);

    if (!adaAngka) {
      // baris judul seksi: sel pertama blok berisi teks (bukan nomor urut) tapi
      // tidak ada angka data di baris itu
      const judul = row[start];
      if (typeof judul === "string" && judul.trim() && !kolomDari(judul) && !harga) {
        seksi = judul.trim();
      }
      continue;
    }

    const tgl = parseTanggal(get("tanggal"));
    if (tgl) tglTerakhir = tgl;

    const noSJRaw = get("noSJ");
    const jenis =
      (typeof jenisCell === "string" && jenisCell.trim()) ||
      (isNum(jenisCell) ? String(jenisCell) : "") ||
      seksi ||
      "";

    items.push({
      barisAsli,
      tanggal: tgl || tglTerakhir,
      noSJ: noSJRaw == null ? "" : String(noSJRaw).trim(),
      noPolisi: get("noPolisi") ? String(get("noPolisi")).replace(/\s+/g, " ").trim() : "",
      jenisBarang: jenis,
      panjang: p || "",
      lebar: l || "",
      tinggi: t || "",
      qty: qtyRaw && qtyRaw > 0 ? qtyRaw : "",
      // satuan dari kolom Satuan, atau dari teks di sel Jumlah ("1 set", "200 lt")
      satuan: get("satuan")
        ? String(get("satuan")).trim()
        : typeof get("qty") === "string" && /([A-Za-z³]+)\s*$/.test(get("qty").trim())
          ? /([A-Za-z³]+)\s*$/.exec(get("qty").trim())[1].toLowerCase()
          : "",
      hargaSatuan: harga || "",
      tujuan: get("tujuan") ? String(get("tujuan")).trim() : "",
    });
  }

  const tanggalInfo = parseTanggal(info.tanggal);
  const tanggalMaks = items.map((x) => x.tanggal).filter(Boolean).sort().pop() || null;

  return {
    sheetName,
    dilewati: !items.length,
    alasan: items.length ? "" : "Tidak ada baris data yang terbaca.",
    customerNama: typeof info.customer === "string" ? info.customer.replace(/^[:\s]+/, "") : "",
    divisi: typeof info.divisi === "string" ? info.divisi : "",
    tanggal: tanggalInfo || tanggalMaks || isoDate(new Date()),
    jatuhTempo: parseTanggal(info.jatuhTempo) || "",
    catatan: info.catatan != null ? String(info.catatan) : "",
    items,
    warnings,
  };
}

export async function parseInvoiceExcel(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheets = [];
  for (const name of wb.SheetNames) {
    if (/^petunjuk/i.test(name.trim())) continue; // sheet petunjuk di template
    sheets.push(parseSheet(name, wb.Sheets[name]));
  }
  return sheets;
}

// ---- pencocokan nama customer di Excel ke master Customer ----
const BADAN = /\b(pt|cv|ud|pd|tbk|persero|koperasi|kop)\b\.?/g;
function kunciNama(s) {
  return String(s || "")
    .toLowerCase()
    .replace(BADAN, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cocokkanCustomer(nama, customers) {
  const k = kunciNama(nama);
  if (!k) return null;
  const list = customers.map((c) => ({ c, k: kunciNama(c.nama), kode: String(c.kode || "").toLowerCase() }));
  const exact = list.find((x) => x.k === k || x.kode === k);
  if (exact) return exact.c;
  const hit = list.filter((x) => x.k && (x.k.includes(k) || k.includes(x.k)));
  return hit.length === 1 ? hit[0].c : null;
}

// ---- Template ----
export function unduhTemplateInvoice() {
  const hariIni = new Date().toISOString().slice(0, 10);
  const aoa = (customer, divisi, rows) => [
    ["Customer", customer],
    ["Divisi", divisi],
    ["Tanggal Invoice", hariIni],
    ["Jatuh Tempo", ""],
    ["No. Rekapan / Catatan", "05/RE/INV-BMS/X/2026"],
    [],
    ["No", "Tanggal", "No Surat Jalan", "No Polisi", "Jenis Barang", "P", "L", "T", "Jumlah", "Satuan", "Harga Satuan", "Tujuan / Lokasi", "Total"],
    ...rows,
  ];

  const sheetMaterial = aoa("PT. Contoh Customer", "Supplier", [
    [1, "2026-10-01", 9254, "B 9069 UIS", "Pasir Pasang", 3.6, 1.9, 0.85, "", "m3", 270000, "Proyek Duku Kramatjati", ""],
    [2, "2026-10-01", 9253, "B 9188 UYX", "Pasir Pasang", 3.6, 1.9, 0.85, "", "m3", 270000, "Proyek Duku Kramatjati", ""],
    [3, "2026-10-02", "", "", "Semen Padang 40 kg", "", "", "", 149, "zak", 48000, "", ""],
  ]);
  const sheetAlat = aoa("PT. Contoh Alat Berat", "Alat Berat", [
    [1, "2026-10-03", "", "", "Sewa Excavator PC 200 (jam kerja)", "", "", "", 40, "jam", 350000, "Cimanggis 2", ""],
  ]);
  const petunjuk = [
    ["PETUNJUK IMPOR INVOICE BMS"],
    [],
    ["1. Satu sheet = satu invoice untuk satu customer. Nama sheet bebas."],
    ["2. Bagian atas (Customer, Divisi, Tanggal Invoice, ...) diisi di kolom B. Customer harus sama/mirip dengan master Customer; kalau tidak cocok, dipilih manual saat preview."],
    ["3. Kolom wajib: Jumlah (atau P-L-T lengkap, Jumlah otomatis = P x L x T dalam m3) dan Harga Satuan. Kolom lain boleh dikosongkan."],
    ["4. No Surat Jalan: kalau diisi & SJ-nya sudah ada di sistem, baris ditautkan ke SJ itu. Kalau kosong / belum ada, Surat Jalan dibuatkan otomatis."],
    ["5. Harga Satuan kosong -> dicari otomatis dari harga customer; kalau tidak ada, jadi 0 dan bisa diubah di detail invoice."],
    ["6. Tanggal kosong = ikut tanggal baris di atasnya. Kolom Total hanya untuk dilihat (dihitung ulang oleh sistem)."],
    ["7. Baris judul seksi (mis. PASIR PASANG) boleh disisipkan kalau kolom Jenis Barang dikosongkan."],
    ["8. Hanya blok tabel pertama dalam satu sheet yang dibaca."],
  ];

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(sheetMaterial);
  const ws2 = XLSX.utils.aoa_to_sheet(sheetAlat);
  const ws0 = XLSX.utils.aoa_to_sheet(petunjuk);
  for (const ws of [ws1, ws2]) {
    ws["!cols"] = [{ wch: 4 }, { wch: 12 }, { wch: 15 }, { wch: 13 }, { wch: 30 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 9 }, { wch: 8 }, { wch: 14 }, { wch: 24 }, { wch: 14 }];
    // kolom Total berisi rumus supaya enak dilihat saat mengisi
    for (let r = 8; r <= 12; r++) {
      if (ws[`A${r}`]) ws[`M${r}`] = { t: "n", f: `IF(I${r}<>"",I${r},F${r}*G${r}*H${r})*K${r}` };
    }
  }
  ws0["!cols"] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, ws0, "Petunjuk");
  XLSX.utils.book_append_sheet(wb, ws1, "Contoh Material");
  XLSX.utils.book_append_sheet(wb, ws2, "Contoh Alat Berat");
  XLSX.writeFile(wb, "Template_Import_Invoice_BMS.xlsx");
}
