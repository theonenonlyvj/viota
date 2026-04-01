import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import VoteBanner from './VoteBanner'

test('renders disconnected player name', () => {
  render(
    <VoteBanner
      disconnectedPlayerName="Bob"
      onVote={vi.fn()}
      votesReceived={0}
      totalVoters={2}
    />
  )
  expect(screen.getByText(/Bob disconnected/)).toBeInTheDocument()
})

test('renders vote buttons', () => {
  render(
    <VoteBanner
      disconnectedPlayerName="Bob"
      onVote={vi.fn()}
      votesReceived={0}
      totalVoters={2}
    />
  )
  expect(screen.getByText('Wait')).toBeInTheDocument()
  expect(screen.getByText('AI Easy')).toBeInTheDocument()
  expect(screen.getByText('AI Expert')).toBeInTheDocument()
})

test('clicking Wait calls onVote with wait', async () => {
  const onVote = vi.fn()
  render(
    <VoteBanner disconnectedPlayerName="Bob" onVote={onVote} votesReceived={0} totalVoters={2} />
  )
  await userEvent.click(screen.getByText('Wait'))
  expect(onVote).toHaveBeenCalledWith('wait')
})

test('clicking AI Expert calls onVote with expert', async () => {
  const onVote = vi.fn()
  render(
    <VoteBanner disconnectedPlayerName="Bob" onVote={onVote} votesReceived={0} totalVoters={2} />
  )
  await userEvent.click(screen.getByText('AI Expert'))
  expect(onVote).toHaveBeenCalledWith('expert')
})

test('shows vote tally', () => {
  render(
    <VoteBanner disconnectedPlayerName="Bob" onVote={vi.fn()} votesReceived={1} totalVoters={3} />
  )
  expect(screen.getByText('1/3 voted')).toBeInTheDocument()
})

test('aiTakeover mode shows informational banner', () => {
  render(
    <VoteBanner disconnectedPlayerName="Bob" aiTakeover={{ difficulty: 'expert' }} />
  )
  expect(screen.getByText(/AI \(expert\) playing for Bob/)).toBeInTheDocument()
})
