/**
 * SEAM (owned by this branch; body owned by the local-persistence agent).
 * Return the in-progress local (vs-AI) game if one exists, else null.
 * Contract is the return TYPE — the persistence agent fills the body
 * (read localStorage). Keying off the device credential is fine; no sign-in
 * required (a local game is device-local). See spec §5A.
 */
export function useLocalResumableGame(): { lastActivityAt: number } | null {
  return null
}
