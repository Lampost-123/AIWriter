// The fake speech server's engine routes (the Speech engine part fills these in to match the real server).
export const routes = {
  'GET /v1/health': () => ({ body: { ok: true } })
}
