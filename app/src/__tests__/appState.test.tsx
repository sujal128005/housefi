// Saving preferences: one write per change (even where React runs state updates twice), and quick back-to-back
// changes end with all of them saved.
import { act, render, waitFor } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { createMockBackend, memoryStore } from '../services/mock/MockBackend';
import { AppStateProvider, useAppState } from '../state/AppState';

// Sounds and vibration are not part of this (expo-audio has no native module under Jest).
jest.mock('../services/feedback', () => ({ setFeedbackEnabled: () => undefined, feedback: () => undefined }));

const PREFS_KEY = 'housefi.prefs.v1';

describe('app preferences', () => {
  it('writes once per change, outside the state update, and keeps the latest of quick changes', async () => {
    const store = memoryStore();
    const writes: string[] = [];
    const counted = {
      get: store.get,
      async set(k: string, v: string) {
        if (k === PREFS_KEY) writes.push(v);
        await store.set(k, v);
      },
      remove: store.remove,
    };
    const backend = createMockBackend({ store: memoryStore(), latency: [0, 0] });
    let app: ReturnType<typeof useAppState> | null = null;
    function Grab() {
      app = useAppState();
      return null;
    }
    await render(
      <StrictMode>
        <AppStateProvider store={counted} secrets={memoryStore()} backend={backend} deviceLocale="en">
          <Grab />
        </AppStateProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(app?.ready).toBe(true));
    const before = writes.length;
    await act(async () => {
      app?.setLocale('te');
      app?.setFeedback(false);
    });
    expect(writes.length - before).toBe(2);
    const saved = JSON.parse(store.data.get(PREFS_KEY) ?? '{}') as Record<string, unknown>;
    expect(saved).toMatchObject({ locale: 'te', feedback: false });
    expect(saved).not.toHaveProperty('token');
  });
});
