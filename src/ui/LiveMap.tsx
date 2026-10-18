// The live map while the technician is on the way: their latest position (sent by their phone about every minute) and
// the customer's home, both kept in view. Without a recent position (or without the home's coordinates) it shows the
// route illustration instead, driven by the ETA. Google Maps on Android needs the key in app.json
// (react-native-maps plugin, androidGoogleMapsApiKey); iOS uses Apple Maps.
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { TrackingMap } from '../illustrations/TrackingMap';
import { Art3D } from '../illustrations/Art3D';
import { colors, radius } from '../theme/tokens';

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

export interface LiveMapProps {
  readonly technician: LatLng | null;
  readonly home: LatLng | null;
  /** 0..1 along the illustrated route, for the fallback. */
  readonly progress: number;
  readonly width: number;
  readonly testID?: string;
}

const HEIGHT_RATIO = 220 / 340;

export function LiveMap({ technician, home, progress, width, testID }: LiveMapProps) {
  const map = useRef<MapView>(null);
  const height = Math.round(width * HEIGHT_RATIO);

  // Keep both pins in view as the technician moves.
  useEffect(() => {
    if (!technician || !home) return;
    map.current?.fitToCoordinates(
      [{ latitude: technician.lat, longitude: technician.lng }, { latitude: home.lat, longitude: home.lng }],
      { edgePadding: { top: 48, right: 48, bottom: 48, left: 48 }, animated: true },
    );
  }, [technician?.lat, technician?.lng, home?.lat, home?.lng, technician, home]);

  if (!technician || !home) return <TrackingMap progress={progress} width={width} />;
  return (
    <View style={[styles.frame, { width, height }]} testID={testID ?? 'live-map'}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: (technician.lat + home.lat) / 2,
          longitude: (technician.lng + home.lng) / 2,
          latitudeDelta: Math.max(0.01, Math.abs(technician.lat - home.lat) * 2.2),
          longitudeDelta: Math.max(0.01, Math.abs(technician.lng - home.lng) * 2.2),
        }}
        toolbarEnabled={false}
        showsPointsOfInterests={false}
        pitchEnabled={false}
        rotateEnabled={false}
      >
        <Marker coordinate={{ latitude: home.lat, longitude: home.lng }} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
          <Art3D name="house" size={40} />
        </Marker>
        <Marker coordinate={{ latitude: technician.lat, longitude: technician.lng }} anchor={{ x: 0.5, y: 0.5 }}>
          <Art3D name="scooter" size={44} />
        </Marker>
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface },
});
