// BACKFILL GEOCODING LOKASI LAMA
// ================================
// Menjalankan geocoding untuk data LAMA yang sudah punya teks lokasi tapi
// belum punya koordinat (lat/lng) -- supaya langsung muncul di peta tanpa
// perlu diketik ulang satu-satu.
//
// Yang dibackfill:
//   1. SolarTx (Solar Keluar) -- kolom `lokasi` SUDAH ADA dari dulu, jadi
//      SEMUA data lama otomatis ikut kebackfill di sini.
//   2. InvoiceItem (Sewa Alat Berat) -- kolom `lokasi` BARU ditambahkan
//      lewat update ini, jadi baris invoice LAMA (sebelum update ini)
//      belum ada teks lokasinya sama sekali -> tidak ada yang bisa
//      digeocode untuk baris-baris itu. Skrip ini akan tetap jalan dan
//      melaporkan berapa baris lama yang "lokasinya kosong" supaya admin
//      tahu itu perlu diisi manual dulu (lewat kolom Lokasi yang baru di
//      halaman Rekap Sewa Alat) baru bisa muncul di peta.
//
// Cara pakai (dari folder backend/):
//   node scripts/geocodeBackfill.js
//
// Aman dijalankan berkali-kali -- baris yang sudah punya koordinat
// dilewati, dan hasil geocoding di-cache di tabel GeoCache supaya lokasi
// yang sama tidak dipanggil berkali-kali ke layanan geocoding.

import prisma from "../src/prismaClient.js";
import { geocodeLokasi } from "../src/services/geocode.js";

async function backfillSolar() {
  const rows = await prisma.solarTx.findMany({
    where: { tipe: "KELUAR", lokasi: { not: null }, OR: [{ lokasiLat: null }, { lokasiLng: null }] },
  });

  console.log(`\n[Solar Keluar] ${rows.length} baris lama butuh digeocode...`);
  let sukses = 0;
  let gagal = 0;
  for (const [i, r] of rows.entries()) {
    const geo = await geocodeLokasi(r.lokasi);
    await prisma.solarTx.update({ where: { id: r.id }, data: { lokasiLat: geo.lat, lokasiLng: geo.lng } });
    if (geo.lat != null) sukses += 1; else gagal += 1;
    process.stdout.write(`  (${i + 1}/${rows.length}) "${r.lokasi}" -> ${geo.lat != null ? `${geo.lat}, ${geo.lng}` : "TIDAK KETEMU"}\n`);
  }
  console.log(`[Solar Keluar] Selesai: ${sukses} ketemu koordinat, ${gagal} tidak ketemu.`);
}

async function backfillAlatBerat() {
  const kosong = await prisma.invoiceItem.count({ where: { kategoriAlat: { not: null }, lokasi: null } });
  const rows = await prisma.invoiceItem.findMany({
    where: { kategoriAlat: { not: null }, lokasi: { not: null }, OR: [{ lokasiLat: null }, { lokasiLng: null }] },
  });

  console.log(`\n[Sewa Alat Berat] ${rows.length} baris sudah ada teks lokasi & butuh digeocode...`);
  let sukses = 0;
  let gagal = 0;
  for (const [i, r] of rows.entries()) {
    const geo = await geocodeLokasi(r.lokasi);
    await prisma.invoiceItem.update({ where: { id: r.id }, data: { lokasiLat: geo.lat, lokasiLng: geo.lng } });
    if (geo.lat != null) sukses += 1; else gagal += 1;
    process.stdout.write(`  (${i + 1}/${rows.length}) "${r.lokasi}" -> ${geo.lat != null ? `${geo.lat}, ${geo.lng}` : "TIDAK KETEMU"}\n`);
  }
  console.log(`[Sewa Alat Berat] Selesai: ${sukses} ketemu koordinat, ${gagal} tidak ketemu.`);

  if (kosong > 0) {
    console.log(
      `\n[Sewa Alat Berat] CATATAN: masih ada ${kosong} baris invoice sewa alat LAMA yang` +
        ` belum punya teks lokasi sama sekali (kolom ini baru ditambahkan). Baris-baris itu` +
        ` TIDAK BISA otomatis muncul di peta sampai lokasinya diisi manual satu per satu lewat` +
        ` kolom "Lokasi" yang baru di halaman Rekap Sewa Alat (isi sekali, otomatis kegeocode).`
    );
  }
}

async function main() {
  console.log("=== BACKFILL GEOCODING LOKASI LAMA ===");
  console.log("(Proses ini bisa agak lama karena dibatasi ±1 request/detik ke layanan geocoding)");
  await backfillSolar();
  await backfillAlatBerat();
  console.log("\nSelesai.");
}

main()
  .catch((e) => {
    console.error("Backfill gagal:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
