type Props = {
  variant: 'primary' | 'secondary'
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>

export default function Button({ variant, children, className = '', ...rest }: Props) {
  return (
    <button className={`viota-btn viota-btn--${variant} ${className}`} {...rest}>
      <span className="viota-btn__face">{children}</span>
    </button>
  )
}
