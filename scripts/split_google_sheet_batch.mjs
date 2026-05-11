import fs from 'node:fs';
import path from 'node:path';

const inputPath = process.argv[2];
const outputDir = process.argv[3];
const chunkSize = Number(process.argv[4] || 250);

if (!inputPath || !outputDir) {
  console.error('Usage: node split_google_sheet_batch.mjs <inputPath> <outputDir> [chunkSize]');
  process.exit(1);
}

const batch = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const data = Array.isArray(batch.data) ? batch.data : [];
fs.mkdirSync(outputDir, { recursive: true });

const manifest = [];
for (let i = 0; i < data.length; i += chunkSize) {
  const chunk = {
    valueInputOption: batch.valueInputOption || 'RAW',
    data: data.slice(i, i + chunkSize),
  };
  const index = Math.floor(i / chunkSize) + 1;
  const filePath = path.join(outputDir, `chunk_${String(index).padStart(3, '0')}.json`);
  fs.writeFileSync(filePath, JSON.stringify(chunk));
  manifest.push({ index, filePath, updateCount: chunk.data.length });
}

const manifestPath = path.join(outputDir, 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify({ totalChunks: manifest.length, totalUpdates: data.length, chunkSize, manifest }, null, 2) + '\n');
console.log(JSON.stringify({ totalChunks: manifest.length, totalUpdates: data.length, chunkSize, manifestPath }, null, 2));
