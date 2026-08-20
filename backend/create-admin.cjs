const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("admin123", 10);

  const user = await prisma.user.create({
    data: {
      username: "admin",
      password,
      nama: "Administrator",
      role: "ADMIN",
      divisi: null,
      aktif: true,
    },
  });

  console.log("Admin berhasil dibuat:");
  console.log("Username:", user.username);
  console.log("Password: admin123");
  console.log("Role:", user.role);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });