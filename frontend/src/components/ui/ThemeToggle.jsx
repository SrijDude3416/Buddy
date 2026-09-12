import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../../state/ThemeProvider.jsx';

const OPTIONS = [
  { key: 'light', Icon: Sun, label: 'Light' },
  { key: 'dark', Icon: Moon, label: 'Dark' },
  { key: 'system', Icon: Monitor, label: 'System' },
];

export function ThemeToggle() {
  const { preference, choose } = useTheme();

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-center gap-0.5 bg-stone-200 dark:bg-stone-800 rounded-lg p-0.5"
    >
      {OPTIONS.map(({ key, Icon, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => choose(key)}
          title={label}
          aria-label={label}
          aria-pressed={preference === key}
          className={`p-1.5 rounded-md transition-colors ${
            preference === key
              ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm'
              : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'
          }`}
        >
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}
