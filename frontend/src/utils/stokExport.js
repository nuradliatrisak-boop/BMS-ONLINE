// Export kartu stok (menu Stok) ke Excel, bentuk sama dengan tabel stok di Excel:
//   KUBUS MASIF / PT TRANS CILEGON / 11000 / TANGGUL DERMAGA
//   No | Tanggal | No Surat | Qty | Total (sisa) | Upah Kuli
import * as XLSX from "xlsx";
import { tglPanjang } from "./laporanExport.js";

const slug = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const namaSheet = (s) => String(s || "Stok").replace(/[:\\/?*[\]]/g, "-").slice(0, 31);

export function exportStokExcel(s) {
  const aoa = [
    [String(s.nama || "").toUpperCase()],
    [String(s.namaCustomer || "").toUpperCase()],
    [s.qtyAwal + s.masuk],
    [String(s.proyek || "").toUpperCase()],
    ["No", "Tanggal", "No Surat", `Qty${s.satuan ? " (" + s.satuan + ")" : ""}`, "Total (sisa)", "Upah Kuli"],
  ];
  s.mutasi.forEach((m) => aoa.push([m.no, tglPanjang(m.tanggal), m.noSurat || "", m.tipe === "MASUK" ? m.qty : m.qty, m.sisa, m.upahKuli || ""]));
  aoa.push(["", "TOTAL", "", s.keluar, s.sisa, s.totalUpahKuli]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 6 }, { wch: 28 }, { wch: 36 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
  ws["!merges"] = [0, 1, 2, 3].map((r) => ({ s: { r, c: 0 }, e: { r, c: 5 } }));
  const fmt = (r, c, z) => { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) ws[a].z = z; };
  fmt(2, 0, "#,##0.###");
  for (let r = 5; r < aoa.length; r++) { fmt(r, 3, "#,##0.###"); fmt(r, 4, "#,##0.###"); fmt(r, 5, "#,##0"); }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, namaSheet(s.proyek || s.nama));
  XLSX.writeFile(wb, `stok-${slug(s.nama)}${s.proyek ? "-" + slug(s.proyek) : ""}.xlsx`);
}
