// Jalankan SEKALI SAJA di laptop kamu buat dapetin REFRESH_TOKEN Google Drive.
// Tidak perlu dijalankan lagi setelah ini, dan tidak perlu ikut di-deploy.
//
// CARA PAKAI:
// 1. Isi CLIENT_ID dan CLIENT_SECRET di bawah (dari OAuth client "Desktop app"
//    yang kamu buat di Google Cloud Console > Credentials).
// 2. Jalankan: node scripts/getGoogleRefreshToken.js
// 3. Sebuah URL akan muncul di terminal -- buka di browser, login pakai akun
//    Gmail yang mau dipakai buat nyimpen dokumen, klik "Allow" / "Izinkan"
//    (kalau muncul peringatan "Google hasn't verified this app", klik
//    "Advanced" > "Go to <nama app> (unsafe)" -- aman, karena ini app kamu
//    sendiri, cuma belum di-review Google, wajar untuk app pribadi/internal).
// 4. Setelah redirect ke localhost dan browser bilang "gagal terhubung",
//    itu normal -- lihat address bar, copy nilai parameter "code=..." nya.
// 5. Paste code itu ke terminal saat diminta.
// 6. REFRESH_TOKEN akan tercetak -- copy ke .env (GOOGLE_OAUTH_REFRESH_TOKEN).

import { google } from "googleapis";
import readline from "readline";

// Diambil dari .env (JANGAN ditulis manual di file ini -- kalau di-commit ke
// Git, GitHub akan otomatis menolak push karena mendeteksi ini rahasia).
import "dotenv/config";

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Isi dulu GOOGLE_OAUTH_CLIENT_ID dan GOOGLE_OAUTH_CLIENT_SECRET di file .env " +
      "(backend/.env) sebelum menjalankan script ini."
  );
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // paksa Google selalu kasih refresh_token, bukan cuma access_token
  scope: ["https://www.googleapis.com/auth/drive"],
});

console.log("\nBuka URL ini di browser, login & izinkan aksesnya:\n");
console.log(authUrl);
console.log(
  "\nSetelah 'Allow', browser akan redirect ke localhost dan gagal terhubung (itu normal)."
);
console.log("Lihat address bar browser, copy nilai setelah 'code=' (sebelum tanda '&' kalau ada).\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Paste code di sini: ", async (code) => {
  rl.close();
  try {
    const { tokens } = await oAuth2Client.getToken(decodeURIComponent(code.trim()));
    console.log("\nBerhasil! Ini REFRESH_TOKEN kamu -- copy ke .env:\n");
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN="${tokens.refresh_token}"\n`);
    if (!tokens.refresh_token) {
      console.log(
        "PERINGATAN: refresh_token tidak muncul. Biasanya karena akun ini sudah " +
          "pernah authorize app ini sebelumnya. Coba cabut akses appnya dulu di " +
          "https://myaccount.google.com/permissions lalu ulangi script ini."
      );
    }
  } catch (err) {
    console.error("Gagal tukar code jadi token:", err.message);
  }
});