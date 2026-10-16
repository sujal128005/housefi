import { Image, StyleSheet, View } from 'react-native';
import type { Photo } from '../domain/types';
import { SamplePhoto } from '../illustrations/SamplePhoto';
import { radius } from '../theme/tokens';

/** A problem photo: the real picture if there is one, otherwise the bundled demo sample. */
export function PhotoThumb({ photo, size }: { readonly photo: Photo; readonly size: number | '100%' }) {
  return (
    <View style={[styles.box, typeof size === 'number' ? { width: size, height: size } : styles.fill]}>
      {photo.uri ? <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <SamplePhoto n={photo.sample ?? 1} size="100%" />}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
});
