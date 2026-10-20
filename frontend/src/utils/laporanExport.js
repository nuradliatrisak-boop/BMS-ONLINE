// EXPORT Excel & PDF untuk:
//   1. Kartu stok keluar PO  (No | Tanggal | No Surat | Qty | Total sisa | Upah Kuli)
//   2. Laporan per Customer  (rekap per customer -> rekapan -> invoice -> detail)
// Excel pakai "xlsx", PDF pakai jsPDF + autotable dengan kop surat BMS (sama dengan Laporan Divisi).
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { loadImageDataUrl, drawWatermark, drawKopSurat, KOP_SURAT_URL, LOGO_WATERMARK_URL } from "./pdfExport.js";

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const rp = (n) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
const bulat = (n) => Math.round(Number(n) || 0);
const slug = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const angka = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString("id-ID");

function tglParts(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || "").slice(0, 10));
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3], hari: HARI[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] };
}
export function tglPanjang(v) { const p = tglParts(v); return p ? `${p.hari}, ${p.d} ${BULAN[p.m - 1]} ${p.y}` : "-"; }
export function tglPendek(v) { const p = tglParts(v); return p ? `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}/${p.y}` : "-"; }

function lebarOtomatis(aoa, maks = 50) {
  const w = [];
  aoa.forEach((row) => row.forEach((c, i) => (w[i] = Math.max(w[i] || 8, Math.min(String(c ?? "").length + 2, maks)))));
  return w.map((x) => ({ wch: x }));
}
const namaSheet = (s) => String(s || "Sheet").replace(/[:\\/?*[\]]/g, "-").slice(0, 31);

// ============ 1. KARTU STOK KELUAR PO ============
export function susunKartuStok(po) {
  return po.items.map((it) => {
    const kirim = po.pengiriman.filter((p) => p.itemId === it.id).slice()
      .sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)) || String(a.createdAt).localeCompare(String(b.createdAt)));
    let sisa = it.qty;
    const rows = kirim.map((p, i) => {
      sisa = Math.round((sisa - p.qty) * 1000) / 1000;
      return { no: i + 1, tanggal: p.tanggal, noSurat: p.noSuratJalan || "", qty: p.qty, sisa, upahKuli: Number(p.upahKuli) || 0 };
    });
    return { uraian: it.uraian, satuan: it.satuan || "", qtyPo: it.qty, rows, totalQty: Math.round(kirim.reduce((s, p) => s + p.qty, 0) * 1000) / 1000, totalUpah: rows.reduce((s, r) => s + r.upahKuli, 0), sisaAkhir: sisa };
  });
}

export function exportPoStokExcel(po) {
  const kartu = susunKartuStok(po);
  const customer = po.namaCustomerTampil || "";
  const aoa = [], merges = [], fmtAngka = [], fmtRp = [];
  kartu.forEach((k, idx) => {
    const r0 = aoa.length;
    aoa.push([k.uraian.toUpperCase()], [customer.toUpperCase()], [k.qtyPo], [(po.proyek || po.no).toUpperCase()]);
    for (let i = 0; i < 4; i++) merges.push({ s: { r: r0 + i, c: 0 }, e: { r: r0 + i, c: 5 } });
    fmtAngka.push([r0 + 2, 0]);
    aoa.push(["No", "Tanggal", "No Surat", `Qty${k.satuan ? " (" + k.satuan + ")" : ""}`, "Total (sisa)", "Upah Kuli"]);
    k.rows.forEach((r) => {
      aoa.push([r.no, tglPanjang(r.tanggal), r.noSurat, r.qty, r.sisa, r.upahKuli || ""]);
      fmtAngka.push([aoa.length - 1, 3], [aoa.length - 1, 4]);
      if (r.upahKuli) fmtRp.push([aoa.length - 1, 5]);
    });
    aoa.push(["", "TOTAL", "", k.totalQty, k.sisaAkhir, k.totalUpah]);
    fmtAngka.push([aoa.length - 1, 3], [aoa.length - 1, 4]);
    fmtRp.push([aoa.length - 1, 5]);
    if (idx < kartu.length - 1) aoa.push([], []);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 6 }, { wch: 28 }, { wch: 36 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
  ws["!merges"] = merges;
  for (const [r, c] of fmtAngka) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) ws[a].z = "#,##0.###"; }
  for (const [r, c] of fmtRp) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) ws[a].z = "#,##0"; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, namaSheet(po.proyek || po.no));
  XLSX.writeFile(wb, `stok-po-${slug(po.no)}.xlsx`);
}

export async function exportPoStokPdf(po) {
  const [kopImg, logoImg] = await Promise.all([loadImageDataUrl(KOP_SURAT_URL), loadImageDataUrl(LOGO_WATERMARK_URL)]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  const pw = doc.internal.pageSize.getWidth();
  drawWatermark(doc, logoImg);
  let y = drawKopSurat(doc, kopImg, margin) + 7;
  doc.setFont(undefined, "bold"); doc.setFontSize(11);
  doc.text("KARTU STOK KELUAR PURCHASE ORDER", pw / 2, y, { align: "center" });
  y += 5.5;
  doc.setFont(undefined, "normal"); doc.setFontSize(9);
  doc.text(`PO ${po.no}  \u2022  ${po.namaCustomerTampil || ""}${po.proyek ? "  \u2022  " + po.proyek : ""}`, pw / 2, y, { align: "center" });
  y += 8;
  for (const k of susunKartuStok(po)) {
    if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); drawWatermark(doc, logoImg); y = margin; }
    doc.setFont(undefined, "bold"); doc.setFontSize(10);
    doc.text(`${k.uraian}  \u2014  dipesan ${angka(k.qtyPo)} ${k.satuan}`, margin, y);
    autoTable(doc, {
      startY: y + 2, margin: { left: margin, right: margin },
      head: [["No", "Tanggal", "No Surat", `Qty ${k.satuan}`, "Total (sisa)", "Upah Kuli"]],
      body: k.rows.length ? k.rows.map((r) => [r.no, tglPanjang(r.tanggal), r.noSurat || "-", angka(r.qty), angka(r.sisa), r.upahKuli ? rp(r.upahKuli) : "-"]) : [[{ content: "Belum ada pengiriman.", colSpan: 6, styles: { halign: "center", textColor: 130 } }]],
      foot: [[{ content: "TOTAL", colSpan: 3, styles: { fontStyle: "bold" } }, angka(k.totalQty), angka(k.sisaAkhir), rp(k.totalUpah)]],
      theme: "grid", styles: { fontSize: 8.5, cellPadding: 1.6 },
      headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
      footStyles: { fillColor: [250, 250, 250], textColor: 20, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 10 }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    });
    y = doc.lastAutoTable.finalY + 8;
  }
  doc.save(`stok-po-${slug(po.no)}.pdf`);
}

// ============ 2. LAPORAN PER CUSTOMER ============
// mode "customer" = untuk dikirim ke customer (tagihan, dibayar, sisa saja, TANPA angka internal);
// mode "internal" = lengkap dengan potongan, HPP, upah kuli, diskon, hasil bersih.
function judulPeriode(data) {
  if (data.dari && data.sampai) return `Periode ${tglPendek(data.dari)} s/d ${tglPendek(data.sampai)}`;
  if (data.dari) return `Sejak ${tglPendek(data.dari)}`;
  if (data.sampai) return `Sampai ${tglPendek(data.sampai)}`;
  return "Semua periode";
}
const kolomRingkas = (mode) => mode === "internal"
  ? ["No", "Customer", "Invoice", "Tagihan", "Dibayar", "Sisa", "Potongan", "HPP Proyek", "Upah Kuli", "Diskon", "Hasil Bersih", "%"]
  : ["No", "Customer", "Invoice", "Tagihan", "Dibayar", "Sisa"];
function barisRingkas(r, i, mode) {
  const dasar = [i, r.customer, r.jumlahInvoice, bulat(r.tagihan), bulat(r.dibayar), bulat(r.sisa)];
  return mode === "internal" ? [...dasar, bulat(r.potonganInvoice), bulat(r.hppProyek), bulat(r.upahKuli), bulat(r.diskon), bulat(r.bersih), r.persenBersih] : dasar;
}

export function exportLaporanCustomerExcel(data, mode = "customer") {
  const internal = mode === "internal";
  const wb = XLSX.utils.book_new();
  const ring = [
    ["PT. BINTANG MUARA SEJATI"], [internal ? "LAPORAN PER CUSTOMER (INTERNAL)" : "REKAP TAGIHAN PER CUSTOMER"],
    [judulPeriode(data) + (data.divisi ? ` \u2022 Divisi ${data.divisi}` : "")], [],
    kolomRingkas(mode), ...data.rows.map((r, i) => barisRingkas(r, i + 1, mode)), barisRingkas({ ...data.total, customer: "TOTAL" }, "", mode),
  ];
  const ws = XLSX.utils.aoa_to_sheet(ring);
  ws["!cols"] = lebarOtomatis(ring.slice(4));
  XLSX.utils.book_append_sheet(wb, ws, "Ringkasan");

  const adaDetail = data.rows.some((r) => r.rekap?.some((g) => g.invoices.some((v) => v.items)));
  if (adaDetail) {
    const aoa = [["PT. BINTANG MUARA SEJATI"], ["RINCIAN REKAPAN & INVOICE PER CUSTOMER"], [judulPeriode(data)], []];
    for (const r of data.rows) {
      aoa.push([`CUSTOMER: ${r.customer}`], []);
      for (const g of r.rekap) {
        if (g.noRekap) aoa.push([`Rekapan No. ${g.noRekap}`]);
        aoa.push(["No. Invoice", "Tanggal", "Tagihan", "Pembayaran", "Sisa"]);
        for (const v of g.invoices) aoa.push([v.no, tglPendek(v.tanggal), bulat(v.total), bulat(v.dibayar), bulat(v.sisa)]);
        aoa.push(["TOTAL REKAP", "", bulat(g.tagihan), bulat(g.dibayar), bulat(g.sisa)], []);
        for (const v of g.invoices) {
          aoa.push([`Invoice ${v.no}`], ["Tanggal", "Keterangan", "Qty", "Satuan", "Harga", "Jumlah"]);
          for (const it of v.items || []) aoa.push([tglPendek(it.tglPakai), it.keterangan, it.qty, it.satuan || "", bulat(it.hargaSatuan), bulat(it.jumlah)]);
          aoa.push(["", "Total", "", "", "", bulat(v.total)]);
          for (const p of v.pembayaran || []) aoa.push([tglPendek(p.tanggal), `Pembayaran${p.metode ? " (" + p.metode + ")" : ""}`, "", "", "", bulat(p.nominal)]);
          aoa.push(["", "Sisa tagihan", "", "", "", bulat(v.sisa)], []);
        }
      }
      if (internal) {
        aoa.push(["HASIL BERSIH CUSTOMER"], ["Tagihan", bulat(r.tagihan)], ["Potongan invoice", bulat(r.potonganInvoice)], ["HPP proyek (bersih)", bulat(r.hppProyek)], ["Upah kuli", bulat(r.upahKuli)], ["Diskon", bulat(r.diskon)], ["HASIL BERSIH", bulat(r.bersih)], []);
      }
      aoa.push([]);
    }
    const w2 = XLSX.utils.aoa_to_sheet(aoa);
    w2["!cols"] = [{ wch: 22 }, { wch: 52 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, w2, "Rincian");
  }
  XLSX.writeFile(wb, `laporan-customer-${internal ? "internal" : "tagihan"}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function exportLaporanCustomerPdf(data, mode = "customer") {
  const internal = mode === "internal";
  const [kopImg, logoImg] = await Promise.all([loadImageDataUrl(KOP_SURAT_URL), loadImageDataUrl(LOGO_WATERMARK_URL)]);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: internal ? "landscape" : "portrait" });
  const margin = 12;
  const pw = () => doc.internal.pageSize.getWidth();
  const ph = () => doc.internal.pageSize.getHeight();
  const halamanBaru = () => { doc.addPage(); drawWatermark(doc, logoImg); return margin; };

  drawWatermark(doc, logoImg);
  let y = drawKopSurat(doc, kopImg, margin) + 7;
  doc.setFont(undefined, "bold"); doc.setFontSize(11);
  doc.text(internal ? "LAPORAN PER CUSTOMER (INTERNAL)" : "REKAP TAGIHAN PER CUSTOMER", pw() / 2, y, { align: "center" });
  y += 5.5;
  doc.setFont(undefined, "normal"); doc.setFontSize(9);
  doc.text(judulPeriode(data) + (data.divisi ? ` \u2022 Divisi ${data.divisi}` : ""), pw() / 2, y, { align: "center" });
  y += 6;

  const num = (n) => Math.round(Number(n) || 0).toLocaleString("id-ID");
  const fmt = (c, j) => (j >= 3 && typeof c === "number" && !(internal && j === 11) ? num(c) : c);
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin }, head: [kolomRingkas(mode)],
    body: data.rows.map((r, i) => barisRingkas(r, i + 1, mode).map(fmt)),
    foot: [barisRingkas({ ...data.total, customer: "TOTAL" }, "", mode).map(fmt)],
    theme: "grid", styles: { fontSize: internal ? 7.5 : 8.5, cellPadding: 1.5 },
    headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold", halign: "center" },
    footStyles: { fillColor: [250, 250, 250], textColor: 20, fontStyle: "bold" },
    columnStyles: Object.fromEntries([[0, { cellWidth: 8 }], [2, { halign: "center", cellWidth: 14 }], ...Array.from({ length: 10 }, (_, k) => [k + 3, { halign: "right" }])]),
  });
  y = doc.lastAutoTable.finalY + 8;

  for (const r of data.rows) {
    if (!r.rekap?.some((g) => g.invoices.some((v) => v.items))) continue;
    y = halamanBaru();
    doc.setFont(undefined, "bold"); doc.setFontSize(11);
    doc.text(r.customer, margin, y + 2);
    y += 7;
    for (const g of r.rekap) {
      if (y > ph() - 50) y = halamanBaru();
      doc.setFontSize(9.5);
      doc.text(g.noRekap ? `Rekapan No. ${g.noRekap}` : "Invoice (tanpa nomor rekapan)", margin, y);
      autoTable(doc, {
        startY: y + 2, margin: { left: margin, right: margin },
        head: [["No. Invoice", "Tanggal", "Tagihan", "Pembayaran", "Sisa"]],
        body: g.invoices.map((v) => [v.no, tglPendek(v.tanggal), rp(v.total), rp(v.dibayar), rp(v.sisa)]),
        foot: [[{ content: "TOTAL REKAP", colSpan: 2 }, rp(g.tagihan), rp(g.dibayar), rp(g.sisa)]],
        theme: "grid", styles: { fontSize: 8.5, cellPadding: 1.5 },
        headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: "bold" },
        footStyles: { fillColor: [250, 250, 250], textColor: 20, fontStyle: "bold" },
        columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
      });
      y = doc.lastAutoTable.finalY + 6;
      for (const v of g.invoices) {
        if (y > ph() - 55) y = halamanBaru();
        doc.setFont(undefined, "bold"); doc.setFontSize(9);
        doc.text(`Invoice ${v.no} \u2022 ${tglPendek(v.tanggal)}`, margin, y);
        autoTable(doc, {
          startY: y + 2, margin: { left: margin, right: margin },
          head: [["Tanggal", "Keterangan", "Qty", "Harga", "Jumlah"]],
          body: [
            ...(v.items || []).map((it) => [tglPendek(it.tglPakai), it.keterangan, `${angka(it.qty)} ${it.satuan || ""}`.trim(), num(it.hargaSatuan), num(it.jumlah)]),
            ...(v.pembayaran || []).map((p) => [tglPendek(p.tanggal), { content: `Pembayaran${p.metode ? " (" + p.metode + ")" : ""}`, styles: { fontStyle: "italic" } }, "", "", `- ${num(p.nominal)}`]),
          ],
          foot: [[{ content: "Total tagihan / sisa", colSpan: 3 }, rp(v.total), rp(v.sisa)]],
          theme: "grid", styles: { fontSize: 8, cellPadding: 1.3 },
          headStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: "bold" },
          footStyles: { fillColor: [250, 250, 250], textColor: 20, fontStyle: "bold" },
          columnStyles: { 0: { cellWidth: 20 }, 2: { halign: "right", cellWidth: 20 }, 3: { halign: "right", cellWidth: 24 }, 4: { halign: "right", cellWidth: 28 } },
        });
        y = doc.lastAutoTable.finalY + 6;
      }
    }
    if (internal) {
      if (y > ph() - 50) y = halamanBaru();
      const x0 = pw() - margin - 90;
      const baris = [["Tagihan", r.tagihan], ["Potongan invoice", -r.potonganInvoice], ["HPP proyek (bersih)", -r.hppProyek], ["Upah kuli", -r.upahKuli], ["Diskon", -r.diskon], ["HASIL BERSIH", r.bersih]];
      baris.forEach(([l, v], i) => {
        const tebal = i === baris.length - 1;
        doc.setFont(undefined, tebal ? "bold" : "normal"); doc.setFontSize(tebal ? 10 : 9);
        doc.text(l, x0, y);
        doc.text(`${v < 0 ? "- " : ""}${rp(Math.abs(v))}`, pw() - margin, y, { align: "right" });
        y += tebal ? 6 : 5;
      });
    }
  }
  doc.save(`laporan-customer-${internal ? "internal" : "tagihan"}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
