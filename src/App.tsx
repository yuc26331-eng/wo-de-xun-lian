import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppDataProvider, useAppData } from './state/AppData';
import { ToastProvider } from './components/ui';
import HomePage from './pages/HomePage';
import TrainPage from './pages/TrainPage';
import DataPage from './pages/DataPage';
import SummaryPage from './pages/SummaryPage';
import ProfilePage from './pages/ProfilePage';
import HistoryPage from './pages/HistoryPage';
import ImportConfirmPage from './pages/ImportConfirmPage';
import LiveWorkoutPage from './pages/LiveWorkoutPage';

/** 主题：跟随系统 / 浅色 / 深色，并同步状态栏颜色 */
function ThemeSync() {
  const { settings } = useAppData();
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);

    const dark =
      settings.theme === 'dark' ||
      (settings.theme === 'system' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches === true);
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((m) => m.setAttribute('content', dark ? '#000000' : '#f2f2f7'));
  }, [settings.theme]);
  return null;
}

export default function App() {
  return (
    <AppDataProvider>
      <ToastProvider>
        <ThemeSync />
        <HashRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/train" element={<TrainPage />} />
            <Route path="/data" element={<DataPage />} />
            <Route path="/summary" element={<SummaryPage />} />
            <Route path="/me" element={<ProfilePage />} />
            <Route path="/live" element={<LiveWorkoutPage />} />
            <Route path="/import/confirm" element={<ImportConfirmPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </ToastProvider>
    </AppDataProvider>
  );
}
