import { StyleSheet } from 'react-native';
import type { Category } from '../domain/types';
import { CategoryArt } from '../illustrations/CategoryArt';
import { useI18n } from '../i18n/I18n';
import { radius, space } from '../theme/tokens';
import { Wash } from './Layout';
import { Tap } from './Tap';
import { Txt } from './Txt';

export function CategoryTile({ category, onPress, size = 'md' }: { readonly category: Category; readonly onPress: () => void; readonly size?: 'md' | 'lg' }) {
  const { l } = useI18n();
  const art = size === 'lg' ? 60 : 50;
  return (
    <Tap onPress={onPress} haptic style={styles.tile} accessibilityLabel={l(category.name)} testID={`cat-${category.id}`}>
      <Wash name={category.wash} style={[styles.wash, size === 'lg' && styles.washLg]}>
        <CategoryArt name={category.art} size={art} />
      </Wash>
      <Txt variant="label" align="center" numberOfLines={2}>{l(category.name)}</Txt>
    </Tap>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', gap: space.sm },
  wash: { width: '100%', aspectRatio: 1, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(19,35,91,0.06)' },
  washLg: { borderRadius: radius.xxl },
});

export function CategoryBadge({ category, size = 52 }: { readonly category: Category; readonly size?: number }) {
  return (
    <Wash name={category.wash} style={[badge.box, { width: size, height: size, borderRadius: size * 0.32 }]}>
      <CategoryArt name={category.art} size={size * 0.78} />
    </Wash>
  );
}

const badge = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(19,35,91,0.06)' },
});
