// The booking being put together, step by step, before it is paid. Lives in memory only.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PaymentMethod, Photo, ProblemDescription, VisitTime, VoiceNote } from '../domain/types';

export const MAX_PHOTOS = 4;

export interface Draft {
  readonly serviceId: string | null;
  readonly problem: ProblemDescription;
  readonly addressId: string | null;
  readonly time: VisitTime | null;
  readonly preferWomenRated: boolean;
  readonly method: PaymentMethod;
}

interface DraftActions {
  /** Starts (or continues) a booking for a service; `issueId` pre-selects a problem (Home quick picks). */
  readonly start: (serviceId: string, issueId?: string) => void;
  readonly toggleIssue: (issueId: string) => void;
  readonly setNotes: (notes: string) => void;
  readonly setVoiceNote: (v: VoiceNote | null) => void;
  readonly addPhoto: (p: Photo) => void;
  readonly removePhoto: (id: string) => void;
  readonly setAddress: (id: string | null) => void;
  readonly setTime: (t: VisitTime | null) => void;
  readonly setPreferWomenRated: (v: boolean) => void;
  readonly setMethod: (m: PaymentMethod) => void;
  readonly clear: () => void;
}

interface DraftValue extends DraftActions {
  readonly draft: Draft;
}

const EMPTY_PROBLEM: ProblemDescription = { issueIds: [], notes: '', voiceNote: null, photos: [] };
const EMPTY: Draft = { serviceId: null, problem: EMPTY_PROBLEM, addressId: null, time: null, preferWomenRated: false, method: 'UPI' };

const Ctx = createContext<DraftValue | null>(null);

export function hasProblem(p: ProblemDescription): boolean {
  return p.issueIds.length > 0 || p.voiceNote !== null || p.notes.trim().length >= 3 || p.photos.length > 0;
}

export function BookingDraftProvider({ children }: { readonly children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);

  // Actions never change identity, so screens can use them in effect dependencies safely.
  const actions = useMemo<DraftActions>(() => {
    const patchProblem = (f: (p: ProblemDescription) => ProblemDescription) => setDraft((d) => ({ ...d, problem: f(d.problem) }));
    return {
      start: (serviceId, issueId) => setDraft((d) => {
        // A photo taken before choosing the service (Home "Snap the problem") carries over into the new booking.
        const base = d.serviceId === serviceId ? d : { ...EMPTY, serviceId, addressId: d.addressId, problem: { ...EMPTY_PROBLEM, photos: d.serviceId ? [] : d.problem.photos } };
        if (!issueId || base.problem.issueIds.includes(issueId)) return base;
        return { ...base, problem: { ...base.problem, issueIds: [...base.problem.issueIds, issueId] } };
      }),
      toggleIssue: (issueId) => patchProblem((p) => ({
        ...p, issueIds: p.issueIds.includes(issueId) ? p.issueIds.filter((x) => x !== issueId) : [...p.issueIds, issueId],
      })),
      setNotes: (notes) => patchProblem((p) => ({ ...p, notes })),
      setVoiceNote: (voiceNote) => patchProblem((p) => ({ ...p, voiceNote })),
      addPhoto: (photo) => patchProblem((p) => (p.photos.length >= MAX_PHOTOS ? p : { ...p, photos: [...p.photos, photo] })),
      removePhoto: (id) => patchProblem((p) => ({ ...p, photos: p.photos.filter((x) => x.id !== id) })),
      setAddress: (addressId) => setDraft((d) => (d.addressId === addressId ? d : { ...d, addressId })),
      setTime: (time) => setDraft((d) => ({ ...d, time })),
      setPreferWomenRated: (preferWomenRated) => setDraft((d) => ({ ...d, preferWomenRated })),
      setMethod: (method) => setDraft((d) => ({ ...d, method })),
      clear: () => setDraft((d) => ({ ...EMPTY, addressId: d.addressId, method: d.method })),
    };
  }, []);

  const value = useMemo<DraftValue>(() => ({ draft, ...actions }), [draft, actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDraft(): DraftValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('BookingDraftProvider missing');
  return v;
}
