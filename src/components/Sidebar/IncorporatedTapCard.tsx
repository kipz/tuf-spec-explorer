interface Props {
  tap: { tap: number; title: string; status: string; summary: string }
}

export function IncorporatedTapCard({ tap }: Props) {
  return (
    <div className="incorporated-tap-card">
      <div className="tap-card-header">
        <span className="tap-number">TAP {tap.tap}</span>
        <span className="tap-title">{tap.title}</span>
        <span className="badge badge-final">Final</span>
      </div>
      <div className="tap-summary">{tap.summary}</div>
    </div>
  )
}
