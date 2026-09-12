import { RefreshCw } from 'lucide-react';

/**
 * One error surface for the whole app. Shows the real message rather than a
 * generic apology, and only offers retry when the error is actually retryable.
 */
export function ErrorNotice({ error, onRetry, title = 'Something went wrong', compact = false }) {
  if (!error) return null;
  const retryable = error.retryable !== false;

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
        <p className="text-xs text-amber-900 dark:text-amber-200">{error.message}</p>
        {onRetry && retryable && (
          <button type="button" onClick={onRetry} className="text-xs font-medium text-amber-900 dark:text-amber-200 underline shrink-0">
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl px-4 py-5 space-y-3">
      <p className="font-serif text-lg text-stone-900 dark:text-stone-100">{title}</p>
      <p className="text-sm text-stone-600 dark:text-stone-300">{error.message}</p>
      {error.status ? <p className="text-xs text-stone-400 dark:text-stone-500">Status {error.status} · {error.code}</p> : null}
      {onRetry && retryable && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm"
        >
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
      )}
    </div>
  );
}
