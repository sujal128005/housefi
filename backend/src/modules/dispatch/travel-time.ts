// How long a technician takes to reach a customer in Hyderabad, Swiggy-style: straight-line distance stretched to
// roads, at a city speed that depends on the time of day (India time), plus the minutes before the trip starts.
// Only minutes ever leave the server, never anyone's location.
import { istHour } from '../slots/slot-rules';

/** Roads are longer than the straight line. */
export const ROAD_FACTOR = 1.4;
/** After accepting, before setting off (tools, bike). */
export const PREP_MIN = 5;
/** Before anyone has accepted: the offer going out and being answered. */
export const MATCH_MIN = 10;

/** Two-wheeler city speed by hour: slow at the morning and evening peaks, quicker late at night. */
export function citySpeedKmh(nowMs: number): number {
  const h = istHour(nowMs);
  if (h >= 22 || h < 6) return 28;
  if ((h >= 8 && h < 11) || (h >= 17 && h < 21)) return 14;
  return 20;
}

/** Minutes on the road for a straight-line distance (metres), at least 1. */
export function travelMinutes(metres: number, nowMs: number): number {
  const metresPerMin = (citySpeedKmh(nowMs) * 1000) / 60;
  return Math.max(1, Math.ceil((metres * ROAD_FACTOR) / metresPerMin));
}

/**
 * Before booking: when the nearest free technician could be there, as a 10-minute range rounded up to 5 minutes
 * ("25–35 min"), so it promises nothing it cannot keep.
 */
export function bookingEstimate(metres: number, nowMs: number): readonly [number, number] {
  const low = Math.ceil((MATCH_MIN + PREP_MIN + travelMinutes(metres, nowMs)) / 5) * 5;
  return [low, low + 10];
}
