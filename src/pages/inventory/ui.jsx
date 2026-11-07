import { useState } from 'react'
import { Package, ChevronRight } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════
// Inventory design primitives (WOHKAH brand tokens from index.css).
// Quiet surfaces, hairline borders, 8px corners; the data is the only
// loud thing on the page.
// ═══════════════════════════════════════════════════════════════════

export const fmt = (v) => Number(v || 0).toLocaleString('en-NG')
// Whole naira — kobo adds noise to stock values
export const naira = (v) => `₦${Math.round(Number(v) || 0).toLocaleString('en-NG')}`
// ₦12.4M style for summary figures
export function nairaCompact(v) {
  const x = Number(v || 0)
  if (Math.abs(x) >= 1e9) return `₦${(x / 1e9).toFixed(1)}B`
  if (Math.abs(x) >= 1e6) return `₦${(x / 1e6).toFixed(1)}M`
  if (Math.abs(x) >= 1e4) return `₦${(x / 1e3).toFixed(0)}K`
  return naira(x)
}
export const pct = (x) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`

export function Panel({ title, subtitle, action, children, className = '', bodyClass = 'p-4', id }) {
  return (
    <section id={id} className={`bg-white border border-line rounded-lg shadow-[0_1px_2px_rgba(43,29,24,0.04)] ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3 border-b border-line">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold text-charcoal tracking-tight">{title}</h2>}
            {subtitle && <p className="text-xs text-mute mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

export function LinkButton({ children, onClick }) {
  return (
    <button onClick={onClick} className="text-xs font-semibold text-brand-ink hover:text-walnut inline-flex items-center gap-0.5">
      {children}<ChevronRight size={14} />
    </button>
  )
}

export function Btn({ variant = 'secondary', size = 'md', className = '', children, loading, disabled, ...props }) {
  const v = {
    primary: 'bg-brand text-walnut hover:bg-[#C48F00] border border-brand',
    dark: 'bg-walnut text-white hover:bg-[#3A2821] border border-walnut',
    secondary: 'bg-white text-charcoal border border-line-strong hover:bg-ivory',
    ghost: 'text-mute hover:text-charcoal hover:bg-ivory border border-transparent',
    danger: 'bg-white text-bad border border-[#F0C9C1] hover:bg-bad-wash',
  }[variant]
  const s = { sm: 'h-8 px-2.5 text-xs', md: 'h-9 px-3.5 text-[13px]', icon: 'h-9 w-9 justify-center' }[size]
  return (
    <button {...props} disabled={disabled || loading}
      className={`inline-flex items-center gap-1.5 rounded-md font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v} ${s} ${className}`}>
      {loading ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : null}
      {children}
    </button>
  )
}

// Compact select used in toolbars
export function ToolSelect({ value, onChange, children, label, className = '' }) {
  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} aria-label={label}
        className="h-9 w-full appearance-none rounded-md border border-line-strong bg-white pl-3 pr-8 text-[13px] text-charcoal focus:outline-none focus:border-brand">
        {children}
      </select>
      <svg className="pointer-events-none absolute right-2.5 h-4 w-4 text-faint" viewBox="0 0 20 20" fill="currentColor"><path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>
    </label>
  )
}

// Two-to-four option switch (not pills): a single bordered control
export function Segmented({ value, onChange, options, size = 'md' }) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto no-scrollbar rounded-md border border-line-strong bg-white p-0.5" role="tablist">
      {options.map(o => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={`${size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]'} shrink-0 whitespace-nowrap rounded font-medium transition-colors ${
            value === o.value ? 'bg-walnut text-white' : 'text-mute hover:text-charcoal'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ProductThumb({ src, name, size = 36 }) {
  const [failed, setFailed] = useState(false)
  const style = { width: size, height: size }
  if (src && !failed) {
    return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} style={style}
      className="rounded-md object-cover bg-ivory border border-line shrink-0" />
  }
  const initials = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return (
    <div style={style} aria-hidden className="rounded-md bg-ivory border border-line shrink-0 flex items-center justify-center text-[11px] font-semibold text-mute">
      {initials || <Package size={14} />}
    </div>
  )
}

// Small status label — always icon/dot + text, never colour alone
export function Tag({ tone = 'neutral', children }) {
  const t = {
    neutral: 'bg-ivory text-mute border-line',
    good: 'bg-good-wash text-good border-[#CFE3D7]',
    bad: 'bg-bad-wash text-bad border-[#F0C9C1]',
    warn: 'bg-brand-wash text-brand-ink border-[#F0DFAE]',
    dark: 'bg-walnut text-white border-walnut',
  }[tone]
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold leading-none whitespace-nowrap ${t}`}>{children}</span>
}

export function Dot({ color }) {
  return <span aria-hidden className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
}

// Horizontal magnitude bar (single series → no legend; value printed beside)
export function Bar({ value, max, color = 'var(--color-brand)', height = 8 }) {
  const w = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div className="w-full rounded-[2px] bg-[#F2EEE8]" style={{ height }}>
      {w > 0 && <div className="h-full rounded-r-[4px]" style={{ width: `${Math.max(w * 100, 1.5)}%`, background: color }} />}
    </div>
  )
}

// One whole split into parts, with 2px gaps between parts.
// parts: [{ label, value, color }]. Title attr carries name · amount · share.
export function SegmentBar({ parts, height = 10 }) {
  const total = parts.reduce((a, p) => a + (p.value || 0), 0)
  if (total <= 0) return <div className="w-full rounded-full bg-[#F2EEE8]" style={{ height }} />
  const shown = parts.filter(p => p.value > 0)
  return (
    <div className="flex w-full gap-[2px]" style={{ height }} role="img"
      aria-label={shown.map(p => `${p.label} ${fmt(p.value)} (${pct(p.value / total)})`).join(', ')}>
      {shown.map((p, i) => (
        <div key={p.label} title={`${p.label}: ${fmt(p.value)} · ${pct(p.value / total)}`}
          className={`h-full ${i === 0 ? 'rounded-l-full' : ''} ${i === shown.length - 1 ? 'rounded-r-full' : ''}`}
          style={{ width: `${(p.value / total) * 100}%`, minWidth: 3, background: p.color }} />
      ))}
    </div>
  )
}

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-xs text-mute">
          <Dot color={i.color} />{i.label}
          {i.value != null && <span className="font-semibold text-charcoal tnum">{i.value}</span>}
        </span>
      ))}
    </div>
  )
}

export function EmptyNote({ icon, title, children }) {
  return (
    <div className="py-10 px-4 text-center">
      {icon && <div className="mx-auto mb-2 w-10 h-10 rounded-full bg-ivory border border-line flex items-center justify-center text-faint">{icon}</div>}
      <p className="text-sm font-semibold text-charcoal">{title}</p>
      {children && <p className="text-xs text-mute mt-1 max-w-sm mx-auto">{children}</p>}
    </div>
  )
}

export function SetupNote({ what }) {
  return (
    <div className="rounded-lg border border-[#F0DFAE] bg-brand-wash p-4 text-sm text-walnut">
      <p className="font-semibold">{what} is not set up yet</p>
      <p className="text-xs mt-1">Run <span className="font-mono">supabase/inventory_v2.sql</span> in the Supabase SQL editor.</p>
    </div>
  )
}

// Sortable column header
export function SortTh({ label, k, sort, setSort, align = 'right', className = '' }) {
  const active = sort.key === k
  return (
    <th scope="col" className={`px-3 py-2.5 font-medium ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      <button onClick={() => setSort({ key: k, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
        className={`inline-flex items-center gap-1 hover:text-charcoal ${active ? 'text-charcoal' : ''}`}>
        {label}
        <span aria-hidden className={`text-[10px] ${active ? 'opacity-100' : 'opacity-0'}`}>{sort.dir === 'asc' ? '▲' : '▼'}</span>
      </button>
    </th>
  )
}

export const COLORS = {
  good: 'var(--color-good)',
  bad: 'var(--color-bad)',
  transit: 'var(--color-transit)',
  inspection: '#9A918A',
  brand: 'var(--color-brand)',
}
