/**
 * 截图文字识别（Tesseract.js，全部在本机运行，图片不会上传）
 * - 运行时文件与语言模型放在 /ocr/，首次识别时下载，之后 Service Worker 离线可用
 * - 单例 worker：多张截图连续识别不需要重复加载模型
 */
import { createWorker, type Worker } from 'tesseract.js';

export type OcrStage = 'loading' | 'recognizing' | 'done' | 'error';

export interface OcrProgress {
  stage: OcrStage;
  /** 0~1 */
  progress: number;
  message: string;
}

const STAGE_TEXT: Record<string, string> = {
  'loading tesseract core': '正在加载识别引擎',
  'initializing tesseract': '正在初始化识别引擎',
  'loading language traineddata': '正在加载中文/数字模型',
  'initializing api': '正在准备识别',
  'recognizing text': '正在识别截图内容',
};

let workerPromise: Promise<Worker> | null = null;
let progressHandler: ((p: OcrProgress) => void) | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const base = import.meta.env.BASE_URL || '/';
    workerPromise = createWorker(['chi_sim', 'eng'], undefined, {
      workerPath: `${base}ocr/worker.min.js`,
      corePath: `${base}ocr/core`,
      langPath: `${base}ocr/lang`,
      logger: (m: { status?: string; progress?: number }) => {
        const status = m?.status ?? '';
        progressHandler?.({
          stage: status === 'recognizing text' ? 'recognizing' : 'loading',
          progress: typeof m?.progress === 'number' ? m.progress : 0,
          message: STAGE_TEXT[status] ?? '正在处理截图',
        });
      },
      errorHandler: (err: unknown) => console.warn('[ocr] worker 错误', err),
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** 识别一张图片，返回原始文字（可能为空，由调用方判断是否识别失败） */
export async function recognizeImage(
  image: Blob,
  onProgress?: (p: OcrProgress) => void,
): Promise<string> {
  progressHandler = onProgress ?? null;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image);
    onProgress?.({ stage: 'done', progress: 1, message: '识别完成' });
    return data?.text ?? '';
  } catch (err) {
    onProgress?.({
      stage: 'error',
      progress: 0,
      message: err instanceof Error ? err.message : '识别失败',
    });
    throw err;
  } finally {
    progressHandler = null;
  }
}

/** 主动释放（例如用户离开总结页很久后） */
export async function disposeOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    /* ignore */
  } finally {
    workerPromise = null;
  }
}
