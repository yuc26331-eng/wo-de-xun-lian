import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';
import { bootWatchdog, markBootHealthy } from './lib/update/updater';

/**
 * 启动看门狗：如果上一次启动没有成功标记健康（例如更新后白屏），
 * 自动清理程序缓存并从服务器重新拉取一次，避免一直打不开。
 * 用户数据保存在 IndexedDB，不受影响。
 */
const watchdog = bootWatchdog();

/**
 * 注册 Service Worker（prompt 模式）：
 * 新版本安装完成后先待命，由「我的 → 版本与更新 → 立即更新」触发接管与刷新。
 */
void registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    // 应用回到前台时顺手检查一次（不打断用户）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration.update().catch(() => {});
    });
  },
  onRegisterError(error) {
    console.warn('[pwa] Service Worker 注册失败', error);
  },
});

// React 挂载成功后标记启动健康（供下一次启动判断是否需要自动恢复）
queueMicrotask(() => {
  requestAnimationFrame(() => markBootHealthy());
});

if (watchdog.recovered) {
  console.info('[update] 检测到上次启动异常，已自动重新获取最新资源');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
