import jwt from "jsonwebtoken";

// Mengecek token JWT yang dikirim staf di header Authorization: Bearer <token>
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Belum login" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, username, role, divisi }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Sesi login tidak valid atau kadaluarsa" });
  }
}

// Hanya izinkan role tertentu, misal requireRole("ADMIN")
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Tidak punya akses untuk aksi ini" });
    }
    next();
  };
}

// Batasi query ke divisi milik staf tsb, kecuali dia ADMIN (lihat semua divisi)
export function scopeDivisi(req) {
  if (req.user.role === "ADMIN") return {}; // tanpa filter
  return { divisi: req.user.divisi };
}
