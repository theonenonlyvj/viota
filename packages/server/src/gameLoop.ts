// The game loop now lives in @viota/engine as the single source of truth, so
// the server and client can never drift apart. Re-exported here to keep the
// existing import paths (wsHandler, tests) stable.
export { initGame, applyPlay, applyPass, applyWildRecycle } from '@viota/engine'
