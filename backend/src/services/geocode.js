// GEOCODING LOKASI -> KOORDINAT (lat/lng)
// =========================================
// Dipakai supaya staf CUKUP MENGETIK NAMA LOKASI seperti biasa (mis.
// "Cimanggis 2", "Kp. Rambutan") -- TIDAK PERLU menandai titik manual di
// peta -- dan koordinatnya otomatis muncul untuk ditampilkan di peta
// (Rekap Sewa Alat, Stok Solar, & Peta Strategis di Dashboard).
//
// Pakai layanan geocoding gratis Nominatim (OpenStreetMap), dibatasi ke
// wilayah Indonesia. Hasilnya di-cache di tabel GeoCache supaya:
//   1. Tidak memanggil Nominatim berulang untuk teks lokasi yang sama
//      (rekap Sewa Alat/Solar biasanya berulang-ulang di lokasi yang sama).
//   2. Tetap patuh batas rate limit Nominatim (maks. ±1 request/detik).
//
// PENTING: fitur ini OPSIONAL & tidak boleh menggagalkan penyimpanan data
// utama (invoice/transaksi solar). Kalau geocoding gagal/timeout/tidak ada
// koneksi internet, fungsi ini cukup mengembalikan {lat: null, lng: null}
// dan baris datanya tetap tersimpan seperti biasa (cuma tidak muncul di
// peta sampai lokasinya diperbaiki/dicoba ulang).

import prisma from "../prismaClient.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
// Nominatim usage policy: wajib User-Agent yang jelas & maksimal ±1 request/detik.
const USER_AGENT = "BMS-Online-PT-Bintang-Muara-Sejati/1.0 (internal, non-komersial)";
const JEDA_MS = 1100;

let antrianTerakhir = Promise.resolve();

function normalisasi(teks) {
  return String(teks || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function tunda(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Panggil Nominatim, dibatasi antrian 1 per ±1.1 detik (dijalankan berantai
// lewat `antrianTerakhir` supaya banyak pemanggilan bersamaan tetap urut &
// tidak melanggar rate limit).
function panggilNominatim(query) {
  const tugas = antrianTerakhir.then(async () => {
    await tunda(JEDA_MS);
    const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=id&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "id" },
    });
    if (!res.ok) throw new Error(`Nominatim status ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) && data.length ? data[0] : null;
  });
  // Rantai antrian tetap jalan walau tugas ini gagal, supaya pemanggilan
  // berikutnya tidak ikut macet.
  antrianTerakhir = tugas.catch(() => {});
  return tugas;
}

// Geocode 1 teks lokasi. Selalu aman dipakai (tidak pernah throw) --
// mengembalikan { lat, lng } (bisa null kalau tidak ketemu/gagal).
export async function geocodeLokasi(teksLokasi) {
  const key = normalisasi(teksLokasi);
  if (!key) return { lat: null, lng: null };

  try {
    const cache = await prisma.geoCache.findUnique({ where: { query: key } });
    if (cache) return { lat: cache.lat, lng: cache.lng };

    let hasil = null;
    try {
      hasil = await panggilNominatim(teksLokasi);
    } catch {
      // Gagal panggil (offline/timeout/rate limit) -- JANGAN disimpan ke
      // cache supaya bisa dicoba lagi nanti (beda dengan "tidak ketemu").
      return { lat: null, lng: null };
    }

    const lat = hasil ? Number(hasil.lat) : null;
    const lng = hasil ? Number(hasil.lon) : null;

    await prisma.geoCache.upsert({
      where: { query: key },
      create: { query: key, lat, lng, displayName: hasil?.display_name || null },
      update: { lat, lng, displayName: hasil?.display_name || null },
    });

    return { lat, lng };
  } catch {
    // Error tak terduga (mis. DB sesaat bermasalah) -- tetap jangan sampai
    // mengganggu penyimpanan data utama.
    return { lat: null, lng: null };
  }
}

// Geocode banyak lokasi sekaligus (dipakai backfill), berurutan supaya
// rate limit Nominatim tetap dihormati.
export async function geocodeBanyakLokasi(daftarTeks) {
  const hasil = new Map();
  for (const teks of daftarTeks) {
    const key = normalisasi(teks);
    if (!key || hasil.has(key)) continue;
    hasil.set(key, await geocodeLokasi(teks));
  }
  return hasil;
}
