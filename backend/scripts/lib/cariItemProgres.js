// Pencocokan PO & barang untuk skrip progres PO (importPoProgres.js, syncPoCimanggis.js).
// Dipakai bersama supaya kedua skrip memilih barang PO yang SAMA.
//  - cariPo: nomor PO persis (abaikan spasi/tanda baca/huruf besar); kalau tidak ada, coba abaikan TAHUN di
//    ujung (mis. Excel "…/X/2026" vs database "…/X/2025") asal hanya 1 PO yang cocok.
//  - cariItem: uraian persis -> kalau tidak ada, cocokkan lewat jenis barang (Ps. Pasang = Pasir Pasang)
//    atau, untuk sewa alat, lewat satuan jam + harga per jam; mop/mobilisasi lewat kata "mop"/"mobil".
import { kanonikBarang } from "../../src/services/imporProgresPo.js";

export const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const tanpaTahun = (s) => key(s).replace(/\d{4}$/, "");

export function cariPo(poByKey, no) {
  const k = key(no);
  if (poByKey.has(k)) return poByKey.get(k);
  const t = tanpaTahun(no);
  const mirip = [...poByKey.values()].filter((p) => tanpaTahun(p.no) === t);
  return mirip.length === 1 ? mirip[0] : null;
}

const bersih = (s) => String(s || "").replace(/\[cek\]/gi, "").replace(/\(.*?\)/g, "").trim();

export function cariItem(po, r) {
  const persis = po.items.find((i) => i.uraian === r.uraian);
  if (persis) return persis;
  let c = [];
  if (r.alat) {
    if (r.satuan === "jam") c = po.items.filter((i) => i.satuan === "jam" && Math.round(i.hargaSatuan || 0) === Math.round(r.harga || 0));
    else c = po.items.filter((i) => /mop|mobil/i.test(i.uraian));
  } else {
    const kb = kanonikBarang(bersih(r.jenis || r.uraian));
    c = po.items.filter((i) => !i.satuan || i.satuan !== "jam").filter((i) => kanonikBarang(bersih(i.uraian)) === kb);
  }
  if (c.length > 1 && !r.alat) c = [c.find((i) => i.uraian.includes(r.qty >= 15 ? "Tronton" : "Colt")) || c[0]];
  return c[0] || null;
}
