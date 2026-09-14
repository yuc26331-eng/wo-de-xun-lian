import { NavLink } from 'react-router-dom';
import {
  IconChart,
  IconDoc,
  IconDumbbell,
  IconHome,
  IconPerson,
} from './icons';
import { useAppData } from '../state/AppData';

const TABS: { to: string; label: string; Icon: typeof IconHome; key: string }[] = [
  { to: '/', label: '首页', Icon: IconHome, key: 'home' },
  { to: '/train', label: '训练', Icon: IconDumbbell, key: 'train' },
  { to: '/data', label: '数据', Icon: IconChart, key: 'data' },
  { to: '/summary', label: '总结', Icon: IconDoc, key: 'summary' },
  { to: '/me', label: '我的', Icon: IconPerson, key: 'me' },
];

export function TabBar() {
  const { liveSession } = useAppData();
  const hasActive = liveSession?.status === 'active' || liveSession?.status === 'paused';

  return (
    <nav className="tabbar no-print" aria-label="主导航">
      {TABS.map(({ to, label, Icon, key }) => (
        <NavLink
          key={key}
          to={to}
          end={to === '/'}
          className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}
        >
          <span style={{ position: 'relative', display: 'flex' }}>
            <Icon />
            {key === 'train' && hasActive && <i className="tab-dot" />}
          </span>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
