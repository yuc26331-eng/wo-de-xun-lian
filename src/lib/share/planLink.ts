/** URL 片段中的计划载荷：只在浏览器本地读取，不会随请求发送到服务器。 */
import type { TrainingPlan } from '../../types';

interface PlanLinkPayload {
  v: 1;
  plan: TrainingPlan;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function isPlan(value: unknown): value is TrainingPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<TrainingPlan>;
  return (
    typeof plan.id === 'string' &&
    typeof plan.title === 'string' &&
    typeof plan.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(plan.date) &&
    typeof plan.kind === 'string' &&
    Array.isArray(plan.warmup) &&
    Array.isArray(plan.exercises) &&
    plan.exercises.every(
      (exercise) =>
        exercise &&
        typeof exercise.id === 'string' &&
        typeof exercise.name === 'string' &&
        typeof exercise.kind === 'string' &&
        typeof exercise.target === 'object',
    )
  );
}

export function encodePlanLink(plan: TrainingPlan): string {
  const payload: PlanLinkPayload = { v: 1, plan };
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodePlanLink(token: string): TrainingPlan {
  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(token))) as Partial<PlanLinkPayload>;
  if (payload.v !== 1 || !isPlan(payload.plan)) {
    throw new Error('训练计划链接无效或内容不完整');
  }
  return payload.plan;
}
