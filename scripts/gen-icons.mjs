// Generate every icon size we need from public/logo.png.
//
// sharp handles the PNG resizing. For favicon.ico we bundle the 16+32
// PNGs into the classic ICO container format — tiny and well-defined,
// so we assemble the byte layout inline rather than pull in a library
// just for five lines of work.

import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "public/logo.png";
const OUT_DIR = "public";

const PNG_SIZES = [
  { name: "favicon-16x16.png", size: 16 },
  { name: "favicon-32x32.png", size: 32 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "icon-192x192.png", size: 192 },
  { name: "icon-512x512.png", size: 512 },
];

// Fit: "contain" keeps the whole logo visible + pads with transparency
// so horizontal or odd-aspect sources don't get cropped.
for (const { name, size } of PNG_SIZES) {
  await sharp(SRC)
    .resize(size, size, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toFile(`${OUT_DIR}/${name}`);
  console.log(`wrote ${OUT_DIR}/${name}`);
}

// ICO container: 6-byte header + one 16-byte directory entry per image,
// followed by the PNG bytes. Modern ICOs allow embedded PNGs (since
// Windows Vista); every current browser decodes them.
const icoImages = [
  { path: `${OUT_DIR}/favicon-16x16.png`, size: 16 },
  { path: `${OUT_DIR}/favicon-32x32.png`, size: 32 },
];

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);                 // reserved
  header.writeUInt16LE(1, 2);                 // type 1 = icon
  header.writeUInt16LE(images.length, 4);     // image count

  const entries = [];
  const pngs = images.map((img) => readFileSync(img.path));
  let offset = 6 + images.length * 16;

  for (let i = 0; i < images.length; i++) {
    const entry = Buffer.alloc(16);
    const size = images[i].size;
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2);                      // colour count
    entry.writeUInt8(0, 3);                      // reserved
    entry.writeUInt16LE(1, 4);                   // colour planes
    entry.writeUInt16LE(32, 6);                  // bits per pixel
    entry.writeUInt32LE(pngs[i].length, 8);      // bytes in PNG
    entry.writeUInt32LE(offset, 12);             // byte offset
    entries.push(entry);
    offset += pngs[i].length;
  }

  return Buffer.concat([header, ...entries, ...pngs]);
}

const ico = buildIco(icoImages);
writeFileSync(`${OUT_DIR}/favicon.ico`, ico);
console.log(`wrote ${OUT_DIR}/favicon.ico (${ico.length} bytes)`);
