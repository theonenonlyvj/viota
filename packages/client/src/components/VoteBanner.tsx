type Props =
  | {
      disconnectedPlayerName: string
      onVote: (choice: string) => void
      votesReceived: number
      totalVoters: number
      aiTakeover?: never
    }
  | {
      disconnectedPlayerName: string
      aiTakeover: { difficulty: string }
      onVote?: never
      votesReceived?: never
      totalVoters?: never
    }

const bannerStyle: React.CSSProperties = {
  background: '#1e1e3a',
  border: '1px solid #7c3aed',
  borderRadius: 8,
  padding: '10px 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexShrink: 0,
}

const voteBtn: React.CSSProperties = {
  background: '#2a2a4a',
  border: '1px solid #3a3a5a',
  color: '#e2e8f0',
  borderRadius: 6,
  padding: '5px 12px',
  fontSize: 12,
  cursor: 'pointer',
}

export default function VoteBanner(props: Props) {
  if (props.aiTakeover) {
    return (
      <div style={bannerStyle}>
        <span style={{ color: '#c084fc', fontSize: 13 }}>
          AI ({props.aiTakeover.difficulty}) playing for {props.disconnectedPlayerName}
        </span>
      </div>
    )
  }

  return (
    <div style={bannerStyle}>
      <span style={{ color: '#ef4444', fontSize: 13 }}>{props.disconnectedPlayerName} disconnected</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={voteBtn} onClick={() => props.onVote('wait')}>Wait</button>
        <button style={voteBtn} onClick={() => props.onVote('easy')}>AI Easy</button>
        <button style={voteBtn} onClick={() => props.onVote('expert')}>AI Expert</button>
      </div>
      {props.totalVoters > 0 && (
        <span style={{ color: '#9ca3af', fontSize: 11 }}>{props.votesReceived}/{props.totalVoters} voted</span>
      )}
    </div>
  )
}
