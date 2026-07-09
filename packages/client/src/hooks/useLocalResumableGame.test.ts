import { renderHook } from '@testing-library/react'
import { useLocalResumableGame } from './useLocalResumableGame'

test('stub returns null (no local resume until the persistence agent wires it)', () => {
  const { result } = renderHook(() => useLocalResumableGame())
  expect(result.current).toBeNull()
})
