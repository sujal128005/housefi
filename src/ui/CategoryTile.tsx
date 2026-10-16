import { StyleSheet } from 'react-native';
import type { Category } from '../domain/types';
import { Art3D } from '../illustrations/Art3D';
import { useI18n } from '../i18n/I18n';
import { radius, shadow, space } from '../theme/tokens';
import { Wash } from './Layout';
import { Tap } from './Tap';
import { Txt } from './Txt';

/** Category tile: pastel square with the category's 3D object, name below. */
export function CategoryTile({ category, onPress, size = 'md' }: { readonly category: Category; readonly onPress: () => void; readonly size?: 'md' | 'lg' }) {
  const { l } = useI18n();
  return (
    <Tap onPress={onPress} haptic style={styles.tile} accessibilityLabel={l(category.name)} testID={`cat-${category.id}`}>
      <Wash name={category.wash} style={[styles.wash, size === 'lg' && styles.washLg]}>
        <Art3D name={category.art} size={size === 'lg' ? 92 : 72} />
      </Wash>
      <Txt variant={size === 'lg' ? 'bodyStrong' : 'label'} align="center" numberOfLines={2}>{l(category.name)}</Txt>
    </Tap>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', gap: space.sm },
  wash: { width: '100%', aspectRatio: 1, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(19,35,91,0.06)', ...shadow.card },
  washLg: { borderRadius: radius.xxl },
});

export function CategoryBadge({ category, size = 52 }: { readonly category: Category; readonly size?: number }) {
  return (
    <Wash name={category.wash} style={[badge.box, { width: size, height: size, borderRadius: size * 0.32 }]}>
      <Art3D name={category.art} size={size * 0.74} />
    </Wash>
  );
}

const badge = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(19,35,91,0.06)' },
});
