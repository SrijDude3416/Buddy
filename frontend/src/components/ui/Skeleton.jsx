/** Placeholder rows that match the real card geometry, so nothing jumps on load. */
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-stone-200 dark:bg-stone-800 rounded ${className}`} />;
}

export function SessionCardSkeleton() {
  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl px-4 py-3 flex items-center gap-3">
      <Skeleton className="w-2.5 h-2.5 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-2.5 w-1/3" />
      </div>
    </div>
  );
}

export function PlanSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading your plan">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-3 w-44" />
      </div>
      <div className="space-y-2">
        <SessionCardSkeleton />
        <SessionCardSkeleton />
        <SessionCardSkeleton />
      </div>
    </div>
  );
}
