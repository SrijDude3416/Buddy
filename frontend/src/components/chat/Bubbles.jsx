import { BuddyMark } from '../ui/Brand.jsx';

export function BotBubble({ text }) {
  return (
    <div className="flex items-start gap-2">
      <BuddyMark className="w-7 h-7 text-xs rounded-lg mt-0.5" />
      <div className="bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm max-w-[85%] text-stone-900 dark:text-stone-100 shadow-sm shadow-stone-900/5">
        {text}
      </div>
    </div>
  );
}

export function UserBubble({ text }) {
  return (
    <div className="flex justify-end">
      <div className="bg-emerald-700 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm max-w-[85%]">{text}</div>
    </div>
  );
}
