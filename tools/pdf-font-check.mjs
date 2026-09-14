/**
 * 中文字体嵌入自检工具（开发用）
 * 用法：node tools/pdf-font-check.mjs <字体路径> <输出目录> [--no-subset]
 * 生成 PDF 后可用 pdftoppm 渲染检查中文是否完整：
 *   pdftoppm -png -r 110 out.pdf out
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';

const SAMPLE =
  '我的训练 训练报告 下肢力量与爆发力 完成率 75% 总训练容量 12.5 吨 动作明细 第 1 页 由「我的训练」在本地生成 0123456789 组数次数重量休息RPE 深蹲卧推硬拉引体向上';

const fontPath = resolve(process.argv[2] ?? 'public/fonts/NotoSansSC-Regular.ttf');
const outPath = resolve(process.argv[3] ?? '../work/out/font-check.pdf');
const subset = !process.argv.includes('--no-subset');

mkdirSync(dirname(outPath), { recursive: true });

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const bytes = readFileSync(fontPath);
const font = await doc.embedFont(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
  subset,
});
const page = doc.addPage([595.28, 841.89]);
page.drawText(SAMPLE.slice(0, 40), { x: 40, y: 780, size: 16, font, color: rgb(0, 0, 0) });
page.drawText(SAMPLE.slice(40), { x: 40, y: 750, size: 14, font, color: rgb(0, 0, 0) });
const out = await doc.save();
writeFileSync(outPath, out);
console.log(
  `subset=${subset} font=${fontPath} -> ${outPath} (${(out.byteLength / 1024).toFixed(1)} KB)`,
);
