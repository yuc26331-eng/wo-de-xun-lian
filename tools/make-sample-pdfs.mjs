/**
 * 生成示例 PDF（模拟从 ChatGPT 导出的训练计划 / 今日总结）
 * 用法：node tools/make-sample-pdfs.mjs <输出目录>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';

const outDir = resolve(process.argv[2] ?? '../outputs');
mkdirSync(outDir, { recursive: true });

const fontPath = resolve('public/fonts/NotoSansSC-Regular.ttf');
const boldPath = resolve('public/fonts/NotoSansSC-Bold.ttf');

async function render(title, lines, file) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const toU8 = (p) => {
    const buf = readFileSync(p);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };
  const regular = await doc.embedFont(toU8(fontPath), { subset: false });
  const bold = await doc.embedFont(toU8(boldPath), { subset: false });
  const page = doc.addPage([595.28, 841.89]);
  page.drawText(title, { x: 48, y: 790, size: 18, font: bold, color: rgb(0.1, 0.1, 0.12) });
  let y = 758;
  for (const line of lines) {
    const isHeading = line.startsWith('#');
    page.drawText(line.replace(/^#\s*/, ''), {
      x: 48,
      y,
      size: isHeading ? 13 : 11,
      font: isHeading ? bold : regular,
      color: isHeading ? rgb(0, 0.48, 1) : rgb(0.15, 0.15, 0.17),
      lineHeight: 16,
    });
    y -= isHeading ? 26 : 20;
  }
  mkdirSync(dirname(join(outDir, file)), { recursive: true });
  writeFileSync(join(outDir, file), await doc.save());
  console.log('生成', file);
}

await render(
  '健身计划：下肢力量 + 爆发力（示例）',
  [
    '计划名称：下肢力量 + 爆发力',
    '日期：2026-09-16',
    '预计训练时间：75 分钟',
    '# 热身（10 分钟）',
    '慢跑 5 分钟，心率升到 120 左右',
    '动态拉伸：髋部、腘绳肌、踝关节各 30 秒',
    '空杆深蹲 2 组 × 10 次',
    '# 训练内容',
    '1. 杠铃深蹲　4组 × 5次　90kg　组间休息 180秒　RPE 8',
    '要领：下蹲到大腿与地面平行，膝盖对准脚尖方向；全程收紧核心，不要塌腰。',
    '2. 罗马尼亚硬拉　3组 × 8次　70kg　组间休息 120秒　RPE 7',
    '要领：髋关节后移，感受腘绳肌拉伸；保持背部中立。',
    '3. 保加利亚分腿蹲　3组 × 10次　20kg　组间休息 90秒',
    '4. 箱式跳　4组 × 5次　组间休息 120秒　RPE 7',
    '要领：落地要轻，屈髋缓冲，组间充分休息保证爆发质量。',
    '5. 北欧式腘绳肌弯举　3组 × 6次　组间休息 90秒',
    '6. 平板支撑　3组 60秒　组间休息 60秒',
    '# 跑步安排',
    '400 米间歇跑：6 组，每组 90 秒，距离 0.4km，配速 4:00/km，心率 175 左右。',
    '# 拉伸与恢复',
    '静态拉伸：股四头肌、腘绳肌、臀肌各 30 秒 × 2 组；泡沫轴放松大腿前侧 2 分钟。',
    '注意：睡眠不足时把深蹲重量降到 80kg，RPE 控制在 7 以内。',
  ],
  '示例-健身计划.pdf',
);

await render(
  '今日训练总结（示例）',
  [
    '日期：2026-09-15',
    '体重：71.4 kg',
    '# 训练内容',
    '下肢力量：深蹲 4×5@90kg，罗马尼亚硬拉 3×8@70kg，保加利亚分腿蹲 3×10@20kg',
    '# 训练数据',
    '训练量：8420 kg　训练 RPE：8　训练时长：76 分钟',
    '跑步：400 米间歇跑 6 组，总距离 2.4km，平均配速 4:00/km，平均心率 170',
    '足球：带球绕杆 6 组，上场时间 20 分钟',
    '# 恢复与生活',
    '睡眠：7.2 小时，质量不错；饮食：早餐燕麦鸡蛋，午餐米饭鸡胸，晚餐牛肉意面',
    '补剂：蛋白粉 2 勺（约 50g 蛋白），肌酸 5g',
    '# 身体反馈',
    '疼痛：右膝在深蹲最后两组有轻微不适，没有加重',
    '个人感受：整体状态不错，最后一组有点吃力，但动作质量保持住了。',
    '备注：下次把深蹲加到 92.5kg，间歇跑的配速再稳定一点。',
  ],
  '示例-今日总结.pdf',
);
