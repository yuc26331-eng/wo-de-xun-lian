/** PDF.js worker 包装：先安装兼容 API，再执行原 worker。 */
import './installCompat';
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
