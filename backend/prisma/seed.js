// Jalankan dengan: npm run seed
// Seed awal akun admin + master customer + daftar harga customer BMS.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DIVISI_CUSTOMER = "Supplier";

const customers = [
  {
    kode: "TA001",
    nama: "TB. ALAM JAYA",
    alamat: "Jl. Pemuda No. 43, Rawamangun",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["A01", "CDT", "COLT DEPOK TANGERANG", 314000, 0, 0, "DEPOK / TANGERANG"],
      ["B01", "BB", "BATU SPLIT - COLT", 212000, 0, 0, "JAKARTA"],
      ["B02", "BS", "BANGKA SUPER - COLT", 410000, 0, 0, "JAKARTA"],
      ["B03", "BS-T", "BANGKA SUPER - TRONTON", 360000, 0, 0, "JAKARTA"],
      ["C01", "BR", "BANGKA PAP - COLT DIESEL", 440000, 0, 0, "JAKARTA"],
      ["C02", "BR-T", "BANGKA PAP - TRONTON", 420000, 0, 0, "JAKARTA"],
      ["D01", "JM", "COLT JAMBI", 310000, 0, 0, "JAMBI"],
    ],
  },
  {
    kode: "TA002",
    nama: "TB. ANEKA JAYA",
    alamat: "Jl. Tarian Raya Barat No. 1, Kelapa Gading",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["A01", "BB", "SPLIT - COLT DIESEL", 450000, 0, 0, "JAKARTA"],
      ["B01", "BS", "BANGKA - COLT", 407000, 0, 0, "JAKARTA"],
    ],
  },
  {
    kode: "TA003",
    nama: "TB. AMAT / TB. CENTRAL BANGUNAN",
    alamat: "Jl. Danau Indah Barat A9 No. 11, Sunter",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["A01", "BB", "SPLIT", 465000, 0, 0, "JAKARTA"],
      ["B01", "BS", "BANGKA SUPER", 415000, 0, 0, "JAKARTA"],
    ],
  },
  {
    kode: "TC054",
    nama: "TB. CAHAYA BARU / SUMUR BATU",
    alamat: "Jl. Sumur Batu No. 3 RT.02 RW.05, Depan Alfamidi",
    telepon: "4208575-08875725775-4266843",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["A01", "AA", "PASIR PUTIH", 245000, 300000, 0, "HRG COLT/M3 LAMPUNG JKT"],
      ["B01", "BB", "BATU SPLIT", 245000, 300000, 0, "HRG COLT/M3 SPLIT JKT"],
      ["B02", "BB", "BATU SPLIT", 405000, 300000, 0, "HRG COLT/M3 BANGKA JKT"],
    ],
  },
  {
    kode: "TF069",
    nama: "FORTUNA TB.",
    alamat: "Jl. Kelapa Nias Raya Blok KR1 No. 2, Kelapa Gading",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["A01", "AA", "PASIR PUTIH", 240000, 160000, 0, "HRG COLT/M3 JKSEL+BAR+CK"],
      ["A04", "AA", "PASIR PUTIH", 235000, 200000, 0, "HRG COLT/M3 KLPGD+SUNTER"],
      ["B01", "BB", "BATU SPLIT", 210000, 250000, 0, "HRG COLT/M3 SPLIT JKT"],
    ],
  },
];

async function upsertCustomer(item) {
  const customer = await prisma.customer.upsert({
    where: { kode: item.kode },
    update: {
      nama: item.nama,
      alamat: item.alamat,
      telepon: item.telepon,
      divisi: item.divisi,
    },
    create: {
      kode: item.kode,
      nama: item.nama,
      alamat: item.alamat,
      telepon: item.telepon,
      divisi: item.divisi,
    },
  });

  for (const [destinationCode, stockCode, stockName, hargaM3, sewaTruk, hppTruk, destination] of item.prices) {
    await prisma.customerPrice.upsert({
      where: {
        customerId_destinationCode_stockCode: {
          customerId: customer.id,
          destinationCode,
          stockCode,
        },
      },
      update: {
        stockName,
        hargaM3,
        sewaTruk,
        hppTruk,
        destination,
      },
      create: {
        customerId: customer.id,
        destinationCode,
        stockCode,
        stockName,
        hargaM3,
        sewaTruk,
        hppTruk,
        destination,
      },
    });
  }

  return customer;
}

async function main() {
  const passwordAdmin = "admin123";
  const hash = await bcrypt.hash(passwordAdmin, 10);

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      password: hash,
      nama: "Administrator",
      role: "ADMIN",
    },
  });

  console.log("Akun admin siap:");
  console.log("  username:", admin.username);
  console.log("  password:", passwordAdmin, "(segera ganti setelah login pertama)");

  // Pertahankan customer contoh lama bila sudah ada, tetapi beri kode master.
  await prisma.customer.upsert({
    where: { id: "seed-customer-1" },
    update: { kode: "DEMO01" },
    create: {
      id: "seed-customer-1",
      kode: "DEMO01",
      nama: "PT Contoh Mitra Sejahtera",
      alamat: "Jl. Contoh No. 1, Jakarta",
      telepon: "021-1234567",
      divisi: "Alat Berat",
    },
  });

  for (const item of customers) {
    const customer = await upsertCustomer(item);
    console.log(`Customer ${customer.kode} siap: ${customer.nama}`);
  }

  console.log(`Selesai. ${customers.length} customer utama + master harga telah disiapkan.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
