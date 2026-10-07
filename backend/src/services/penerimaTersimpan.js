// =============================================================================
// RIWAYAT INPUT MANUAL SURAT JALAN (penerima, tujuan, jenis barang)
//
// Tujuannya: apa pun yang pernah diketik manual tidak hilang dan bisa dipakai
// lagi. Tiga hal yang dilakukan di sini:
//   1. simpanPenerimaBaru()  : tiap Surat Jalan disimpan dengan customer + penerima
//      + tujuan yang BELUM ada di daftar Penerima customer (menu Customer >
//      Penerima) -> otomatis ditambahkan ke daftar itu.
//   2. riwayatInput()        : gabungan daftar Penerima customer + pasangan
//      penerima/tujuan yang pernah dipakai di Surat Jalan lama + jenis barang
//      yang pernah diketik manual (belum ada di Stock Master). Dipakai untuk
//      saran/autocomplete di form.
//   3. sinkronPenerimaLama() : sekali jalan, memasukkan SEMUA pasangan
//      penerima/tujuan dari Surat Jalan lama ke daftar Penerima customer.
// Pasangan yang sama dengan nama & alamat customer itu sendiri tidak disimpan
// (sudah otomatis dipakai sebagai penerima bawaan).
// =============================================================================
import prisma from "../prismaClient.js";

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const kosong = (s) => {
  const t = norm(s);
  return !t || t === "-";
};

export async function simpanPenerimaBaru(customerId, penerima, tujuan, db = prisma) {
  if (!customerId || kosong(penerima) || kosong(tujuan)) return false;
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: { recipients: true },
  });
  if (!customer) return false;
  const kunci = `${norm(penerima)}|${norm(tujuan)}`;
  if (kunci === `${norm(customer.nama)}|${norm(customer.alamat)}`) return false;
  if (customer.recipients.some((r) => `${norm(r.nama)}|${norm(r.alamat)}` === kunci)) return false;
  await db.customerRecipient.create({
    data: { customerId, nama: String(penerima).trim(), alamat: String(tujuan).trim() },
  });
  return true;
}

export async function riwayatInput(customerId, whereScope = {}) {
  const hasil = { penerima: [], jenisBarang: [] };
  const lihat = new Set();
  const tambah = (nama, alamat, sumber) => {
    if (kosong(nama) && kosong(alamat)) return;
    const k = `${norm(nama)}|${norm(alamat)}`;
    if (lihat.has(k)) return;
    lihat.add(k);
    hasil.penerima.push({ nama: String(nama ?? "").trim(), alamat: String(alamat ?? "").trim(), sumber });
  };

  if (customerId) {
    const recs = await prisma.customerRecipient.findMany({ where: { customerId }, orderBy: { nama: "asc" } });
    for (const r of recs) tambah(r.nama, r.alamat, "master");
  }

  const pasangan = await prisma.suratJalan.groupBy({
    by: ["penerima", "tujuan"],
    where: { ...whereScope, customerId: customerId || null },
    _max: { tanggal: true },
    orderBy: { _max: { tanggal: "desc" } },
    take: 300,
  });
  for (const p of pasangan) tambah(p.penerima, p.tujuan, "riwayat");

  const stok = await prisma.stockMaster.findMany({ select: { nama: true } });
  const namaStok = new Set(stok.map((s) => norm(s.nama)));
  const jenis = await prisma.suratJalan.groupBy({
    by: ["jenisBarang"],
    where: { ...whereScope, jenisBarang: { not: null } },
    _max: { tanggal: true },
    orderBy: { _max: { tanggal: "desc" } },
    take: 300,
  });
  for (const j of jenis) {
    const t = String(j.jenisBarang || "").trim();
    if (t && !namaStok.has(norm(t)) && !hasil.jenisBarang.includes(t)) hasil.jenisBarang.push(t);
  }
  return hasil;
}

export async function sinkronPenerimaLama() {
  const pasangan = await prisma.suratJalan.groupBy({
    by: ["customerId", "penerima", "tujuan"],
    where: { customerId: { not: null } },
  });
  let ditambah = 0;
  for (const p of pasangan) {
    if (await simpanPenerimaBaru(p.customerId, p.penerima, p.tujuan)) ditambah++;
  }
  return { diperiksa: pasangan.length, ditambah };
}
