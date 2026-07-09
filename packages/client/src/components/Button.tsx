type Props = {
  variant: 'primary' | 'secondary'
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>

export default function Button({ variant, children, className = '', type = 'button', ...rest }: Props) {
  return (
    <button type={type} className={`viota-btn viota-btn--${variant}${className ? ` ${className}` : ''}`} {...rest}>
      <span className="viota-btn__face">{children}</span>
    </button>
  )
}
