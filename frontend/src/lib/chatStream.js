import { ApiError } from './errors.js';

/** Decode arbitrary UTF-8/network chunks, never treating a partial plan as final. */
export async function readChatStream(response, onProgress) {
  if (!response.body) throw new ApiError('Buddy returned an empty response. Please retry.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      if (done && buffer.trim()) lines.push(buffer);
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'error') throw new ApiError(event.message, { code: event.code });
        if (event.type === 'result') {
          if (!Array.isArray(event.messages) || !Array.isArray(event.preference_calls) || !event.plan) throw new ApiError('Buddy returned an incomplete calendar. Please retry.');
          return event;
        }
        if (event.type === 'status' || event.type === 'proposal') onProgress?.(event);
      }
      if (done) throw new ApiError('The connection ended before Buddy finished. Your calendar is unchanged. Please retry.', { code: 'stream_interrupted' });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
