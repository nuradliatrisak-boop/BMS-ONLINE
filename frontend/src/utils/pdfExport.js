// ============================================================
// EXPORT PDF -- dipakai oleh halaman "Laporan Divisi" dan
// "Rekap Keseluruhan". Pakai jsPDF + jspdf-autotable supaya hasil
// PDF-nya rapi (tabel asli, bukan hasil screenshot halaman), dengan
// kop surat PT. Bintang Muara Sejati di atas tiap halaman dan logo
// BM sebagai watermark transparan di latar belakang -- gambarnya
// diambil dari /public/letterhead (lihat juga print.js untuk versi
// cetak langsung dari browser).
// ============================================================
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const KOP_SURAT_URL = "/letterhead/kop-surat.jpeg";
const LOGO_WATERMARK_URL = "/letterhead/bm-logo-transparent.png";
const KOP_ASPECT = 382 / 1568; // tinggi/lebar asli file kop-surat.jpg

let _imgCache = {};
async function loadImageDataUrl(url) {
  if (_imgCache[url]) return _imgCache[url];
  const res = await fetch(url);
  const blob = await res.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  _imgCache[url] = dataUrl;
  return dataUrl;
}

function rupiah(n) {
  return "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
}

function fmtDateID(v) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

function drawWatermark(doc, logoImg) {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const size = Math.min(pw, ph) * 0.62;
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.07 }));
  doc.addImage(logoImg, "PNG", (pw - size) / 2, (ph - size) / 2, size, size);
  doc.restoreGraphicsState();
}

function drawKopSurat(doc, kopImg, margin) {
  const pw = doc.internal.pageSize.getWidth();
  const w = pw - margin * 2;
  const h = w * KOP_ASPECT;
  doc.addImage(kopImg, "JPEG", margin, margin - 4, w, h);
  return margin - 4 + h;
}

function drawSectionHeader(doc, { kopImg, logoImg, margin, title, periodLabel }) {
  drawWatermark(doc, logoImg);
  const afterKop = drawKopSurat(doc, kopImg, margin);
  const pw = doc.internal.pageSize.getWidth();
  let y = afterKop + 7;
  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  doc.text(title, pw / 2, y, { align: "center" });
  y += 5.5;
  doc.setFont(undefined, "normal");
  doc.setFontSize(9);
  doc.text(periodLabel, pw / 2, y, { align: "center" });
  return y + 6;
}

function kelompokTable(doc, k, startY, margin) {
  const adaRincian = k.hasQty || k.rows.some((r) => r.subKategori);
  const head = adaRincian ? [["No", "Kategori", "Rincian", "Nominal"]] : [["No", "Kategori", "Nominal"]];
  const body = k.rows.length
    ? k.rows.map((r, i) =>
        adaRincian ? [i + 1, r.kategori, r.subKategori || "-", rupiah(r.nominal)] : [i + 1, r.kategori, rupiah(r.nominal)]
      )
    : [[{ content: "Belum ada data.", colSpan: adaRincian ? 4 : 3, styles: { halign: "center", textColor: 130 } }]];
  const foot = adaRincian
    ? [[{ content: `Total ${k.label}`, colSpan: 3, styles: { fontStyle: "bold" } }, { content: rupiah(k.subtotal), styles: { fontStyle: "bold" } }]]
    : [[{ content: `Total ${k.label}`, colSpan: 2, styles: { fontStyle: "bold" } }, { content: rupiah(k.subtotal), styles: { fontStyle: "bold" } }]];

  doc.setFont(undefined, "bold");
  doc.setFontSize(9.5);
  doc.text(`${k.label}  (${k.tipe === "PENJUALAN" ? "Pendapatan" : "Pengeluaran"})`, margin, startY);

  autoTable(doc, {
    startY: startY + 2,
    margin: { left: margin, right: margin },
    head,
    body,
    foot,
    theme: "grid",
    styles: { fontSize: 8.5, cellPadding: 1.6 },
    headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
    footStyles: { fillColor: [250, 250, 250], textColor: 20 },
    columnStyles: adaRincian
      ? { 0: { cellWidth: 10 }, 3: { halign: "right" } }
      : { 0: { cellWidth: 10 }, 2: { halign: "right" } },
  });
  return doc.lastAutoTable.finalY + 6;
}

function summaryBlock(doc, y, margin, { totalPenjualan, totalPengeluaran, labaBersih }, labelFinal) {
  const pw = doc.internal.pageSize.getWidth();
  const boxW = 85;
  const x0 = pw - margin - boxW;
  doc.setFontSize(9);
  const rows = [
    ["Total Penjualan / Pendapatan", rupiah(totalPenjualan)],
    ["Total Pengeluaran", rupiah(totalPengeluaran)],
    [labelFinal || "Hasil Bersih (Laba / Rugi)", rupiah(labaBersih)],
  ];
  let yy = y;
  rows.forEach(([label, val], i) => {
    const bold = i === rows.length - 1;
    doc.setFont(undefined, bold ? "bold" : "normal");
    doc.setFontSize(bold ? 10 : 9);
    doc.text(label, x0, yy);
    doc.text(val, pw - margin, yy, { align: "right" });
    yy += bold ? 6.5 : 5.5;
    if (!bold) doc.line(x0, yy - 4, pw - margin, yy - 4);
  });
  return yy + 2;
}

// ------------------------------------------------------------
// Laporan Divisi (satu divisi, satu bulan)
// ------------------------------------------------------------
export async function exportLaporanDivisiPdf({ divisi, bulanLabel, laporan }) {
  const [kopImg, logoImg] = await Promise.all([loadImageDataUrl(KOP_SURAT_URL), loadImageDataUrl(LOGO_WATERMARK_URL)]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;

  let y = drawSectionHeader(doc, {
    kopImg,
    logoImg,
    margin,
    title: `LAPORAN LABA RUGI \u2014 DIVISI ${String(divisi).toUpperCase()}`,
    periodLabel: `Bulan ${bulanLabel}`,
  });

  laporan.kelompok.forEach((k) => {
    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage();
      drawWatermark(doc, logoImg);
      y = margin;
    }
    y = kelompokTable(doc, k, y, margin);
  });

  if (y > doc.internal.pageSize.getHeight() - 45) {
    doc.addPage();
    drawWatermark(doc, logoImg);
    y = margin;
  }
  summaryBlock(doc, y + 2, margin, laporan);

  doc.save(`laporan-divisi-${String(divisi).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${bulanLabel.toLowerCase().replace(/\s+/g, "-")}.pdf`);
}

// ------------------------------------------------------------
// Rekap Keseluruhan (bisa beberapa divisi sekaligus + total gabungan)
// ------------------------------------------------------------
export async function exportRekapKeseluruhanPdf(data) {
  if (!data) return;
  const [kopImg, logoImg] = await Promise.all([loadImageDataUrl(KOP_SURAT_URL), loadImageDataUrl(LOGO_WATERMARK_URL)]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  const periodLabel = `Periode ${fmtDateID(data.dari)} \u2013 ${fmtDateID(data.sampai)}`;

  data.divisi.forEach((d, idx) => {
    if (idx > 0) doc.addPage();
    let y = drawSectionHeader(doc, {
      kopImg,
      logoImg,
      margin,
      title: `REKAP LAPORAN \u2014 DIVISI ${d.divisi.toUpperCase()}`,
      periodLabel,
    });
    d.kelompok.forEach((k) => {
      if (y > doc.internal.pageSize.getHeight() - 60) {
        doc.addPage();
        drawWatermark(doc, logoImg);
        y = margin;
      }
      y = kelompokTable(doc, k, y, margin);
    });
    if (y > doc.internal.pageSize.getHeight() - 45) {
      doc.addPage();
      drawWatermark(doc, logoImg);
      y = margin;
    }
    summaryBlock(doc, y + 2, margin, d);
  });

  if (data.divisi.length > 1) {
    doc.addPage();
    let y = drawSectionHeader(doc, {
      kopImg,
      logoImg,
      margin,
      title: "REKAP KESELURUHAN SEMUA DIVISI",
      periodLabel,
    });

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [["Divisi", "Pendapatan", "Pengeluaran", "Hasil Bersih"]],
      body: data.divisi.map((d) => [d.divisi, rupiah(d.totalPenjualan), rupiah(d.totalPengeluaran), rupiah(d.labaBersih)]),
      theme: "grid",
      styles: { fontSize: 8.5, cellPadding: 1.8 },
      headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    });
    y = doc.lastAutoTable.finalY + 8;
    summaryBlock(doc, y, margin, data.grandTotal, "Hasil Bersih Keseluruhan");
  }

  doc.save(`rekap-keseluruhan-${(data.dari || "").slice(0, 10)}_${(data.sampai || "").slice(0, 10)}.pdf`);
}
