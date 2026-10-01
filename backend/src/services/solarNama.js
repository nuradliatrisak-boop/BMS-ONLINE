// Penyeragaman nama sopir/operator Solar -- salinan logika yang sama dengan
// routes/solarTx.js (bakukanNama), dipakai juga oleh routes/solarBuku.js
// supaya nama di buku catatan & di setoran real dianggap sama walau beda
// huruf besar/kecil atau yang satu singkatan dari yang lain ("Warto" ==
// "Wartono").
import prisma from "../prismaClient.js";

export const MIN_AWALAN = 4;

export function rapikanSpasi(n) {
  return String(n || "").trim().replace(/\s+/g, " ");
}

export function namaKey(n) {
  return rapikanSpasi(n).toLowerCase();
}

export function titleCase(n) {
  return rapikanSpasi(n)
    .toLowerCase()
    .replace(/(^|[\s.\-'])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
}

function pilihEjaan(daftar) {
  return daftar.find((n) => /^\p{Lu}/u.test(n)) || daftar[0];
}

// Satu nama dianggap sama dengan nama lain kalau persis sama (tanpa
// memandang huruf besar/kecil) atau salah satunya awalan (min. 4 huruf)
// dari yang lain.
export function namaSerupa(a, b) {
  const x = namaKey(a);
  const y = namaKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [pendek, panjang] = x.length <= y.length ? [x, y] : [y, x];
  return pendek.length >= MIN_AWALAN && panjang.startsWith(pendek);
}

// Ejaan baku untuk nama baru, merujuk ke nama yang sudah ada di data Solar.
export async function bakukanNama(nama) {
  const bersih = rapikanSpasi(nama);
  if (!bersih) return bersih;
  const key = namaKey(bersih);
  const rows = await prisma.solarTx.findMany({ select: { nama: true }, distinct: ["nama"] });
  const semua = rows.map((r) => rapikanSpasi(r.nama)).filter(Boolean);
  const tc = titleCase(bersih);

  const cocok = semua.filter((n) => namaKey(n) === key);
  if (cocok.length) return cocok.includes(tc) ? tc : pilihEjaan(cocok);

  if (key.length >= MIN_AWALAN) {
    const lengkap = new Map();
    for (const n of semua) {
      const k = namaKey(n);
      if (k !== key && k.startsWith(key)) lengkap.set(k, [...(lengkap.get(k) || []), n]);
    }
    if (lengkap.size === 1) return pilihEjaan([...lengkap.values()][0]);
  }
  return tc;
}
