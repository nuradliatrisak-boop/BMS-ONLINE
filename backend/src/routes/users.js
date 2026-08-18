import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../prismaClient.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();

// Hanya admin yang boleh melihat & mengelola daftar staf
router.get("/", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, nama: true, role: true, divisi: true, aktif: true },
      orderBy: { nama: "asc" },
    });
    res.json(users);
  } catch (e) {
    next(e);
  }
});

router.post("/", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { username, password, nama, role, divisi } = req.body;
    if (!username || !password || !nama) {
      return res.status(400).json({ error: "Username, password, dan nama wajib diisi" });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        password: hash,
        nama,
        role: role === "ADMIN" ? "ADMIN" : "STAFF",
        divisi: role === "ADMIN" ? null : divisi,
      },
      select: { id: true, username: true, nama: true, role: true, divisi: true },
    });
    res.status(201).json(user);
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "Username sudah dipakai" });
    }
    next(e);
  }
});

router.patch("/:id/nonaktifkan", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { aktif: false },
      select: { id: true, username: true, aktif: true },
    });
    res.json(user);
  } catch (e) {
    next(e);
  }
});

export default router;
