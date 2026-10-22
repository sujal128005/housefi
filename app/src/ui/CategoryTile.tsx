import { memo } from 'react';
import { StyleSheet } from 'react-native';
import type { Category } from '../domain/types';
import { Art3D, serviceArt } from '../illustrations/Art3D';
import { useI18n } from '../i18n/I18n';
import { colors, radius, shadow, space } from '../theme/tokens';
import { Tap } from './Tap';
import { Txt } from './Txt';

/** Category tile: white card with the category's illustration and its name. */
function CategoryTileView({ category, onPress, size = 'md' }: { readonly category: Category; readonly onPress: () => void; readonly size?: 'md' | 'lg' }) {
  const { l } = useI18n();
  return (
    <Tap onPress={onPress} haptic style={[styles.tile, size === 'lg' && styles.tileLg]} accessibilityLabel={l(category.name)} testID={`cat-${category.id}`}>
      <Art3D name={category.art} size={size === 'lg' ? 92 : 76} />
      <Txt variant={size === 'lg' ? 'bodyStrong' : 'label'} align="center" numberOfLines={2}>{l(category.name)}</Txt>
    </Tap>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', gap: space.xs, paddingTop: space.md, paddingBottom: space.md, paddingHorizontal: space.xs, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  tileLg: { borderRadius: radius.xxl, paddingTop: space.lg, paddingBottom: space.lg },
});

/** The picture for a row: the service's own illustration when a service is given, else the category's. */
export function CategoryBadge({ category, serviceId, size = 52 }: { readonly category: Category; readonly serviceId?: string; readonly size?: number }) {
  // Art3D draws the brand tile itself; the margin trims its built-in breathing room.
  return <Art3D name={serviceArt(serviceId, category.art)} size={Math.round(size / 0.9)} style={{ margin: -size * 0.055 }} />;
}

/** Redraws only when the category itself changes (taps always go to the same category, so a new onPress does not count). */
export const CategoryTile = memo(CategoryTileView, (a, b) => a.category === b.category && a.size === b.size);
