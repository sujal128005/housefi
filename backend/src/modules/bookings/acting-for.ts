// A coordinator acting for a technician without a phone (README §9): the technician's own job actions run unchanged,
// but every status change, timeline event and audit row records the coordinator as the actor. Set by
// CoordinatorService around the call; read wherever a technician action names its actor.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Actor } from './booking-core';

const acting = new AsyncLocalStorage<Actor>();

/** Runs `fn` with `coordinator` recorded as the actor of the technician actions inside it. */
export function actingFor<T>(coordinator: Actor, fn: () => Promise<T>): Promise<T> {
  return acting.run(coordinator, fn);
}

/** The actor of a technician action: the technician, or the coordinator acting for them. */
export function technicianActor(technicianId: string): Actor {
  return acting.getStore() ?? { type: 'TECHNICIAN', id: technicianId };
}
