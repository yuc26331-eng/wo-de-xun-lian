import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { clamp, safeNum } from '../lib/format';
import { IconChevron, IconClose, IconMinus, IconPlus } from './icons';

/* ------------------------------------------------------------- 基础容器 */

export function Card({
  children,
  className = '',
  onClick,
  flat,
  style,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  flat?: boolean;
  style?: CSSProperties;
}) {
  const cls = ['card', flat ? 'flat' : '', onClick ? 'tap' : '', className]
    .filter(Boolean)
    .join(' ');
  if (onClick) {
    return (
      <div className={cls} style={style} onClick={onClick} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onClick()}>
        {children}
      </div>
    );
  }
  return <div className={cls} style={style}>{children}</div>;
}

export function SectionTitle({
  children,
  action,
  onAction,
}: {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-title">
      <span>{children}</span>
      {action && (
        <button className="link" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  emoji = '📭',
  title,
  desc,
  action,
}: {
  emoji?: string;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="emoji">{emoji}</span>
      <div className="strong" style={{ color: 'var(--text)', fontSize: 16 }}>
        {title}
      </div>
      {desc && <div className="small" style={{ marginTop: 6 }}>{desc}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- 按钮 */

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'success' | 'plain';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  block?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  type?: 'button' | 'submit';
  'data-testid'?: string;
};

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  block,
  disabled,
  className = '',
  style,
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = [
    'btn',
    variant === 'default' ? '' : variant,
    size === 'md' ? '' : size,
    block ? 'block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} style={style} onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------- 表单 */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="tiny muted">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  inputMode,
  max,
  min,
  step,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: 'text' | 'decimal' | 'numeric' | 'tel' | 'email' | 'url';
  max?: number;
  min?: number;
  step?: number;
  testId?: string;
}) {
  return (
    <input
      className="input"
      value={value}
      type={type}
      inputMode={inputMode}
      placeholder={placeholder}
      max={max}
      min={min}
      step={step}
      data-testid={testId}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}

/** 数字输入：中文数字键盘友好，空值安全 */
export function NumberInput({
  value,
  onChange,
  placeholder,
  dec = 1,
  testId,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
  dec?: number;
  testId?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    setText(value == null ? '' : String(value));
  }, [value]);
  return (
    <input
      className="input"
      inputMode={dec > 0 ? 'decimal' : 'numeric'}
      value={text}
      placeholder={placeholder}
      data-testid={testId}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = safeNum(raw);
        onChange(n == null ? null : dec > 0 ? n : Math.round(n));
      }}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  testId?: string;
}) {
  return (
    <textarea
      className="textarea"
      value={value}
      rows={rows}
      placeholder={placeholder}
      data-testid={testId}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  testId,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  testId?: string;
}) {
  return (
    <select
      className="select"
      value={value}
      data-testid={testId}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 999,
  dec = 0,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  dec?: number;
  suffix?: string;
}) {
  const set = (v: number) => onChange(clamp(Number(v.toFixed(dec)), min, max));
  return (
    <div className="stepper">
      <button aria-label="减少" onClick={() => set(value - step)}>
        <IconMinus width={18} height={18} />
      </button>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <input
          inputMode={dec > 0 ? 'decimal' : 'numeric'}
          value={String(value)}
          onChange={(e) => {
            const n = safeNum(e.target.value);
            if (n != null) set(n);
          }}
        />
        {suffix && <span className="tiny muted" style={{ paddingRight: 8 }}>{suffix}</span>}
      </div>
      <button aria-label="增加" onClick={() => set(value + step)}>
        <IconPlus width={18} height={18} />
      </button>
    </div>
  );
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`switch ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    />
  );
}

/* ------------------------------------------------------------- 底部弹层 */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet pop" role="dialog" aria-modal="true">
        <div className="sheet-grabber" />
        <div className="row-between" style={{ marginBottom: 10 }}>
          <h2 className="sheet-title" style={{ margin: 0 }}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <IconClose width={20} height={20} />
          </button>
        </div>
        {children}
        {footer && <div style={{ marginTop: 16 }}>{footer}</div>}
      </div>
    </>
  );
}

/* ------------------------------------------------------------- 提示 */

type Toast = { id: number; text: string; kind: 'info' | 'error' | 'success' };

const ToastContext = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, text, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 4200 : 2400);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-host">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------- 展示 */

export function Stat({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Chip({
  children,
  tone = 'default',
  style,
}: {
  children: ReactNode;
  tone?: 'default' | 'accent' | 'green' | 'orange' | 'red' | 'purple';
  style?: CSSProperties;
}) {
  return (
    <span className={`chip ${tone === 'default' ? '' : tone}`} style={style}>
      {children}
    </span>
  );
}

export function Bar({ value, max = 1, tone }: { value: number; max?: number; tone?: 'green' }) {
  const pct = max <= 0 ? 0 : clamp((value / max) * 100, 0, 100);
  return (
    <div className={`bar ${tone ?? ''}`}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ListRow({
  left,
  title,
  sub,
  value,
  onClick,
  right,
  testId,
}: {
  left?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  right?: ReactNode;
  testId?: string;
}) {
  const content = (
    <>
      {left}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="strong truncate" style={{ fontSize: 15.5 }}>{title}</div>
        {sub && <div className="tiny muted truncate" style={{ marginTop: 1 }}>{sub}</div>}
      </div>
      {value != null && <div className="value">{value}</div>}
      {right}
      {onClick && (
        <span className="chev">
          <IconChevron width={18} height={18} />
        </span>
      )}
    </>
  );
  if (onClick) {
    return (
      <button className="list-row tap" onClick={onClick} data-testid={testId}>
        {content}
      </button>
    );
  }
  return <div className="list-row" data-testid={testId}>{content}</div>;
}

export function Ring({
  progress,
  size = 176,
  stroke = 12,
  children,
  tone = 'var(--accent)',
}: {
  progress: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  tone?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = clamp(progress, 0, 1);
  return (
    <div className="rest-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--card-2)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={tone}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c}`}
          strokeDashoffset={`${c * (1 - p)}`}
          style={{ transition: 'stroke-dashoffset 0.35s linear' }}
        />
      </svg>
      <div className="rest-ring-label">{children}</div>
    </div>
  );
}

export function Confirm({
  open,
  title,
  message,
  confirmText = '确认',
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet open={open} onClose={onCancel} title={title}>
      {message && <p className="muted" style={{ marginTop: 0 }}>{message}</p>}
      <div className="col" style={{ gap: 10 }}>
        <Button block variant={danger ? 'danger' : 'primary'} size="lg" onClick={onConfirm}>
          {confirmText}
        </Button>
        <Button block size="lg" onClick={onCancel}>
          取消
        </Button>
      </div>
    </Sheet>
  );
}
