# 我的训练（fitness-pwa）

面向足球运动员与日常健身用户的中文训练记录 + 实时跟练 PWA。
所有数据（训练计划、PDF 内容、体重、训练进度）都保存在浏览器本地的 IndexedDB 中，离线可用、不上传服务器。

## 功能

- **首页**：今日状态、今日计划、体重快速记录、恢复状态、大号「开始今天的训练」、PDF 导入入口
- **训练**：训练计划（今天 / 其他 / 归档）、ChatGPT PDF 导入、动作库、训练模板、历史记录、实时跟练入口
- **数据**：体重 / 体脂 / 力量 / 训练量 / RPE 趋势图、训练日历、PR、睡眠恢复、酸痛伤病、饮水与蛋白质
- **总结**：每日总结、训练报告、PDF 导入、一键导出排版整齐的中文 PDF
- **我的**：目标管理、补剂（蛋白粉 / 肌酸）记录、JSON 备份与恢复、主题（浅色 / 深色 / 跟随系统）、数据管理、PWA 安装引导
- **实时跟练**：一次显示一个动作、大号「完成本组」、自动休息倒计时（基于绝对时间，锁屏后仍准确）、上一项 / 下一项 / 跳过 / 加减组 / 临时改重量次数休息 / 暂停 / 记录疼痛、退出后恢复、防重复点击；跑步 / 骑行 / 足球使用专属记录卡片
- **PDF 智能导入**：本地用 pdf.js 解析文字型 PDF，自动区分健身计划 / 今日总结 / 周计划 / 身体数据报告；识别结果先进「导入确认」页，用户确认后才保存，绝不覆盖旧数据；扫描版 PDF 明确提示需要 OCR
- **中文 PDF 导出**：pdf-lib + Noto Sans SC（GB2312 子集，构建期生成）嵌入字体，中文不乱码、长文本自动分页不截断

## 开发

```bash
pnpm install
pnpm dev            # 本地开发（加 --host 可让手机同 Wi-Fi 访问）
pnpm typecheck      # TypeScript 类型检查
pnpm test           # Vitest 单元测试
pnpm build          # 生产构建
pnpm preview        # 预览生产构建
pnpm e2e            # Playwright E2E（iPhone 尺寸，需先 build）
```

部署到子路径（例如 GitHub Pages）：

```bash
VITE_BASE=/<仓库名>/ pnpm build
```

## 静态资源

- `public/fonts/NotoSansSC-Regular.ttf` / `-Bold.ttf`：由 Noto Sans SC 可变字体固定字重后子集化生成（ASCII + 中文标点 + GB2312 汉字，约 2MB）。
  生成脚本：`work/build_assets.py`（需要 `fonttools`、`Pillow` 以及 `NotoSansSC[wght].ttf`）。
  注意：pdf-lib 必须使用 `embedFont(bytes, { subset: false })` 嵌入该字体；运行时子集化会让字形错乱（实测）。
- `public/icons/*`：PWA 图标（192 / 512 / maskable / apple-touch-icon / favicon）。

## iPhone 添加到主屏幕

1. 用 **Safari** 打开部署后的网址
2. 点底部「分享」按钮 → 选择「添加到主屏幕」
3. 点「添加」，之后从主屏幕图标打开即为全屏独立应用，可离线使用

## 数据与隐私

- 训练数据与 PDF 文字内容只写入本机 IndexedDB；清理浏览器数据或卸载应用会丢失，请定期在「我的 → 备份与恢复」导出 JSON。
- 仓库中不包含任何 API Key / Token / 凭据。
