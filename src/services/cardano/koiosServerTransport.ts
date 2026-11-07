type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

const KOIOS_WINDOW_MS = 10_000
const KOIOS_SERVER_MAX_IN_WINDOW = 80

export function createKoiosServerTransport(
  fetcher: Fetcher,
  options?: { windowMs?: number; maxInWindow?: number },
): Fetcher {
  const windowMs = options?.windowMs ?? KOIOS_WINDOW_MS
  const maxInWindow = options?.maxInWindow ?? KOIOS_SERVER_MAX_IN_WINDOW
  const grants: number[] = []
  const waiters: Array<() => void> = []
  let pumpTimer: ReturnType<typeof setTimeout> | null = null

  function prune(now: number) {
    while (grants.length > 0 && grants[0]! <= now - windowMs) {
      grants.shift()
    }
  }

  function pump() {
    pumpTimer = null
    const now = Date.now()
    prune(now)

    while (waiters.length > 0 && grants.length < maxInWindow) {
      grants.push(Date.now())
      waiters.shift()!()
    }

    if (waiters.length > 0 && pumpTimer === null) {
      const delay = Math.max(25, grants[0]! + windowMs - Date.now())
      pumpTimer = setTimeout(pump, delay)
    }
  }

  async function acquireSlot(): Promise<void> {
    await new Promise<void>((resolve) => {
      waiters.push(resolve)
      pump()
    })
  }

  return async (input, init) => {
    await acquireSlot()
    return fetcher(input, init)
  }
}

export const serverKoiosFetch = createKoiosServerTransport((input, init) =>
  fetch(input, init),
)
