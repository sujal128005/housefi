// Web preview: react-native-maps has no web version, so the route illustration stands in (driven by the ETA).
import { TrackingMap } from '../illustrations/TrackingMap';
import type { LiveMapProps } from './LiveMap';

export type { LatLng, LiveMapProps } from './LiveMap';

export function LiveMap({ progress, width }: LiveMapProps) {
  return <TrackingMap progress={progress} width={width} />;
}
