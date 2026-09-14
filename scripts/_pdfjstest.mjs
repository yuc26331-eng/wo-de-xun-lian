import fs from 'node:fs';
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const data = new Uint8Array(fs.readFileSync(process.argv[2]));
const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;
console.log('pages', doc.numPages);
let text = '';
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const content = await page.getTextContent();
  text += content.items.map((it) => it.str).join('');
}
console.log('TEXT:', JSON.stringify(text.slice(0, 200)));
