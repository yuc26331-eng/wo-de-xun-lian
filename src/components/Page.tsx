import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconBack } from './icons';
import { TabBar } from './TabBar';

export function Page({
  title,
  sub,
  right,
  children,
  back,
  hideTab,
  className = '',
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  back?: boolean;
  hideTab?: boolean;
  className?: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="app">
      <header className={`nav-header ${scrolled ? 'scrolled' : ''}`}>
        <div className="nav-header-inner">
          {back && (
            <button
              className="icon-btn"
              aria-label="返回"
              style={{ marginLeft: -10 }}
              onClick={() => navigate(-1)}
            >
              <IconBack width={22} height={22} />
            </button>
          )}
          <div className="grow" style={{ minWidth: 0 }}>
            <h1 className="nav-title">{title}</h1>
            {sub && <p className="nav-sub">{sub}</p>}
          </div>
          {right}
        </div>
      </header>
      <main className={`app-scroll ${hideTab ? 'no-nav' : ''} ${className}`}>{children}</main>
      {!hideTab && <TabBar />}
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to}>{children}</Link>;
}
