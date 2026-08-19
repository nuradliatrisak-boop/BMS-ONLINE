import { PrismaClient } from "@prisma/client";

// Satu instance dipakai di seluruh aplikasi (praktik standar Prisma)
const prisma = new PrismaClient();

export default prisma;
