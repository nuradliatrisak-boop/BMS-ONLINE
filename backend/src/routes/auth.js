import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";

const router = Router();

router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username dan password wajib diisi" });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.aktif) {
      return res.status(401).json({ error: "Username atau password salah" });
    }

    const cocok = await bcrypt.compare(password, user.password);
    if (!cocok) {
      return res.status(401).json({ error: "Username atau password salah" });
    }

    const payload = {
      id: user.id,
      username: user.username,
      nama: user.nama,
      role: user.role,
      divisi: user.divisi,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "8h",
    });

    res.json({ token, user: payload });
  } catch (e) {
    next(e);
  }
});

export default router;
