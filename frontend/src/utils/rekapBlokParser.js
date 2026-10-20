// Pembaca file Excel "rekapan invoice" yang berisi BANYAK blok dalam 1 sheet (seperti alexander.xls).
// Tiap blok: "Rekapan Invoice : <customer>", Penerima, No. Invoice / No. Rekapan, No PO, Tujuan,
// tabel (No | Tanggal | No Surat Jalan | No Polisi | Jenis Barang | P | L | T | Jumlah | Harga | Total), baris TOTAL.
// MURNI (tanpa DOM/xlsx): menerima array-of-arrays hasil baca sheet.
// Tanggal boleh serial Excel (angka), Date, atau teks (2026-10-12, 12/10/2026, 12-Oct-26).
const BULAN = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, aug: 8, ags: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");
const kecil = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function keTanggal(v) {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return "";
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim().replace(/^[A-Za-z]+,\s*(?=\d)/, ""); // buang nama hari: "Thursday, 15 October 2026"
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/.exec(s);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = /^(\d{1,2})[- ]([A-Za-z]{3,})[- ,]*(\d{2,4})/.exec(s);
  if (m && BULAN[m[2].slice(0, 3).toLowerCase()]) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(BULAN[m[2].slice(0, 3).toLowerCase()])}-${pad(m[1])}`;
  return "";
}

export function keAngka(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", ".")) || 0;
  return Number(s.replace(/,/g, ".")) || 0;
}

const nilaiLabel = (row) => {
  for (let j = 1; j < Math.min(row.length, 6); j++) {
    const c = row[j];
    if (c !== null && c !== undefined && String(c).trim() !== "") return String(c).replace(/^\s*:\s*/, "").trim();
  }
  return "";
};

// Hasil: [{ id, barisAwal, customer, penerima, noInvoice, noRekap, noPo, tujuan, tanggalRekap, rows, totalKertas, layout }]
export function parseBlokRekap(aoa) {
  const bloks = [];
  let b = null;
  let kolom = null;
  const tutup = () => { if (b) bloks.push(b); b = null; kolom = null; };

  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const c0 = kecil(row[0]);

    if (c0.startsWith("rekapan invoice")) {
      tutup();
      b = { id: `b${bloks.length + 1}`, barisAwal: i + 1, customer: nilaiLabel(row), penerima: "", noInvoice: "", noRekap: "", noPo: "", tujuan: "", tanggalRekap: "", rows: [], totalKertas: 0, layout: "MATERIAL" };
      continue;
    }
    if (!b) continue;

    if (!kolom) {
      if (c0 === "penerima") b.penerima = nilaiLabel(row);
      else if (c0 === "no. invoice" || c0 === "no invoice") b.noInvoice = nilaiLabel(row);
      else if (c0 === "no. rekapan" || c0 === "no rekapan") b.noRekap = nilaiLabel(row);
      else if (c0 === "no po" || c0 === "no. po") b.noPo = nilaiLabel(row);
      else if (c0 === "tujuan") b.tujuan = nilaiLabel(row);
      else if (c0 === "no" && row.some((c) => kecil(c) === "tanggal")) {
        kolom = {};
        row.forEach((c, j) => {
          const k = kecil(c);
          if (k === "tanggal") kolom.tanggal = j;
          else if (k === "no surat jalan" || k === "no sj" || k === "no. surat jalan") kolom.noSj = j;
          else if (k === "no polisi" || k === "nopol") kolom.noPolisi = j;
          else if (k === "jenis barang" || k === "barang") kolom.jenis = j;
          else if (k === "p") kolom.p = j;
          else if (k === "l") kolom.l = j;
          else if (k === "t") kolom.t = j;
          else if (k === "jumlah" || k === "qty") kolom.qty = j;
          else if (k === "harga") kolom.harga = j;
          else if (k === "total") kolom.total = j;
        });
      }
      continue;
    }

    // Tabel berkolom lain (mis. sewa alat berat: "Lama", "Jenis Pemakaian", "Harga / jam") bukan rekap
    // pengiriman material -> ditandai, barisnya tidak dibaca.
    if (kolom.jenis === undefined) { b.layout = "LAIN"; continue; }

    if (!kolom.selesai && (kecil(row[0]) === "total" || kecil(row[1]) === "total")) {
      b.totalKertas = keAngka(row[kolom.total ?? 9]);
      kolom = { ...kolom, selesai: true };
      continue;
    }
    if (kolom.selesai) {
      const teks = row.find((c) => /jakarta|,\s*\d{1,2}\s+[a-z]+\s+\d{4}/i.test(String(c ?? "")));
      if (teks && !b.tanggalRekap) {
        const m = /(\d{1,2})\s*([A-Za-z]+)\s+(\d{4})/.exec(String(teks));
        if (m && BULAN[m[2].slice(0, 3).toLowerCase()]) b.tanggalRekap = `${m[3]}-${pad(BULAN[m[2].slice(0, 3).toLowerCase()])}-${pad(m[1])}`;
      }
      continue;
    }
    if (!row.some((c) => c !== null && c !== undefined && String(c).trim() !== "")) continue;
    const jenis = String(row[kolom.jenis] ?? "").trim();
    if (!jenis && !row[kolom.noSj] && !row[kolom.tanggal]) continue;
    b.rows.push({
      baris: i + 1,
      tanggal: keTanggal(row[kolom.tanggal]),
      noSj: String(row[kolom.noSj] ?? "").trim(),
      noPolisi: String(row[kolom.noPolisi] ?? "").trim(),
      jenis,
      p: keAngka(row[kolom.p]), l: keAngka(row[kolom.l]), t: keAngka(row[kolom.t]),
      qty: keAngka(row[kolom.qty]), harga: keAngka(row[kolom.harga]), total: keAngka(row[kolom.total]),
    });
  }
  tutup();
  return bloks;
}

export function ringkasBlok(b) {
  const kirim = b.rows.filter((r) => r.tanggal && r.qty > 0);
  const tgl = kirim.map((r) => r.tanggal).sort();
  return {
    baris: kirim.length,
    qty: Math.round(kirim.reduce((s, r) => s + r.qty, 0) * 1000) / 1000,
    nilai: kirim.reduce((s, r) => s + (r.total || r.qty * r.harga), 0),
    dari: tgl[0] || "", sampai: tgl[tgl.length - 1] || "",
  };
}

// Baca file stok keluar sederhana (No | Tanggal | No Surat | Qty | Total(sisa) | Upah Kuli), mis. gambar "KUBUS MASIF".
// Baris tanpa tanggal & qty diabaikan (baris "Total sisa" kosong di bawah tabel). Judul di atas tabel dikembalikan
// sebagai { judul: [teks, ...], rows: [{ tanggal, noSurat, qty, sisa, upahKuli }] }.
export function parseStokKeluar(aoa) {
  const judul = [];
  let kol = null;
  const rows = [];
  for (const row of aoa) {
    const r = row || [];
    if (!kol) {
      const ks = r.map(kecil);
      if (ks.includes("tanggal") && (ks.includes("qty") || ks.includes("jumlah"))) {
        kol = {};
        ks.forEach((k, j) => {
          if (k === "tanggal") kol.tanggal = j;
          else if (k === "no surat" || k === "no surat jalan" || k === "no. surat") kol.noSurat = j;
          else if (k === "qty" || k === "jumlah") kol.qty = j;
          else if (k === "total" || k === "total (sisa)" || k === "sisa") kol.sisa = j;
          else if (k.startsWith("upah")) kol.upah = j;
        });
      } else {
        const t = r.find((c) => c !== null && c !== undefined && String(c).trim() !== "");
        if (t !== undefined) judul.push(String(t).trim());
      }
      continue;
    }
    const tanggal = keTanggal(r[kol.tanggal]);
    const qty = keAngka(r[kol.qty]);
    if (!tanggal || !(qty > 0)) continue;
    rows.push({ tanggal, noSurat: String(r[kol.noSurat] ?? "").trim(), qty, sisa: kol.sisa !== undefined ? keAngka(r[kol.sisa]) : null, upahKuli: kol.upah !== undefined ? keAngka(r[kol.upah]) : 0 });
  }
  return { judul, rows };
}
