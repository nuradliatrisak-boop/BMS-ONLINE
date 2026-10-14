import prisma from "../prismaClient.js";

// ------------------------------------------------------------
// Pencocokan otomatis Surat Jalan (SJ) -> Purchase Order (PO)
//
// Tidak ada data yang disalin: pencocokan dihitung ulang tiap PO dibuka, jadi
// kalau SJ diedit / dihapus / jadi draft, angka terkirim & sisa di PO ikut
// berubah sendiri. Aturannya:
//
//  1. SJ harus final (bukan draft), satu divisi, tanggalnya sama/setelah
//     tanggal PO, dan customernya sama dengan customer PO.
//  2. Alamat tujuan SJ harus SAMA dengan Lokasi Proyek PO (setelah dirapikan:
//     huruf besar/kecil, tanda baca, kata "Jalan/Kec./Kel." diabaikan, urutan
//     kata tidak berpengaruh). Kalau penulisannya BEDA tapi mirip, SJ tidak
//     dihitung dulu -- masuk daftar "Perlu Konfirmasi" dan user yang
//     memutuskan (hubungkan / bukan PO ini).
//  3. Barang SJ dicocokkan ke barang PO lewat nama (tulisan dalam kurung
//     seperti "(Colt Diesel)" diabaikan, jenis kendaraan dipakai kalau ada
//     2 barang sama beda kendaraan). Kalau tidak cocok / ambigu -> juga
//     "Perlu Konfirmasi".
//  4. Jumlah yang dikreditkan = M3 SJ (kalau satuan barang PO m3), atau 1 per
//     SJ kalau satuannya rit / trip / truk / unit.
//  5. Satu SJ hanya dihitung ke satu PO. Kalau ada beberapa PO yang cocok
//     (mis. PO lanjutan di proyek yang sama), PO yang lebih lama diisi dulu
//     sampai penuh, sisanya jatuh ke PO berikutnya.
//  6. SJ yang sudah dicatat manual di PO (No. Surat Jalan sama) tidak dihitung
//     dua kali.
// ------------------------------------------------------------

const KATA_ABAI = new Set([
  "jalan", "jl", "jln", "kec", "kecamatan", "kel", "kelurahan", "kota", "kab",
  "kabupaten", "no", "nomor", "rt", "rw", "di", "dan", "ke", "dki", "prov", "provinsi",
]);

const r2 = (x) => Math.round(x * 100) / 100;
const hari = (d) => new Date(d).toISOString().slice(0, 10);

function tokenAlamat(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !KATA_ABAI.has(t));
}

function samaToken(a, b) {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((t, i) => t === y[i]);
}

function irisan(a, b) {
  const B = new Set(b);
  return a.filter((t) => B.has(t)).length;
}

// "SAMA" | "MIRIP" | null
export function cocokAlamat(a, b) {
  const ta = tokenAlamat(a);
  const tb = tokenAlamat(b);
  if (!ta.length || !tb.length) return null;
  if (samaToken(ta, tb)) return "SAMA";
  const ir = irisan(ta, tb);
  const gabung = new Set([...ta, ...tb]).size;
  const kecil = Math.min(new Set(ta).size, new Set(tb).size);
  if (ir >= 2 && (ir / gabung >= 0.5 || ir === kecil)) return "MIRIP";
  if (ir >= 1 && kecil === 1 && ir === kecil) return "MIRIP";
  return null;
}

function dasarBarang(s) {
  return tokenAlamat(String(s || "").replace(/\([^)]*\)/g, " "));
}

function kendaraanDari(teks) {
  const t = String(teks || "").toLowerCase();
  if (t.includes("tronton")) return "TRONTON";
  if (/colt|diesel|\bcd\b/.test(t)) return "CD";
  return "";
}

function kendaraanSJ(sj) {
  const v = sj.detail && typeof sj.detail === "object" ? sj.detail.vehicleType : "";
  const k = kendaraanDari(v) || kendaraanDari(sj.armada?.jenis);
  return k;
}

function qtyUntuk(sj, item) {
  const sat = String(item.satuan || "").toLowerCase();
  if (/rit|trip|ret|truk|unit|kali/.test(sat) && !/m3|m³|kubik/.test(sat)) return 1;
  return r2(Number(sj.m3) || 0);
}

// Cari barang PO untuk SJ. Balikan { item } kalau pasti, { alasan } kalau perlu ditanya user.
function cariItem(po, sj) {
  const tb = dasarBarang(sj.jenisBarang);
  if (!tb.length) return { alasan: "barang_tidak_cocok" };

  let cocok = po.items.filter((it) => {
    const ti = dasarBarang(it.uraian);
    if (!ti.length) return false;
    return samaToken(ti, tb) || (irisan(ti, tb) === Math.min(ti.length, tb.length));
  });
  if (cocok.length > 1) {
    const persis = cocok.filter((it) => samaToken(dasarBarang(it.uraian), tb));
    if (persis.length) cocok = persis;
  }
  if (cocok.length > 1) {
    const kv = kendaraanSJ(sj);
    if (kv) {
      const sama = cocok.filter((it) => kendaraanDari(it.uraian) === kv);
      if (sama.length) cocok = sama;
    }
  }
  if (cocok.length === 1) return { item: cocok[0] };
  return { alasan: cocok.length ? "barang_ambigu" : "barang_tidak_cocok" };
}

function customerCocok(po, sj) {
  if (po.customerId) return sj.customerId === po.customerId;
  const nPo = tokenAlamat(po.namaCustomer);
  const nSj = tokenAlamat(sj.customer?.nama);
  return !!nPo.length && !!nSj.length && samaToken(nPo, nSj);
}

function bestAlamat(po, sj) {
  const a = cocokAlamat(po.lokasiProyek, sj.tujuan);
  const b = cocokAlamat(po.proyek, sj.tujuan);
  if (a === "SAMA" || b === "SAMA") return "SAMA";
  return a || b || null;
}

const baris = (sj, itemId, qty, extra = {}) => ({
  sjId: sj.id,
  no: sj.no,
  tanggal: sj.tanggal,
  tujuan: sj.tujuan,
  jenisBarang: sj.jenisBarang,
  m3: sj.m3,
  itemId,
  qty,
  ...extra,
});

// Fungsi murni: tidak menyentuh database. poList = semua PO yang relevan (item &
// pengiriman manual sudah di-include), sjList = SJ final, links = PoSuratJalan.
export function petakanSJ(poList, sjList, links) {
  const hasil = new Map(poList.map((p) => [p.id, { otomatis: [], perlu: [], dilepas: [] }]));
  const linkKey = new Map(links.map((l) => [`${l.poId}|${l.suratJalanId}`, l]));
  const sjTerhubung = new Map(); // sjId -> [link TERHUBUNG]
  for (const l of links) {
    if (l.status !== "TERHUBUNG") continue;
    if (!sjTerhubung.has(l.suratJalanId)) sjTerhubung.set(l.suratJalanId, []);
    sjTerhubung.get(l.suratJalanId).push(l);
  }
  const poMap = new Map(poList.map((p) => [p.id, p]));

  // sisa kapasitas per PO per barang (dipakai buat alokasi PO lama dulu)
  const sisa = new Map();
  const noManual = new Map();
  for (const p of poList) {
    const m = new Map();
    for (const it of p.items) m.set(it.id, it.qty);
    for (const k of p.pengiriman || []) m.set(k.itemId, (m.get(k.itemId) ?? 0) - k.qty);
    sisa.set(p.id, m);
    noManual.set(p.id, new Set((p.pengiriman || []).map((k) => String(k.noSuratJalan || "").trim().toLowerCase()).filter(Boolean)));
  }
  const kurangi = (poId, itemId, qty) => {
    const m = sisa.get(poId);
    m.set(itemId, (m.get(itemId) ?? 0) - qty);
  };

  const urut = [...sjList].sort(
    (a, b) => new Date(a.tanggal) - new Date(b.tanggal) || new Date(a.createdAt) - new Date(b.createdAt)
  );
  const poUrut = [...poList].sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal) || new Date(a.createdAt) - new Date(b.createdAt));

  for (const sj of urut) {
    // 1) SJ yang sudah dikonfirmasi user -> ikut keputusan user
    const manual = sjTerhubung.get(sj.id);
    if (manual) {
      for (const l of manual) {
        const po = poMap.get(l.poId);
        const item = po?.items.find((it) => it.id === l.itemId);
        if (!po || !item) continue;
        const qty = qtyUntuk(sj, item);
        hasil.get(po.id).otomatis.push(baris(sj, item.id, qty, { dikonfirmasi: true }));
        kurangi(po.id, item.id, qty);
      }
      continue;
    }

    // 2) cari PO kandidat
    const pasti = []; // { po, item }
    const tanya = []; // { po, alasan, itemSaran }
    for (const po of poUrut) {
      if (po.batal) continue;
      if (po.divisi !== sj.divisi) continue;
      if (hari(sj.tanggal) < hari(po.tanggal)) continue;
      if (!customerCocok(po, sj)) continue;
      const l = linkKey.get(`${po.id}|${sj.id}`);
      if (l && l.status === "DITOLAK") {
        hasil.get(po.id).dilepas.push(baris(sj, null, r2(Number(sj.m3) || 0)));
        continue;
      }
      if (noManual.get(po.id).has(String(sj.no).trim().toLowerCase())) continue;
      const al = bestAlamat(po, sj);
      if (!al) continue;
      const { item, alasan } = cariItem(po, sj);
      if (al === "SAMA" && item) pasti.push({ po, item });
      else tanya.push({ po, alasan: al !== "SAMA" ? "alamat_mirip" : alasan, itemSaran: item?.id || null });
    }

    if (pasti.length) {
      const dapat = pasti.find((c) => (sisa.get(c.po.id).get(c.item.id) ?? 0) > 0) || pasti[pasti.length - 1];
      const qty = qtyUntuk(sj, dapat.item);
      hasil.get(dapat.po.id).otomatis.push(baris(sj, dapat.item.id, qty));
      kurangi(dapat.po.id, dapat.item.id, qty);
    } else {
      for (const t of tanya) {
        hasil.get(t.po.id).perlu.push(
          baris(sj, null, r2(Number(sj.m3) || 0), { alasan: t.alasan, itemSaran: t.itemSaran })
        );
      }
    }
  }
  return hasil;
}

// Ambil data yang dibutuhkan dari database lalu panggil petakanSJ.
// Balikan Map poId -> { otomatis, perlu, dilepas } untuk PO di poList.
export async function petakanOtomatis(poList) {
  if (!poList.length) return new Map();
  const divisi = [...new Set(poList.map((p) => p.divisi))];
  const customerIds = [...new Set(poList.map((p) => p.customerId).filter(Boolean))];
  const namaCust = [...new Set(poList.map((p) => p.namaCustomer).filter(Boolean))];
  const minTgl = poList.reduce((m, p) => (new Date(p.tanggal) < m ? new Date(p.tanggal) : m), new Date(poList[0].tanggal));

  // PO lain milik customer yang sama ikut dihitung supaya pembagian PO lama -> PO baru benar
  const orPo = [];
  if (customerIds.length) orPo.push({ customerId: { in: customerIds } });
  if (namaCust.length) orPo.push({ namaCustomer: { in: namaCust } });
  const saudara = orPo.length
    ? await prisma.purchaseOrder.findMany({
        where: { batal: false, divisi: { in: divisi }, OR: orPo },
        include: {
          items: { orderBy: [{ urut: "asc" }, { id: "asc" }] },
          pengiriman: true,
        },
      })
    : [];
  const semua = new Map(saudara.map((p) => [p.id, p]));
  for (const p of poList) semua.set(p.id, p); // versi yang diminta menang
  const poAll = [...semua.values()];

  const orSj = [];
  if (customerIds.length) orSj.push({ customerId: { in: customerIds } });
  for (const n of namaCust) orSj.push({ customer: { nama: { equals: n, mode: "insensitive" } } });
  const sjList = orSj.length
    ? await prisma.suratJalan.findMany({
        where: { isDraft: false, divisi: { in: divisi }, tanggal: { gte: minTgl }, OR: orSj },
        include: { customer: { select: { nama: true } }, armada: { select: { jenis: true } } },
      })
    : [];

  const links = sjList.length || poAll.length
    ? await prisma.poSuratJalan.findMany({
        where: { OR: [{ poId: { in: poAll.map((p) => p.id) } }, { suratJalanId: { in: sjList.map((s) => s.id) } }] },
      })
    : [];

  // SJ yang sudah dikonfirmasi ke PO di luar kumpulan ini tidak perlu ikut dibahas
  const peta = petakanSJ(poAll, sjList, links);
  const out = new Map();
  for (const p of poList) out.set(p.id, peta.get(p.id) || { otomatis: [], perlu: [], dilepas: [] });
  return out;
}
