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

  {
    kode: "TG065",
    nama: "TB. GLORYA",
    alamat: "Jl. Sunter Kirana 11 Blok NG2 No. 1",
    telepon: "6512326-081383340735",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B01", "BB", "BATU SPLIT", 150000, 300000, 0, "HRG COLT/M3 SPLIT JKT"],
      ["B02", "BS", "BANGKA SUPER", 420000, 300000, 0, "HRG COLT/M3 BANGKA SUPER"],
    ],
  },

  {
    kode: "TJ087",
    nama: "TB. JAYA ANUGRAH / MARUNDA",
    alamat: "Central Ondeadil Blok EA No. 5, Harapan Indah, Bekasi",
    telepon: "88992217-08161869530-001322574",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["A01", "AA", "PASIR PUTIH", 250000, 200000, 0, "HRG COLT JAKUT+TIM+PUS"],
      ["B02", "BA", "PASIRBANGKA", 300000, 300000, 0, "HRG COLT/M3 BANGKA JKT"],
      ["C01", "CC", "PASIR URUK", 950000, 300000, 0, "HRG LIMIT URUG JKT"],
      ["F01", "FF", "SIRTU", 960000, 300000, 0, "HRG LIMIT DUMP SIRTU JKT"],
      ["B01", "BB", "BATU SPLIT", 205000, 300000, 0, "HRG COLT/M3 SPLIT JKT"],
    ],
  },

  {
    kode: "TJ095",
    nama: "TB. JAYA ABADI / TAMBUN",
    alamat: "Jl. Mustika Jaya Kalijambe Ds. Lambang Sari, Grand Wisata Bekasi",
    telepon: "8252624-0816929947",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["A01", "AA", "PASIR PUTIH", 240000, 200000, 0, "HRG TRN/M3 BEKASI+CIBITUNG"],
      ["B01", "BB", "BATU SPLIT", 210000, 200000, 0, "HRG COLT/M3 SPLIT JKT"],
      ["B02", "BA", "PASIRBANGKA", 285000, 200000, 0, "HRG COLT/M3 BANGKA JKT"],
    ],
  },

  {
    kode: "TL092",
    nama: "TB. LESTARI",
    alamat: "Jl. Villa Kapuk Mas Blok BM No. 16",
    telepon: "5416630-5459131-70616500 / 081287109838-08121081818",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["A02", "AA", "PASIR PUTIH", 230000, 200000, 0, "HRG COLT/M3 JKT"],
      ["B01", "BB", "BATU SPLIT", 225000, 300000, 0, "HRG COLT/M3 SPLIT JKT"],
      ["B02", "BA", "PASIRBANGKA", 390000, 300000, 0, "HRG TRN/M3 P.BANGKA JKT"],
      ["C01", "CC", "PASIR URUK", 220000, 300000, 0, "HRG TRN/M3 URUG JKT"],
    ],
  },

  {
    kode: "OM039",
    nama: "BP. MA'MUN",
    alamat: "Jl. Kemang Timur 13 No. 27 Gg. Jawara, Kec. Mampang Prapatan, Jaksel",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B01", "BA", "PASIRBANGKA", 2100000, 300000, 0, "HRG LIMIT DUMP BANGKA JKT"],
    ],
  },

  {
    kode: "TM099",
    nama: "TB. MAJU JAYA / SUNTER",
    alamat: "Jl. Sunter Kemayoran No. 8",
    telepon: "6517347 / 081385501351-08121921765",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B01", "BS", "BANGKASUPER", 415000, 300000, 0, "HRG COLT BANGKA SUPER JKT"],
      ["B02", "BB", "BATU SPLIT", 445000, 300000, 0, "HRG COLT/M3 SPLIT JKT"],
    ],
  },

  {
    kode: "TN002",
    nama: "TB. NEW JAYA",
    alamat: "Jl. Sunter Kemayoran No. 3A",
    telepon: "081519797968-0817820308",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B01", "BS", "BANGKASUPER", 435000, 300000, 0, "HRG COLT/M3 BANGKA JKT"],
      ["B02", "BB", "BATU SPLIT", 440000, 300000, 0, "HRG COLT/M3 SPLIT JKT"],
      ["D01", "DD", "BATU BELAH", 330000, 300000, 0, "HRG COLT/M3 BATU JKT"],
    ],
  },

  {
    kode: "TP134",
    nama: "TB. PRIMA",
    alamat: "Jl. Terusan Boulevard Timur Raya No. 1, Kelapa Gading",
    telepon: "70003097/4612278",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["A01", "AA", "PASIR PUTIH", 230000, 200000, 0, "HRG COLT/M3 JAKUT+TIM+PUS"],
      ["B01", "BB", "BATU SPLIT", 210000, 170000, 0, "HRG COLT/M3 SPLIT JKT"],
      ["B02", "BA", "PASIRBANGKA", 375000, 300000, 0, "HRG COLT/M3 P.BANGKA JKT"],
    ],
  },

  {
    kode: "TS131",
    nama: "TB. SINAR PELITA",
    alamat: "Perum. Greenville Blok AO No. 10",
    telepon: "082113667668",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B02", "BA", "PASIRBANGKA", 380000, 300000, 0, "HRG COLT/M3 BANGKA JKT"],
      ["B03", "BA", "PASIRBANGKA", 395000, 300000, 0, "HRG COLT/M3 BANGKA TANGERANG"],
    ],
  },

  {
    kode: "TS132",
    nama: "TB. SAHABAT / KELAPA GADING",
    alamat: "Jl. Kelapa Gading Timur 5 RT.05/17",
    telepon: "081292756913-081297184443",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B01", "BB", "BATU SPLIT", 440000, 300000, 0, "HRG COLT/M3 SPLIT JKT"],
      ["B02", "BA", "PASIRBANGKA", 435000, 300000, 0, "HRG COLT/M3 BANGKA JKT"],
    ],
  },

  {
    kode: "TS154",
    nama: "TB. SINAR MAKMUR / SUNTER",
    alamat: "Jl. Sunter Jaya Barat No. 78",
    telepon: "6505263-08129921999",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B01", "BS", "BANGKASUPER", 400000, 300000, 0, "HRG COLT/M3 BANGKA SUPER"],
      ["B02", "BB", "BATU SPLIT", 440000, 300000, 0, "HRG COLT/M3 SPLIT JKT"],
    ],
  },

  {
    kode: "TS156",
    nama: "TB. SINAR MAKMUR / PONDOK UNGU",
    alamat: "Jl. Kali Abang Tengah No. 70, Pondok Ungu, Bekasi",
    telepon: "88970450",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B01", "BB", "BATU SPLIT", 450000, 300000, 0, "HRG COLT/M3 SPLIT JKT"],
      ["B02", "BA", "PASIRBANGKA", 395000, 300000, 0, "HRG COLT/M3 BANGKA JKT"],
      ["C01", "CC", "PASIR URUK", 650000, 160000, 0, "HRG LMT DUMP URUG JKT"],
    ],
  },

  {
    kode: "TS189",
    nama: "TB. SURYA MAKMUR",
    alamat: "Jl. Pangeran Jayakarta No. 340",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B02", "BA", "PASIRBANGKA", 460000, 300000, 0, "HRG COLT/M3 BANGKA JKT"],
    ],
  },

  // =========================================================
  // CUSTOMER BARU DARI FOTO SISTEM LAMA
  // =========================================================

  {
    kode: "TS196",
    nama: "TB. SUMBER BARU / BP. HERI",
    alamat: "Jl. Terusan Menteng Lagoa, Jakarta",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["D01", "DD", "BATU BELAH", 440000, 300000, 0, "HRG BATU COLT/M3 JKT"],
      ["B01", "BB", "BATU SPLIT", 440000, 300000, 0, "HRG COLT/M3 SPLIT JKT"],
      ["B04", "BA", "PASIRBANGKA", 410000, 300000, 0, "HRG COLT/M3 BANGKA JAKUT"],
      ["M01", "MM", "PS.CILEGON", 310000, 300000, 0, "HRG COLT/M3 CILEGON JKT"],
      ["M02", "MM", "PS.CILEGON", 360000, 300000, 0, "HRG COLT/M3 CILEGON BOGOR"],
      ["P01", "PJ", "PASIR JAMBI", 370000, 300000, 0, "HRG COLT/M3 JAMBI CIBUBUR"],
    ],
  },

  {
    kode: "TS221",
    nama: "TB. SAHABAT KITA",
    alamat: "Jl. Boulevard Raya Blok QJ5 No. 18 Kelapa Gading (arah Tanah Merah)",
    telepon: "45847056-45845431",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B01", "BA", "PASIRBANGKA", 420000, 300000, 0, "HRG COLT/M3 BANGKA JKT"],
    ],
  },

  {
    kode: "TS240",
    nama: "SUMBER BARU 2, TB.",
    alamat: "Jl. Kesemek No. 6 (Jaya) Depan Apotik Semper",
    telepon: "4400736-4406642",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["A01", "AA", "PASIR PUTIH", 210000, 160000, 0, "HRG COLT/M3 JAKUT+TIM+PUS"],
      ["D01", "DD", "BATU BELAH", 410000, 300000, 0, "HRG COLT/M3 BATU JKT"],
      ["B02", "BA", "PASIRBANGKA", 420000, 300000, 0, "HRG COLT/M3 P.BANGKA JKT"],
      ["P01", "PJ", "PASIR JAMBI", 330000, 300000, 0, "HRG COLT/M3 P.JAMBI JKT"],
      ["I01", "II", "ABU BATU", 385000, 300000, 0, "HRG COLT/M3 ABUBATU JKT"],
    ],
  },

  {
    kode: "TS259",
    nama: "SUMBER BARU, TB/KO YANTO",
    alamat: "Jl. Kramat Jaya Sebelum Islamic Center",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["A01", "AA", "PASIR PUTIH", 120000, 250000, 0, "HRG COLT/M3 PASIR PUTIH JKT"],
      ["F01", "FF", "SIRTU", 120000, 250000, 0, "HRG COLT/M3 SIRTU JKT"],
      ["B01", "BB", "BATU SPLIT", 195000, 250000, 0, "HRG COLT/M3 SPLIT JKT"],
      ["B02", "BA", "PASIRBANGKA", 390000, 300000, 0, "HRG COLT/M3 P.BANGKA JKT"],
      ["C01", "CC", "PASIR URUK", 870000, 250000, 0, "HRG LIMIT DUMP URUG JKT"],
      ["D01", "DD", "BATU BELAH", 210000, 250000, 0, "HRG COLT/M3 BATU JKT"],
      ["I01", "II", "ABU BATU", 900000, 160000, 0, "HRG LMT DUMP ABUBATU JKT"],
      ["M01", "MM", "PS.CILEGON", 210000, 300000, 0, "HRG COLT/M3 CILEGON JKT"],
    ],
  },

  {
    kode: "0A011",
    nama: "KO'AHI",
    alamat: "JAKARTA",
    telepon: "081389200898",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B01", "BA", "PASIRBANGKA", 2200000, 300000, 0, "HRG LMT DUMP BANGKA JKT"],
      ["B02", "BB", "BATU SPLIT", 2500000, 300000, 0, "HRG LIMIT DUMP SPLIT JKT"],
    ],
  },

  {
    kode: "0A025",
    nama: "BP. APAU (SE)",
    alamat: "MJM JL.KH.HASYIMASHARI 81 RT02 /01 PD.PUCUNGKARANG TENGAH, TGRG",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B02", "BA", "PASIRBANGKA", 420000, 300000, 0, "HRG COLT/M3 BANGKA TGRNG"],
      ["B01", "BB", "BATU SPLIT", 450000, 300000, 0, "HRG COLT/M3 SPLIT JKT"],
    ],
  },

  {
    kode: "00023",
    nama: "BP. BRAM / PULAU",
    alamat: "TJ.PRIOK JAKARTA",
    telepon: "4307757-FAX",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B01", "BB", "BATU SPLIT", 175000, 230000, 0, "HRG COLT.D/M3 SPLIT JKT"],
      ["J01", "JJ", "PASIR HITAM", 175000, 170000, 0, "HRG COLT/M3 PASIR HITAM JKT"],
      ["C02", "CC", "PASIR URUK", 215000, 300000, 0, "HRG COLT/M3 P.URUG JKT"],
      ["K01", "KK", "MAKADAM", 0, 0, 0, ""],
      ["D01", "DD", "BATU BELAH", 275000, 300000, 0, "HRG TRN/M3 BATU DEPOK"],
      ["P01", "PT", "PS.PASANG", 210000, 300000, 0, "HRG TRN/M3 PASANG JKT"],
    ],
  },

  {
    kode: "00027",
    nama: "BP. DENNY",
    alamat: "PERUM. DUTA HARAPAN 7 NO.2 BEKASI UTARA (BP.AGUS=085848445465)",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["B02", "BB", "BATU SPLIT", 440000, 300000, 0, "HRG COLT/M3 SPLIT JKT"],
      ["B01", "BA", "PASIRBANGKA", 400000, 300000, 0, "HRG COLT/M3 BANGKA JKT"],
      ["M01", "MM", "PS.CILEGON", 315000, 300000, 0, "HRG COLT/M3 CILEGON JKT"],
      ["C01", "CC", "PASIR URUK", 255000, 300000, 0, "HRG COLT/M3 URUG JKT"],
    ],
  },

  {
    kode: "0H023",
    nama: "HARYANTO, BP.",
    alamat: "JL.PANGERAN JAYAKARTA GG.GATEB NO.16 JAKPUS",
    telepon: "6590185-08161880917",
    divisi: DIVISI_CUSTOMER,
    prices: [
      ["A01", "AA", "PASIR PUTIH", 1440000, 170000, 0, "HRG LMT DUMP JKT"],
    ],
  },
];

// =========================================================
// MASTER KODE STOCK
// =========================================================

const stockCodes = [
  ["AA", "PASIR PUTIH"],
  ["BA", "PASIRBANGKA"],
  ["BB", "BATU SPLIT"],
  ["BR", "BANGKA PAP"],
  ["BS", "BANGKA SUPER"],
  ["CC", "PASIR URUK"],
  ["DB", "PS. CUCI CELUP"],
  ["DD", "BATU BELAH"],
  ["EE", "PASIR COR"],
  ["FF", "SIRTU"],
  ["GG", "BASECOSE"],
  ["HH", "SIRDAM"],
  ["II", "ABU BATU"],
  ["JJ", "PASIR HITAM"],
  ["KK", "MAKADAM"],
  ["LL", "PASIR TAYAN"],
  ["LS", "LAMPUNG SUPER"],
  ["MC", "EXTRA BETON HITAM"],
  ["ML", "PS. MALIMPING"],
  ["MM", "PS. CILEGON"],
  ["NN", "LIMESTONE"],
  ["OO", "PS. RANGKAS"],
  ["PA", "PASIR AYAK"],
  ["PB", "PS. BELITUNG"],
  ["PC", "PS. CIWANDAN"],
  ["PG", "KROCO"],
  ["PI", "PUING"],
  ["PJ", "PASIR JAMBI"],
  ["PK", "P. KALIMANTAN"],
  ["PL", "PS. LINGKAR"],
  ["PP", "PS. PURWAKARTA"],
  ["PS", "RANGKAS CUCI"],
  ["PT", "PS. PASANG"],
  ["PW", "PS. TL BAWANG"],
  ["SH", "PASIR SUBANG"],
  ["SM", "SEMEN"],
  ["SS", "SKRINING"],
  ["TM", "TANAH MERAH"],
  ["TR", "RENTAL MOBIL"],
  ["TU", "TANAH URUG"],
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

  for (const [
    destinationCode,
    stockCode,
    stockName,
    hargaM3,
    sewaTruk,
    hppTruk,
    destination,
  ] of item.prices) {
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
  console.log(
    "  password:",
    passwordAdmin,
    "(segera ganti setelah login pertama)"
  );

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

  for (const [kode, nama] of stockCodes) {
    await prisma.stockMaster.upsert({
      where: { kode },
      update: { nama },
      create: { kode, nama },
    });
  }

  console.log(`${stockCodes.length} master kode stock siap.`);
  console.log(
    `Selesai. ${customers.length} customer utama + master harga telah disiapkan.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());