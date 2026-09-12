import OpenAI from "openai";
import type { PreferenceOperation, ScheduleInterpretation } from "./types";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const strength = ["gentle", "moderate", "firm"];
const tools: OpenAI.Responses.Tool[] = [
  { type: "function", name: "set_preferred_work_hours", description: "Set the singleton daily preferred work window.", parameters: { type: "object", properties: { start_time: { type: "string" }, end_time: { type: "string" }, strength: { type: "string", enum: strength } }, required: ["start_time", "end_time"] }, strict: false },
  { type: "function", name: "set_daily_workload_limit", description: "Set a daily work cap; omit days for every day.", parameters: { type: "object", properties: { minutes_per_day: { type: "integer", minimum: 30, maximum: 900 }, days: { type: "array", items: { type: "string", enum: days } }, strength: { type: "string", enum: strength } }, required: ["minutes_per_day"] }, strict: false },
  { type: "function", name: "protect_time_block", description: "Hard-protect a recurring block from schoolwork.", parameters: { type: "object", properties: { days: { type: "array", items: { type: "string", enum: days }, minItems: 1 }, start_time: { type: "string" }, end_time: { type: "string" } }, required: ["days", "start_time", "end_time"] }, strict: false },
  { type: "function", name: "set_break_habits", description: "Set the singleton soft break habit.", parameters: { type: "object", properties: { break_minutes: { type: "integer", minimum: 15, maximum: 120 }, strength: { type: "string", enum: strength } } }, strict: false },
  { type: "function", name: "remove_preference", description: "Remove one active preference.", parameters: { type: "object", properties: { preference_type: { type: "string", enum: ["preferred_work_hours", "daily_workload_limit", "protected_time_block", "break_habits"] }, match: { type: "object", additionalProperties: true } }, required: ["preference_type"] }, strict: false },
  { type: "function", name: "list_current_preferences", description: "List active preferences.", parameters: { type: "object", properties: {} }, strict: false },
];

export async function interpretScheduleInput(input: string): Promise<ScheduleInterpretation> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).responses.create({ model: process.env.OPENAI_MODEL ?? "gpt-5-mini", input, tools, tool_choice: "auto", store: false });
  const operations = response.output.filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call").map((item) => ({ name: item.name, arguments: JSON.parse(item.arguments) })) as PreferenceOperation[];
  return { chatResponse: response.output_text || (operations.length ? "I’ve prepared those preference updates." : "I can’t express that request with the available preferences."), operations, debug: { openaiResponse: response } };
}
