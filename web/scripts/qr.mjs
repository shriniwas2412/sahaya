// Writes docs/demo-qr.svg: a QR code for the live demo URL (default: this repo's
// GitHub Pages address). Run: npm run qr [-- https://your.url/]
import { writeFileSync } from "node:fs";
import QRCode from "qrcode";

const url = process.argv[2] ?? "https://shriniwas2412.github.io/sahaya/";
const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#1f2a24", light: "#ffffff" } });
writeFileSync(new URL("../../docs/demo-qr.svg", import.meta.url), svg);
console.log("docs/demo-qr.svg ->", url);
