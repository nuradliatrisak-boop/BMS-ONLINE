// Menyusun DRAFT invoice dari halaman-halaman hasil bacaan (AI dari PDF/foto, atau Excel rekapan).
// Halaman: { jenis: "REKAP"|"INVOICE", customer, noRekap, noInvoice, tanggal, proyek, baris, totalKertas, ragu }
//   REKAP   -> baris: [{ noInvoice, tanggal, deskripsi, jumlahTagihan, tglPembayaran, jumlahPembayaran }]
//   INVOICE -> baris: [{ tanggal, noSj, kapal, keterangan, qty, satuan, harga, jumlah }]
// Invoice dipasangkan dengan baris rekap lewat nomor invoice -> dapat No. Rekapan + pembayaran.
// Invoice yang hanya ada di rekap (halaman detailnya tidak ada) dibuat dengan 1 baris "deskripsi" senilai tagihan.
import { keAngka, keTanggal } from "./rekapBlokParser.js";

const kunci = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const num = (v) => (typeof v === "number" ? v : keAngka(v));
let urut = 0;

export function bangunDraft(halaman, divisiDefault = "Kontraktor") {
  const rekapBaris = new Map(); // kunci(noInvoice) -> { baris, rekap }
  for (const h of halaman.filter((x) => x.jenis === "REKAP")) {
    for (const b of h.baris || []) {
      if (kunci(b.noInvoice)) rekapBaris.set(kunci(b.noInvoice), { b, rekap: h });
    }
  }
  const drafts = [];
  const terpakai = new Set();

  for (const h of halaman.filter((x) => x.jenis === "INVOICE")) {
    const noInv = String(h.noInvoice || "").trim();
    const r = rekapBaris.get(kunci(noInv));
    if (r) terpakai.add(kunci(noInv));
    const items = (h.baris || [])
      .filter((b) => num(b.qty) > 0)
      .map((b) => ({
        keterangan: [b.keterangan, b.kapal ? `- ${b.kapal}` : "", b.noSj ? `(SJ ${b.noSj})` : ""].filter(Boolean).join(" ").trim() || "Jasa",
        tglPakai: keTanggal(b.tanggal),
        qty: num(b.qty),
        satuan: b.satuan || "",
        hargaSatuan: num(b.harga) || (num(b.qty) ? num(b.jumlah) / num(b.qty) : 0),
      }));
    const bayar = r && num(r.b.jumlahPembayaran) > 0 ? [{ tanggal: keTanggal(r.b.tglPembayaran) || keTanggal(h.tanggal), nominal: num(r.b.jumlahPembayaran), metode: "" }] : [];
    drafts.push({
      id: `d${++urut}`, pakai: true, no: noInv, noRekap: h.noRekap || r?.rekap.noRekap || "", tanggal: keTanggal(h.tanggal) || keTanggal(r?.b.tanggal),
      divisi: divisiDefault, namaCustomer: h.customer || r?.rekap.customer || "", customerId: "", proyekNama: h.proyek || "",
      totalKertas: num(h.totalKertas) || num(r?.b.jumlahTagihan) || 0, items, pembayaran: bayar, soloRekap: false, ragu: h.ragu || [],
    });
  }
  for (const [k, { b, rekap }] of rekapBaris) {
    if (terpakai.has(k)) continue;
    const tagihan = num(b.jumlahTagihan);
    drafts.push({
      id: `d${++urut}`, pakai: true, no: String(b.noInvoice || "").trim(), noRekap: rekap.noRekap || "", tanggal: keTanggal(b.tanggal) || keTanggal(rekap.tanggal),
      divisi: divisiDefault, namaCustomer: rekap.customer || "", customerId: "", proyekNama: "", totalKertas: tagihan,
      items: [{ keterangan: String(b.deskripsi || "Tagihan").trim() || "Tagihan", tglPakai: "", qty: 1, satuan: "", hargaSatuan: tagihan }],
      pembayaran: num(b.jumlahPembayaran) > 0 ? [{ tanggal: keTanggal(b.tglPembayaran) || keTanggal(b.tanggal), nominal: num(b.jumlahPembayaran), metode: "" }] : [],
      soloRekap: true, ragu: rekap.ragu || [],
    });
  }
  return drafts;
}

// Baca file Excel rekapan (tabel: No | Tanggal | No Invoice | Deskripsi | Jumlah Tagihan | Tgl Pembayaran | Jumlah Pembayaran)
// -> halaman REKAP (satu per sheet yang cocok). aoa = array-of-arrays satu sheet.
export function halamanRekapDariAoa(aoa) {
  const kecil = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const nilai = (row, j0) => {
    for (let j = j0 + 1; j < Math.min(row.length, j0 + 6); j++) {
      const c = row[j];
      if (c !== null && c !== undefined && String(c).trim() !== "") return String(c).replace(/^\s*:\s*/, "").trim();
    }
    return "";
  };
  const h = { jenis: "REKAP", customer: "", noRekap: "", tanggal: "", baris: [], totalKertas: 0, ragu: [] };
  let kol = null;
  for (const row of aoa) {
    const r = row || [];
    if (!kol) {
      r.forEach((c, j) => {
        const k = kecil(c);
        if (/^rekapan invoi/.test(k)) h.customer = nilai(r, j) || h.customer;
        else if (k === "no.rekapan" || k === "no. rekapan" || k === "no rekapan") h.noRekap = nilai(r, j);
        else if (k === "tanggal" && !r.some((x) => /invoice/.test(kecil(x)))) h.tanggal = keTanggal(nilai(r, j)) || h.tanggal;
      });
      const ks = r.map(kecil);
      if (ks.some((k) => /no\.?\s*invoice/.test(k)) && ks.some((k) => /jumlah tagihan/.test(k))) {
        kol = {};
        ks.forEach((k, j) => {
          if (k === "tanggal") kol.tanggal = j;
          else if (/no\.?\s*invoice/.test(k)) kol.noInvoice = j;
          else if (k === "deskripsi" || k === "keterangan") kol.deskripsi = j;
          else if (/jumlah tagihan/.test(k)) kol.tagihan = j;
          else if (/tgl.*pembayaran|tanggal.*pembayaran/.test(k)) kol.tglBayar = j;
          else if (/jumlah pembayaran/.test(k)) kol.bayar = j;
        });
      }
      continue;
    }
    const k0 = kecil(r[0]);
    if (k0.startsWith("total")) { h.totalKertas = keAngka(r[kol.tagihan]); break; }
    const noInv = String(r[kol.noInvoice] ?? "").trim();
    if (!noInv) continue;
    h.baris.push({ noInvoice: noInv, tanggal: keTanggal(r[kol.tanggal]), deskripsi: String(r[kol.deskripsi] ?? "").trim(), jumlahTagihan: keAngka(r[kol.tagihan]), tglPembayaran: keTanggal(r[kol.tglBayar]), jumlahPembayaran: keAngka(r[kol.bayar]) });
  }
  return h.baris.length ? h : null;
}
