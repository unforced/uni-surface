import { useEffect, useState, useCallback, useRef } from 'react'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: unknown
  reload: () => void
}

// Run an async loader, re-running when `deps` change.
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [nonce, setNonce] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    loaderRef
      .current()
      .then((d) => {
        if (live) {
          setData(d)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (live) {
          setError(e)
          setLoading(false)
        }
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, loading, error, reload }
}
