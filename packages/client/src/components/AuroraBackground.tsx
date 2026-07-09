export default function AuroraBackground({ children }: { children: React.ReactNode }) {
  return (
    <div className="aurora">
      <div className="aurora__grain" aria-hidden />
      <div className="aurora__vignette" aria-hidden />
      <div className="aurora__content">{children}</div>
    </div>
  )
}
