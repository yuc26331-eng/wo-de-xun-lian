/**
 * 浏览器端读取 PDF 文字（pdf.js，本地解析，绝不上传）
 * - 支持 iPhone 文件选择器与电脑拖拽
 * - 扫描版（无文字层）会被明确标记为需要 OCR
 */
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { itemsToLines } from './layout';
import { looksScanned } from './text';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface ExtractedPdf {
  fileName: string;
  fileSize: number;
  pageCount: number;
  pages: string[];
  text: string;
  ocrRequired: boolean;
}

export class PdfReadError extends Error {
  readonly code: 'password' | 'invalid' | 'not-pdf' | 'too-large' | 'unknown';
  constructor(code: PdfReadError['code'], message: string) {
    super(message);
    this.name = 'PdfReadError';
    this.code = code;
  }
}

/** 60MB 以上的 PDF 基本不是训练计划，直接提示，避免手机内存爆掉 */
const MAX_BYTES = 60 * 1024 * 1024;

export async function readPdfFile(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<ExtractedPdf> {
  const isPdf =
    file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) throw new PdfReadError('not-pdf', '请选择 PDF 文件（.pdf）。');
  if (file.size > MAX_BYTES) {
    throw new PdfReadError('too-large', '文件超过 60MB，请先在电脑上压缩或拆分后再导入。');
  }

  const data = new Uint8Array(await file.arrayBuffer());
  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({
      data,
      // 手机上避免一次性解析过多内容
      useSystemFonts: false,
    }).promise;
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'PasswordException') {
      throw new PdfReadError('password', '这个 PDF 有密码保护，请先解密或另存为无密码版本。');
    }
    if (name === 'InvalidPDFException') {
      throw new PdfReadError('invalid', 'PDF 文件已损坏或格式不正确。');
    }
    throw new PdfReadError('unknown', `PDF 打开失败：${(err as Error).message ?? '未知错误'}`);
  }

  const pages: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items = content.items
        .filter((it): it is typeof it & { str: string; transform: number[] } => 'str' in it)
        .map((it) => ({
          str: it.str,
          transform: it.transform as number[],
          width: 'width' in it ? (it.width as number) : undefined,
          height: 'height' in it ? (it.height as number) : undefined,
        }));
      pages.push(itemsToLines(items).join('\n'));
      page.cleanup();
      onProgress?.(i / doc.numPages);
    }
  } finally {
    const destroy = (doc as unknown as { destroy?: () => Promise<void> }).destroy;
    if (destroy) void destroy.call(doc);
  }

  const text = pages.join('\n');
  return {
    fileName: file.name,
    fileSize: file.size,
    pageCount: pages.length,
    pages,
    text,
    ocrRequired: looksScanned(text, pages.length),
  };
}
