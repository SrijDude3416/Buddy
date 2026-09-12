export function PillTabs({ tabs, value, onChange, className = '' }) {
  return (
    <div className={`flex items-center gap-1 bg-stone-200 dark:bg-stone-800 rounded-lg p-1 w-fit ${className}`}>
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            value === key ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm' : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
