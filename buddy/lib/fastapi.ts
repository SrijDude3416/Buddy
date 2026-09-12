import type { OptimizerRun, PreferenceOperation, PreferenceWriteResult, SchedulePlan } from "./types";
function baseUrl() { if (!process.env.FASTAPI_BASE_URL) throw new Error("FASTAPI_BASE_URL is not configured."); return process.env.FASTAPI_BASE_URL.replace(/\/$/, ""); }
async function api<T>(path: string, init?: RequestInit) { const response = await fetch(`${baseUrl()}${path}`, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } }); if (!response.ok) throw new Error(`FastAPI ${init?.method ?? "GET"} ${path} failed (${response.status}).`); return response.json() as Promise<T>; }
export const applyPreferenceOperations = (operations: PreferenceOperation[]) => api<PreferenceWriteResult>(process.env.FASTAPI_PREFERENCES_PATH ?? "/preferences/operations", { method: "POST", body: JSON.stringify({ operations }) });
export const createOptimizerRun = () => api<OptimizerRun>("/optimizer/runs", { method: "POST" });
export const getOptimizerRun = (id: string) => api<OptimizerRun>(`/optimizer/runs/${encodeURIComponent(id)}`);
export const getPlan = () => api<SchedulePlan>("/plan");
