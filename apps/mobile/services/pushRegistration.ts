import { API_BASE_URL } from '@/config/env';

export interface RegisterPushArgs {
  deviceId: string;
  token: string;
  settings: {
    walkMinutes: number;
    notifBufferMin: number;
    preferredStopId: string;
    quietStartMin: number;
    quietEndMin: number;
  };
  signal?: AbortSignal;
}

export interface RegisterPushResult {
  ok: true;
  deviceId: string;
  registeredAt: number;
}

export async function registerPushToken(
  args: RegisterPushArgs,
): Promise<RegisterPushResult> {
  const res = await fetch(`${API_BASE_URL}/api/push/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: args.deviceId,
      token: args.token,
      settings: args.settings,
    }),
    signal: args.signal,
  });
  if (!res.ok) {
    const detail = await safeText(res);
    throw new Error(`register failed ${res.status}: ${detail}`);
  }
  return (await res.json()) as RegisterPushResult;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
