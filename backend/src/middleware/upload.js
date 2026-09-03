import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Semua file upload (bukti surat jalan/dokumen pendukung Solar, dst)
// disimpan di backend/public/uploads, lalu di-serve statis lewat
// "/uploads/..." (lihat src/index.js). File ini juga yang dipakai kalau
// nanti ada jenis upload lain (tinggal bikin subfolder baru).
export const UPLOAD_DIR = path.join(__dirname, "..", "..", "public", "uploads");

// Catatan penting soal deploy (Railway/Render dst): filesystem hosting
// gratisan pada umumnya EPHEMERAL -- file yang disimpan di sini bisa
// hilang setiap kali service di-redeploy/restart, kecuali di-set volume
// persisten (mis. Railway "Volumes"). Kalau butuh penyimpanan yang pasti
// awet, ganti storage ini ke layanan cloud (S3/Cloudinary/dll).
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(path.join(UPLOAD_DIR, "solar"));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sub = path.join(UPLOAD_DIR, "solar");
    ensureDir(sub);
    cb(null, sub);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").slice(0, 10);
    const unik = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unik);
  },
});

const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

export const uploadBukti = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error("Format file tidak didukung. Pakai foto (JPG/PNG/WEBP) atau PDF."));
    }
    cb(null, true);
  },
});
