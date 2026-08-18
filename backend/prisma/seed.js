// Jalankan dengan: npm run seed
// Membuat akun admin pertama supaya kamu bisa login pertama kali.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordAdmin = "admin123"; // GANTI setelah login pertama kali!
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

  // Contoh customer & divisi supaya UI tidak kosong saat pertama dipakai
  const customer = await prisma.customer.upsert({
    where: { id: "seed-customer-1" },
    update: {},
    create: {
      id: "seed-customer-1",
      nama: "PT Contoh Mitra Sejahtera",
      alamat: "Jl. Contoh No. 1, Jakarta",
      telepon: "021-1234567",
      divisi: "Alat Berat",
    },
  });

  console.log("Contoh customer dibuat:", customer.nama);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
