// The booking being put together, step by step, before it is submitted. Lives in memory only.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Photo, ProblemDescription, VisitWindow, VoiceNote } from '../domain/types';

export const MAX_PHOTOS = 4;

export interface Draft {
  readonly serviceId: string | null;
  readonly problem: ProblemDescription;
  readonly addressId: string | null;
  readonly window: VisitWindow | null;
}

const EMPTY_PROBLEM: ProblemDescription = { issueIds: [], notes: '', voiceNote: null, photos: [] };
const EMPTY: Draft = { serviceId: null, problem: EMPTY_PROBLEM, addressId: null, window: null };

interface DraftValue {
  readonly draft: Draft;
  readonly start: (serviceId: string) => void;
  readonly toggleIssue: (issueId: string) => void;
  readonly setNotes: (notes: string) => void;
  readonly setVoiceNote: (v: VoiceNote | null) => void;
  readonly addPhoto: (p: Photo) => void;
  readonly removePhoto: (id: string) => void;
  readonly setAddress: (id: string | null) => void;
  readonly setWindow: (w: VisitWindow | null) => void;
  readonly clear: () => void;
}

const Ctx = createContext<DraftValue | null>(null);

export function hasProblem(p: ProblemDescription): boolean {
  return p.issueIds.length > 0 || p.voiceNote !== null || p.notes.trim().length >= 3 || p.photos.length > 0;
}

export function BookingDraftProvider({ children }: { readonly children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);

  // Actions never change identity, so screens can use them in effect dependencies safely.
  const actions = useMemo(() => {
    const patchProblem = (f: (p: ProblemDescription) => ProblemDescription) => setDraft((d) => ({ ...d, problem: f(d.problem) }));
    return {
      start: (serviceId: string) => setDraft((d) => (d.serviceId === serviceId ? d : { ...EMPTY, serviceId, addressId: d.addressId })),
      toggleIssue: (issueId: string) => patchProblem((p) => ({
        ...p, issueIds: p.issueIds.includes(issueId) ? p.issueIds.filter((x) => x !== issueId) : [...p.issueIds, issueId],
      })),
      setNotes: (notes: string) => patchProblem((p) => ({ ...p, notes })),
      setVoiceNote: (voiceNote: VoiceNote | null) => patchProblem((p) => ({ ...p, voiceNote })),
      addPhoto: (photo: Photo) => patchProblem((p) => (p.photos.length >= MAX_PHOTOS ? p : { ...p, photos: [...p.photos, photo] })),
      removePhoto: (id: string) => patchProblem((p) => ({ ...p, photos: p.photos.filter((x) => x.id !== id) })),
      setAddress: (addressId: string | null) => setDraft((d) => (d.addressId === addressId ? d : { ...d, addressId })),
      setWindow: (window: VisitWindow | null) => setDraft((d) => ({ ...d, window })),
      clear: () => setDraft((d) => ({ ...EMPTY, addressId: d.addressId })),
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
