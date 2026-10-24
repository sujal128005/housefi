// The booking being put together, step by step, before it is paid. Lives in memory only, and belongs to one
// customer: it is emptied when a different customer signs in on the phone (a shared phone must not carry one person's
// problem notes, photos or address into another person's booking). The same customer signing back in after their
// session ended keeps it.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppState } from './AppState';
import type { PaymentMethod, Photo, ProblemDescription, VisitTime, VisitWindow, VoiceNote } from '../domain/types';

export const MAX_PHOTOS = 4;

export interface Draft {
  readonly serviceId: string | null;
  readonly problem: ProblemDescription;
  readonly addressId: string | null;
  readonly time: VisitTime | null;
  readonly preferWomenRated: boolean;
  /** Apprentice mode: a trainee may come along. */
  readonly allowTrainee: boolean;
  /** Society repair day: this flat joins the building's day (its window and its lower visit fee). */
  readonly society: { readonly code: string; readonly name: string; readonly visitFee: number } | null;
  readonly method: PaymentMethod;
  /** "Book the same technician again": the earlier booking and its technician's name (asked first). */
  readonly repeat: { readonly bookingId: string; readonly name: string } | null;
}

interface DraftActions {
  /** Starts (or continues) a booking for a service; `issueId` pre-selects a problem (Home quick picks). */
  readonly start: (serviceId: string, issueId?: string) => void;
  /** A new booking of the same service at the same place, asking that booking's technician first. */
  readonly startRepeat: (r: { readonly serviceId: string; readonly addressId: string; readonly bookingId: string; readonly name: string }) => void;
  readonly toggleIssue: (issueId: string) => void;
  readonly setNotes: (notes: string) => void;
  readonly setVoiceNote: (v: VoiceNote | null) => void;
  readonly addPhoto: (p: Photo) => void;
  readonly removePhoto: (id: string) => void;
  readonly setAddress: (id: string | null) => void;
  readonly setTime: (t: VisitTime | null) => void;
  readonly setPreferWomenRated: (v: boolean) => void;
  readonly setAllowTrainee: (v: boolean) => void;
  readonly startSociety: (s: { readonly serviceId: string; readonly code: string; readonly name: string; readonly visitFee: number; readonly window: VisitWindow }) => void;
  readonly setMethod: (m: PaymentMethod) => void;
  /** After a booking is placed: keeps the address and payment method for the next one. */
  readonly clear: () => void;
  /** Everything gone (sign-out, another customer). */
  readonly reset: () => void;
}

interface DraftValue extends DraftActions {
  readonly draft: Draft;
}

const EMPTY_PROBLEM: ProblemDescription = { issueIds: [], notes: '', voiceNote: null, photos: [] };
const EMPTY: Draft = { serviceId: null, problem: EMPTY_PROBLEM, addressId: null, time: null, preferWomenRated: false, allowTrainee: false, society: null, method: 'UPI', repeat: null };

const Ctx = createContext<DraftValue | null>(null);

export function hasProblem(p: ProblemDescription): boolean {
  return p.issueIds.length > 0 || p.voiceNote !== null || p.notes.trim().length >= 3 || p.photos.length > 0;
}

export function BookingDraftProvider({ children }: { readonly children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const customerId = useAppState().session?.customer.id ?? null;
  const owner = useRef<string | null>(null);
  useEffect(() => {
    if (!customerId) return; // signed out or session ended: keep it for the same person signing back in
    if (owner.current !== null && owner.current !== customerId) setDraft(EMPTY);
    owner.current = customerId;
  }, [customerId]);

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
      startRepeat: ({ serviceId, addressId, bookingId, name }) => setDraft((d) => ({ ...EMPTY, serviceId, addressId, method: d.method, repeat: { bookingId, name } })),
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
      setAllowTrainee: (allowTrainee) => setDraft((d) => ({ ...d, allowTrainee })),
      startSociety: ({ serviceId, code, name, visitFee, window }) =>
        setDraft((d) => ({ ...EMPTY, serviceId, addressId: d.addressId, method: d.method, society: { code, name, visitFee }, time: { mode: 'SCHEDULED', window } })),
      setMethod: (method) => setDraft((d) => ({ ...d, method })),
      clear: () => setDraft((d) => ({ ...EMPTY, addressId: d.addressId, method: d.method })),
      reset: () => setDraft(EMPTY),
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
