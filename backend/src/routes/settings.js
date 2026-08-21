import { Router } from "express";
import prisma from "../prismaClient.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();

// Nilai default kalau belum pernah diatur
const DEFAULTS = {
  signerName: "",
};

router.get("/", async (req, res, next) => {
  try {
    const rows = await prisma.setting.findMany();
    const result = { ...DEFAULTS };

    for (const r of rows) {
      result[r.key] = r.value;
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
});

// Hanya ADMIN yang boleh ubah pengaturan umum
router.put("/", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const entries = Object.entries(req.body || {});

    for (const [key, value] of entries) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: String(value ?? "") },
        create: { key, value: String(value ?? "") },
      });
    }

    const rows = await prisma.setting.findMany();
    const result = { ...DEFAULTS };

    for (const r of rows) {
      result[r.key] = r.value;
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
});

export default router;
