// Pencocokan blok "Rekapan Invoice" dari Excel (format ala alexander.xls) ke Purchase Order (PO), per baris pengiriman.
//  - PO dicari lewat "No PO": persis sama (abaikan spasi/tanda baca/huruf besar) -> "PASTI";
//    atau salah satu nomor awalan yang lain & hanya cocok 1 PO -> "PERKIRAAN" (user diminta cek).
//  - Barang PO lewat nama barang (alias: Ps. Pasang = Pasir Pasang, Batu Belah = Batu Kali, dst).
//    Lebih dari 1 barang cocok (mis. Colt Diesel vs Tronton) -> "AMBIGU", user memilih.
//  - Baris tanpa tanggal/qty (belum terkirim) -> "KOSONG".
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const r2 = (x) => Math.round(x * 100) / 100;

const ALIAS = [
  ["urug", /\b(ps|pasir)\.?\s*urug|\burug\b/],
  ["pasang", /\b(ps|pasir)\.?\s*pasang|\bpasang\b/],
  ["belah", /batu\s*(belah|kali)|\bbt\.?\s*(belah|kali)|\bbelah\b/],
  ["split", /\b(batu\s*)?split\b/],
  ["abu", /abu\s*batu/],
  ["agregat a", /agregat\s*a\b/],
  ["agregat b", /agregat\s*b\b/],
  ["cor", /\bcor\b/],
  ["makadam", /makadam|macadam/],
  ["sirtu", /sirtu|sirdam/],
];
export function kanonikBarang(nama) {
  const t = String(nama || "").toLowerCase();
  for (const [k, re] of ALIAS) if (re.test(t)) return k;
  return key(t) || null;
}

function cariPo(poList, noPo) {
  const k = key(noPo);
  if (!k) return { po: null, kandidat: [], cara: null };
  const persis = poList.filter((p) => key(p.no) === k);
  if (persis.length === 1) return { po: persis[0], kandidat: [], cara: "PASTI" };
  const mirip = poList.filter((p) => {
    const pk = key(p.no);
    return pk.length >= 6 && k.length >= 6 && (pk.startsWith(k) || k.startsWith(pk));
  });
  if (mirip.length === 1) return { po: mirip[0], kandidat: [], cara: "PERKIRAAN" };
  return { po: null, kandidat: mirip.map((p) => ({ id: p.id, no: p.no })), cara: null };
}
function cariItem(po, jenis) {
  const kb = kanonikBarang(jenis);
  const cocok = po.items.filter((it) => kanonikBarang(it.uraian) === kb);
  return { itemId: cocok.length === 1 ? cocok[0].id : null, kandidat: cocok.map((i) => ({ id: i.id, uraian: i.uraian })), ambigu: cocok.length > 1 };
}
const kunciKirim = (itemId, tgl, qty, sj) => `${itemId}|${String(tgl).slice(0, 10)}|${r2(qty)}|${String(sj || "").trim()}`;

// bloks: [{ id, noPo, rows:[{ tanggal, noSj, noPolisi, jenis, qty }] }]; poList: PurchaseOrder + items + pengiriman
export function cocokkanBlok(bloks, poList) {
  return bloks.map((b) => {
    const { po, kandidat, cara } = cariPo(poList, b.noPo);
    const sudah = po ? new Set(po.pengiriman.map((x) => kunciKirim(x.itemId, new Date(x.tanggal).toISOString(), x.qty, x.noSuratJalan))) : new Set();
    const rows = (b.rows || []).map((r) => {
      const qty = r2(Number(r.qty) || 0);
      if (!r.tanggal || !(qty > 0)) return { ...r, qty, status: "KOSONG" };
      if (!po) return { ...r, qty, status: "TANPA_PO" };
      const it = cariItem(po, r.jenis);
      if (!it.itemId && !it.ambigu) return { ...r, qty, status: "BARANG_TIDAK_ADA", kandidatItem: [] };
      if (it.ambigu) return { ...r, qty, status: "AMBIGU", kandidatItem: it.kandidat };
      const dup = sudah.has(kunciKirim(it.itemId, r.tanggal, qty, r.noSj));
      return { ...r, qty, itemId: it.itemId, status: dup ? "SUDAH_ADA" : "BARU", kandidatItem: it.kandidat };
    });
    return { id: b.id, noPo: b.noPo || "", poId: po?.id || null, poNo: po?.no || null, caraCocok: cara, kandidatPo: kandidat, itemPo: po ? po.items.map((i) => ({ id: i.id, uraian: i.uraian })) : [], rows };
  });
}
