export function BotBubble({ text }) {
  return (
    <div className="flex items-start gap-2">
      <div className="w-7 h-7 rounded-full bg-emerald-700 flex items-center justify-center text-white text-xs shrink-0 mt-0.5">
        B
      </div>
      <div className="bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm max-w-[85%] text-stone-900 dark:text-stone-100">
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
