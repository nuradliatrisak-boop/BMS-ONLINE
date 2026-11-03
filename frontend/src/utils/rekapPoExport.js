// REKAP PO PROYEK (cetak PDF & Excel) -- format seperti "Rekap PO Cimanggis Masuk-Keluar":
//   kiri  = PO material MASUK (tgl PO, no PO, alamat, material, jumlah PO)
//   kanan = PO material KELUAR (no. invoice, tgl kirim, material, jumlah keluar, sisa PO berjalan)
// + total, total per material, dan catatan. Pengiriman tanpa PO (penampung "TANPA PO") ikut dihitung.
// Data dibaca dari PO di menu Purchase Order (items + pengiriman), tidak ada data yang disalin.
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { loadImageDataUrl, drawWatermark, KOP_SURAT_URL, LOGO_WATERMARK_URL } from "./pdfExport.js";

const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const BLN_PANJANG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const slug = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const n2 = (x) => r2(x).toLocaleString("id-ID", { maximumFractionDigits: 2 });
const hariIni = () => new Date().toLocaleDateString("en-CA");
const tglStr = (v) => String(v || "").slice(0, 10);

const adaTanpaPo = (po) => key(po.no).startsWith("tanpapo");
const jenisKend = (u) => (/tronton/i.test(u) ? "TR" : /colt|diesel/i.test(u) ? "CD" : "");
const alamatRapi = (s) => String(s || "").replace(/\s+(Jakarta (Timur|Barat|Utara|Selatan|Pusat))$/i, ", $1");

function dmy(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
const dd = (x) => String(x.d).padStart(2, "0");
export function fmtTgl(v) {
  const t = dmy(v);
  return t ? `${dd(t)} ${BLN[t.m - 1]} ${t.y}` : "-";
}
function fmtRentang(tgls) {
  const u = [...new Set(tgls.map(tglStr))].sort();
  if (!u.length) return "-";
  if (u.length === 1) return fmtTgl(u[0]);
  const a = dmy(u[0]);
  const b = dmy(u[u.length - 1]);
  if (a.y === b.y && a.m === b.m) return `${dd(a)}-${dd(b)} ${BLN[a.m - 1]} ${a.y}`;
  if (a.y === b.y) return `${dd(a)} ${BLN[a.m - 1]} - ${dd(b)} ${BLN[b.m - 1]} ${a.y}`;
  return `${fmtTgl(u[0])} - ${fmtTgl(u[u.length - 1])}`;
}
function fmtTglPanjang(v) {
  const t = dmy(v);
  return t ? `${t.d} ${BLN_PANJANG[t.m - 1]} ${t.y}` : "-";
}

// "Batu Belah Uk.10-20cm (Tronton)" -> "Batu Belah 10-20 cm (Tronton)"
const tampilNama = (u) =>
  String(u || "")
    .replace(/\bUk\.?\s*(?=\d)/gi, "")
    .replace(/(\d+)\s*-\s*(\d+)\s*cm/gi, "$1-$2 cm")
    .replace(/\s+/g, " ")
    .trim();
// kunci material untuk "Total per material" (Colt Diesel + Tronton digabung)
function materialKey(u) {
  let m = tampilNama(String(u || "").replace(/\(.*?\)/g, " ")).trim();
  const w = /^(makadam|sirtu|split)/i.exec(m);
  if (w) m = w[1][0].toUpperCase() + w[1].slice(1).toLowerCase();
  return m;
}
const URUTAN_MATERIAL = ["Pasir Pasang", "Pasir Urug", "Split", "Sirtu", "Batu Belah 10-20 cm", "Makadam"];

// Kelompok proyek = customer + lokasi proyek, hanya PO material (divisi Supplier) yang tidak dibatalkan.
export function kelompokProyekPo(list) {
  const map = new Map();
  for (const p of list || []) {
    if (p.batal || p.divisi !== "Supplier") continue;
    const customer = p.namaCustomerTampil || p.namaCustomer || "";
    const lokasi = p.lokasiProyek || p.proyek || "";
    const k = key(customer) + "|" + key(lokasi);
    if (!map.has(k)) map.set(k, { key: k, customer, lokasi, jumlahPo: 0, ids: [] });
    const g = map.get(k);
    g.ids.push(p.id);
    if (!adaTanpaPo(p)) g.jumlahPo++;
  }
  return [...map.values()].filter((g) => g.jumlahPo > 0).sort((a, b) => b.jumlahPo - a.jumlahPo || a.customer.localeCompare(b.customer));
}

export function susunRekapPo(poList, { posisi, catatanTambahan } = {}) {
  const batas = tglStr(posisi) || hariIni();
  // urut tgl PO; penampung "TANPA PO" selalu paling bawah
  const pos = [...poList].sort(
    (a, b) =>
      Number(adaTanpaPo(a)) - Number(adaTanpaPo(b)) ||
      String(a.tanggal).localeCompare(String(b.tanggal)) ||
      String(a.no).localeCompare(String(b.no), undefined, { numeric: true })
  );
  const baris = [];
  const mat = new Map();
  const matDari = (u) => {
    const k = materialKey(u);
    if (!mat.has(k)) mat.set(k, { nama: k, po: 0, terkirim: 0, lebih: 0, sisa: 0, tanpa: 0 });
    return mat.get(k);
  };
  const poLebih = [];

  for (const po of pos) {
    const tanpa = adaTanpaPo(po);
    const kirimPo = (po.pengiriman || []).filter((k) => tglStr(k.tanggal) <= batas);
    const awalPo = baris.length;
    let ada = false;
    for (const it of po.items || []) {
      const kirim = kirimPo
        .filter((k) => k.itemId === it.id)
        .sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
      const grup = [];
      for (const k of kirim) {
        const m = /OA\s*0*(\d+)/i.exec(String(k.catatan || ""));
        const inv = m ? "OA " + String(m[1]).padStart(3, "0") : "SJ";
        let g = grup.find((x) => x.inv === inv);
        if (!g) grup.push((g = { inv, tgls: [], qty: 0 }));
        g.tgls.push(tglStr(k.tanggal));
        g.qty += Number(k.qty) || 0;
      }
      grup.sort((a, b) => a.tgls[0].localeCompare(b.tgls[0]));
      const total = grup.reduce((s, g) => s + g.qty, 0);
      const m = matDari(it.uraian);
      if (tanpa) {
        m.terkirim += total;
        m.tanpa += total;
      } else {
        m.po += it.qty;
        m.terkirim += total;
        m.lebih += Math.max(total - it.qty, 0);
        m.sisa += Math.max(it.qty - total, 0);
        if (total - it.qty > 0.005 && !poLebih.includes(po.no)) poLebih.push(po.no);
      }
      const nama = tampilNama(it.uraian);
      const jenis = jenisKend(it.uraian);
      const awalItem = baris.length;
      if (!grup.length) {
        baris.push({ invoice: "belum ada pengiriman", tglKirim: "-", keluar: null, sisaTeks: tanpa ? "-" : n2(it.qty), sisa: tanpa ? null : r2(it.qty), lebih: 0 });
      } else {
        let cum = 0;
        for (const g of grup) {
          cum += g.qty;
          const lebih = cum > it.qty + 0.005 ? r2(cum - it.qty) : 0;
          const sisa = tanpa ? null : r2(Math.max(it.qty - cum, 0));
          baris.push({
            invoice: g.inv,
            tglKirim: fmtRentang(g.tgls),
            keluar: g.qty,
            sisa,
            lebih: tanpa ? 0 : lebih,
            sisaTeks: tanpa ? "-" : lebih ? `0 (lebih ${n2(lebih)})` : n2(sisa),
          });
        }
      }
      for (let i = awalItem; i < baris.length; i++) {
        Object.assign(baris[i], {
          tanpaPo: tanpa, materialKeluar: nama, jenis,
          pertamaItem: i === awalItem, spanItem: baris.length - awalItem,
          materialPo: nama, jumlahPo: tanpa ? "-" : it.qty,
        });
      }
      ada = true;
    }
    if (ada) {
      for (let i = awalPo; i < baris.length; i++) {
        Object.assign(baris[i], {
          pertamaPo: i === awalPo, spanPo: baris.length - awalPo,
          tglPo: tanpa ? "-" : fmtTgl(po.tanggal),
          noPo: tanpa ? "Tanpa PO" : po.no,
          alamat: alamatRapi(po.lokasiProyek || po.proyek || ""),
        });
      }
    }
  }

  const ringkas = [...mat.values()]
    .map((m) => ({ ...m, sisa: r2(Math.max(m.sisa - m.tanpa, 0)), lebih: r2(m.lebih), po: r2(m.po), terkirim: r2(m.terkirim) }))
    .sort((a, b) => {
      const ia = URUTAN_MATERIAL.indexOf(a.nama), ib = URUTAN_MATERIAL.indexOf(b.nama);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.nama.localeCompare(b.nama);
    });
  const sum = (f) => ringkas.reduce((s, m) => s + f(m), 0);
  const jumlahPo = pos.filter((p) => !adaTanpaPo(p)).length;
  const tanpaMat = ringkas.filter((m) => m.tanpa > 0);
  const p0 = pos[0] || {};
  const customer = p0.namaCustomerTampil || p0.namaCustomer || "";
  const lokasi = p0.lokasiProyek || p0.proyek || "";

  const catatan = ["Biru = Colt Diesel, oranye = Tronton. Ringkasan material menggabungkan keduanya."];
  for (const m of tanpaMat) catatan.push(`${m.nama} tanpa PO (${n2(m.tanpa)} m3) sudah dijumlahkan ke total terkirim dan ke ${m.nama.toLowerCase()}.`);
  if (poLebih.length) {
    const nomor = poLebih.map((n) => String(n).split("/")[0].replace(/^0+/, ""));
    const teks = nomor.length > 1 ? nomor.slice(0, -1).join(", ") + " dan " + nomor[nomor.length - 1] : nomor[0];
    catatan.push(`PO ${teks} terkirim melebihi pesanan: sisa dihitung 0, kelebihannya di kolom Lebih kirim.`);
  }
  String(catatanTambahan || "").split("\n").map((s) => s.trim()).filter(Boolean).forEach((s) => catatan.push(s));

  return {
    judul: `REKAP PO PROYEK ${lokasi} - ${customer}`.toUpperCase(),
    posisi: fmtTglPanjang(batas),
    jumlahPo,
    baris,
    labelTotal: `TOTAL (${jumlahPo} PO${tanpaMat.length ? " + " + tanpaMat.map((m) => m.nama.toLowerCase()).join(", ") + " tanpa PO" : ""})`,
    totalPo: sum((m) => m.po),
    totalKeluar: sum((m) => m.terkirim),
    totalSisa: sum((m) => m.sisa),
    totalLebih: sum((m) => m.lebih),
    ringkas,
    catatan,
  };
}

const namaFile = (r, ext) => `rekap-po-${slug(r.judul.replace(/^REKAP PO PROYEK /, "")).slice(0, 60)}.${ext}`;
const KET = "Kiri = PO material masuk (pesanan). Kanan = PO material keluar (pengiriman per invoice, sisa PO dihitung berjalan).";

// ============ EXCEL ============
export function exportRekapPoExcel(r) {
  const aoa = [[r.judul], [`Posisi data: ${r.posisi}. ${KET}`], [], ["PO MATERIAL MASUK", "", "", "", "", "PO MATERIAL KELUAR"]];
  aoa.push(["Tgl PO", "No. PO", "Alamat kirim", "Nama material", "Jumlah PO (m3)", "No. invoice", "Tgl kirim", "Nama material", "Jumlah keluar (m3)", "Sisa PO (m3)", "Lebih kirim (m3)"]);
  for (const b of r.baris) {
    aoa.push([
      b.pertamaPo ? b.tglPo : "", b.pertamaPo ? b.noPo : "", b.pertamaPo ? b.alamat : "",
      b.pertamaItem ? b.materialPo : "", b.pertamaItem ? b.jumlahPo : "",
      b.invoice, b.tglKirim, b.keluar == null ? "" : b.materialKeluar, b.keluar == null ? "" : r2(b.keluar),
      b.sisa == null ? "-" : b.sisa, b.lebih || "",
    ]);
  }
  aoa.push([r.labelTotal, "", "", "", r.totalPo, "", "", "", r2(r.totalKeluar), r2(r.totalSisa), r2(r.totalLebih) || ""]);
  const totRow = aoa.length - 1;
  aoa.push([], ["Total per material"], ["Material", "Jumlah PO (m3)", "PO terkirim (m3)", "Lebih kirim (m3)", "Sisa PO (m3)"]);
  for (const m of r.ringkas) aoa.push([m.nama, m.po, m.terkirim, m.lebih || "-", m.sisa]);
  aoa.push(["TOTAL", r.totalPo, r2(r.totalKeluar), r.totalLebih || "-", r2(r.totalSisa)]);
  aoa.push([], ["Catatan"], ...r.catatan.map((c) => ["- " + c]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 14 }, { wch: 36 }, { wch: 36 }, { wch: 32 }, { wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 32 }, { wch: 18 }, { wch: 14 }, { wch: 15 }];
  ws["!merges"] = [
    { s: { r: 3, c: 0 }, e: { r: 3, c: 4 } }, { s: { r: 3, c: 5 }, e: { r: 3, c: 10 } },
    { s: { r: totRow, c: 0 }, e: { r: totRow, c: 3 } },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rekap PO");
  XLSX.writeFile(wb, namaFile(r, "xlsx"));
}

// ============ PDF (A4 landscape) ============
const WARNA = { CD: [31, 78, 160], TR: [196, 98, 16] };

export async function exportRekapPoPdf(r) {
  const [, logoImg] = await Promise.all([loadImageDataUrl(KOP_SURAT_URL), loadImageDataUrl(LOGO_WATERMARK_URL)]);
  const kopImg = await loadImageDataUrl(KOP_SURAT_URL);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const margin = 10;
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const sudahWm = new Set();
  const wm = () => {
    const n = doc.internal.getCurrentPageInfo().pageNumber;
    if (sudahWm.has(n)) return;
    sudahWm.add(n);
    drawWatermark(doc, logoImg);
  };

  // kop surat diperkecil & ditengahkan supaya kertas landscape muat lebih banyak baris
  const kopW = 150;
  const kopH = kopW * (382 / 1568);
  wm();
  doc.addImage(kopImg, "JPEG", (pw - kopW) / 2, margin - 4, kopW, kopH);
  let y = margin - 4 + kopH + 4;
  doc.setFont(undefined, "bold"); doc.setFontSize(11);
  doc.text(r.judul, pw / 2, y, { align: "center", maxWidth: pw - margin * 2 });
  y += 5;
  doc.setFont(undefined, "normal"); doc.setFontSize(7.5);
  doc.text(`Posisi data: ${r.posisi}. ${KET}`, pw / 2, y, { align: "center", maxWidth: pw - margin * 2 });
  y += 3.5;

  const sel = (content, extra = {}, rowSpan) => ({ content, ...(rowSpan > 1 ? { rowSpan } : {}), ...extra });
  const body = r.baris.map((b) => {
    const warna = WARNA[b.jenis] ? { textColor: WARNA[b.jenis] } : {};
    const row = [];
    if (b.pertamaPo) {
      row.push(sel(b.tglPo, { valign: "top" }, b.spanPo), sel(b.noPo, { valign: "top" }, b.spanPo), sel(b.alamat, { valign: "top" }, b.spanPo));
    }
    if (b.pertamaItem) {
      row.push(sel(b.materialPo, { ...warna, valign: "top" }, b.spanItem), sel(String(b.jumlahPo === "-" ? "-" : n2(b.jumlahPo)), { halign: "right", valign: "top" }, b.spanItem));
    }
    row.push(
      b.invoice,
      b.tglKirim,
      b.keluar == null ? "" : { content: b.materialKeluar, styles: warna },
      { content: b.keluar == null ? "-" : n2(b.keluar), styles: { halign: "right" } },
      { content: b.sisaTeks, styles: { halign: "right" } }
    );
    return row;
  });
  const th = { halign: "center", fontStyle: "bold" };
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, top: margin },
    head: [
      [{ content: "PO MATERIAL MASUK", colSpan: 5, styles: { ...th, fillColor: [221, 235, 247] } }, { content: "PO MATERIAL KELUAR", colSpan: 5, styles: { ...th, fillColor: [226, 239, 218] } }],
      ["Tgl PO", "No. PO", "Alamat kirim", "Nama material", { content: "Jumlah PO (m3)", styles: { halign: "right" } }, "No. invoice", "Tgl kirim", "Nama material", { content: "Jumlah keluar (m3)", styles: { halign: "right" } }, { content: "Sisa PO (m3)", styles: { halign: "right" } }],
    ],
    body,
    foot: [[{ content: r.labelTotal, colSpan: 4 }, { content: n2(r.totalPo), styles: { halign: "right" } }, { content: "", colSpan: 3 }, { content: n2(r.totalKeluar), styles: { halign: "right" } }, { content: n2(r.totalSisa), styles: { halign: "right" } }]],
    showFoot: "lastPage",
    theme: "grid",
    styles: { fontSize: 7, cellPadding: 1.1, lineColor: [190, 190, 190], lineWidth: 0.1, textColor: 20, overflow: "linebreak" },
    headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold", halign: "left" },
    footStyles: { fillColor: [250, 250, 250], textColor: 20, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 40 }, 2: { cellWidth: 30 }, 3: { cellWidth: 38 }, 4: { cellWidth: 14 }, 5: { cellWidth: 17 }, 6: { cellWidth: 29 }, 7: { cellWidth: 37 }, 8: { cellWidth: 21 }, 9: { cellWidth: 28 } },
    willDrawPage: wm,
  });

  y = doc.lastAutoTable.finalY + 6;
  if (y > ph - 55) { doc.addPage(); wm(); y = margin; }
  doc.setFont(undefined, "bold"); doc.setFontSize(9);
  doc.text("Total per material", margin, y);
  autoTable(doc, {
    startY: y + 2,
    margin: { left: margin, right: pw - margin - 150, top: margin },
    head: [["Material", ...["Jumlah PO (m3)", "PO terkirim (m3)", "Lebih kirim (m3)", "Sisa PO (m3)"].map((c) => ({ content: c, styles: { halign: "right" } }))]],
    body: r.ringkas.map((m) => [m.nama, ...[n2(m.po), n2(m.terkirim), m.lebih ? n2(m.lebih) : "-", n2(m.sisa)].map((c) => ({ content: c, styles: { halign: "right" } }))]),
    foot: [["TOTAL", ...[n2(r.totalPo), n2(r.totalKeluar), r.totalLebih ? n2(r.totalLebih) : "-", n2(r.totalSisa)].map((c) => ({ content: c, styles: { halign: "right" } }))]],
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.3, lineColor: [190, 190, 190], lineWidth: 0.1, textColor: 20 },
    headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
    footStyles: { fillColor: [250, 250, 250], textColor: 20, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 46 } },
    willDrawPage: wm,
  });

  y = doc.lastAutoTable.finalY + 6;
  if (y > ph - 12 - r.catatan.length * 4.5) { doc.addPage(); wm(); y = margin + 2; }
  doc.setFont(undefined, "bold"); doc.setFontSize(9);
  doc.text("Catatan", margin, y);
  doc.setFont(undefined, "normal"); doc.setFontSize(8);
  y += 4.5;
  for (const c of r.catatan) {
    const lines = doc.splitTextToSize("- " + c, pw - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 4;
  }
  doc.save(namaFile(r, "pdf"));
}
