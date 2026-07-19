// body-highlighter ESM → window 桥。原是 index.html 里的内联 module script,
// 为了 CSP 不开 'unsafe-inline'(script)搬进文件。
import * as BH from './body-highlighter.esm.js';
window.BodyHighlighter = BH;
