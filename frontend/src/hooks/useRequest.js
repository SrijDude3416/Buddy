import { useCallback, useEffect, useRef, useState } from 'react';
import { isAborted } from '../lib/errors.js';

/**
 * Generic async-request state machine: status, data, error, and a run() that
 * aborts any in-flight call first. Used for every one-shot request so loading
 * and error handling look the same everywhere.
 */
export function useRequest(fn, { immediate = false, args = [] } = {}) {
  const [status, setStatus] = useState(immediate ? 'loading' : 'idle');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const controllerRef = useRef(null);
  const mountedRef = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const run = useCallback(async (...callArgs) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setStatus('loading');
    setError(null);
    try {
      const result = await fnRef.current(...callArgs, { signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return null;
      setData(result);
      setStatus('success');
      return result;
    } catch (err) {
      if (isAborted(err) || !mountedRef.current) return null;
      setError(err);
      setStatus('error');
      return null;
    }
  }, []);

  useEffect(() => {
    if (immediate) run(...args);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate, run]);

  return {
    status,
    data,
    error,
    run,
    isLoading: status === 'loading',
    isError: status === 'error',
    isSuccess: status === 'success',
    reset: () => {
      setStatus('idle');
      setData(null);
      setError(null);
    },
  };
}
