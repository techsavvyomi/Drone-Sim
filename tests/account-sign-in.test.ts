import { describe, expect, it, vi } from 'vitest';
import { BackendService, type BackendServiceDeps } from '../src/main/backend/service';

// The first Activate on a slow backend used to fail with "Could not reach the
// server" while the server finished the activation anyway; the second click was
// then a login and worked. A sign-in that gets no answer is now sent once more.

const AUTH = {
  success: true as const,
  data: {
    userId: 'USR-000001',
    authToken: 'tok',
    profile: { userId: 'USR-000001', level: 1, levelPoints: { current: 0, next: 500 }, stats: {} },
    existingUser: false,
  },
};
const LOST = { success: false as const, code: 'NETWORK' as const, message: 'no answer' };

function service(send: BackendServiceDeps['send']) {
  return new BackendService({
    configured: true,
    send,
    loadAccounts: async () => null,
    saveAccounts: async () => {},
    loadOutbox: async () => null,
    saveOutbox: async () => {},
    codec: { available: () => false, encrypt: (s) => s, decrypt: (s) => s },
    device: async () => ({ deviceId: 'device-aaaaaaaaaaaaaaaa', deviceName: 'PC' }),
    notify: () => {},
  });
}

const REQ = { name: 'A', email: 'a@example.com', activationKey: 'PLUTO-SIM-AAAA-AAAA' };

describe('sign-in retry', () => {
  it('sends an activation that got no answer once more, and succeeds', async () => {
    const send = vi.fn().mockResolvedValueOnce(LOST).mockResolvedValueOnce(AUTH);
    const res = await service(send as never).activate(REQ);
    expect(res.success).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retries a login the same way', async () => {
    const send = vi.fn().mockResolvedValueOnce(LOST).mockResolvedValueOnce(AUTH);
    const res = await service(send as never).login({ email: REQ.email, activationKey: REQ.activationKey });
    expect(res.success).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retries only once', async () => {
    const send = vi.fn().mockResolvedValue(LOST);
    const res = await service(send as never).activate(REQ);
    expect(res).toMatchObject({ success: false, code: 'NETWORK' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not retry an answer, even a refusal', async () => {
    const send = vi.fn().mockResolvedValue({ success: false, code: 'KEY_NOT_FOUND', message: 'no' });
    await service(send as never).activate(REQ);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
