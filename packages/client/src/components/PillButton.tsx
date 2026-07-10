type Props = { active: boolean; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>

export default function PillButton({ active, children, style, ...rest }: Props) {
  return (
    <button
      type="button"
      className="modal-pill"
      aria-pressed={active}
      style={{
        background: active ? 'rgba(34,211,238,.18)' : 'rgba(255,255,255,.06)',
        border: active ? '1.5px solid var(--brand-cyan)' : '1.5px solid rgba(255,255,255,.2)',
        color: '#fff', clipPath: 'var(--chamfer)', padding: '8px 16px', cursor: 'pointer',
        fontFamily: 'Fredoka', fontWeight: 500, fontSize: 14, ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  )
}
