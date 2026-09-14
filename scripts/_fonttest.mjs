import fs from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const fontPath = process.argv[2];
const bytes = fs.readFileSync(fontPath);
console.log('font bytes', bytes.length, fontPath);
const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const font = await doc.embedFont(bytes, { subset: true });
const page = doc.addPage([595.28, 841.89]);
page.drawText('我的训练 中文 PDF 导出测试：深蹲 90kg × 5 次，RPE 8', {
  x: 40, y: 780, size: 14, font, color: rgb(0.1, 0.1, 0.1),
});
const out = await doc.save();
fs.writeFileSync(process.argv[3], out);
console.log('pdf bytes', out.length, 'pages', doc.getPageCount());
