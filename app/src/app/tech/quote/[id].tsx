// Prepare the repair quote (or extra work): what you found, labour and material lines with quantity and price, live
// totals, the ₹100 minimum, and a live AI price check against the usual range. Sent quotes are checked before the
// customer sees them. Also used to send a lower, revised quote when the customer asks.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { QUOTE_TEMPLATES, serviceById } from '../../../data/catalog';
import { priceCheck, QUOTE_MIN, quoteProblem, typicalRange, type QuoteLineDraft } from '../../../domain/rules';
import type { Job, QuoteLine } from '../../../domain/types';
import { Art3D } from '../../../illustrations/Art3D';
import { formatRupees } from '../../../i18n/format';
import { useI18n, type StringKey } from '../../../i18n/I18n';
import { feedback } from '../../../services/feedback';
import { useBackend } from '../../../services/ServicesProvider';
import { useTechSession } from '../../../state/AppState';
import { colors, radius, space } from '../../../theme/tokens';
import { Banner, Button, Card, Chip, Divider, ErrorBanner, ErrorView, Field, Header, Icon, Pill, Screen, Skeleton, Tap, Txt } from '../../../ui';

interface Draft {
  readonly key: number;
  readonly kind: QuoteLine['kind'];
  readonly name: string;
  readonly qty: number;
  readonly price: string;
}

const PROBLEM_TEXT: Record<string, StringKey> = {
  NO_LINES: 'tq.err.NO_LINES', NO_LABOUR: 'tq.err.NO_LABOUR', BAD_LINE: 'tq.err.BAD_LINE', BELOW_MIN: 'tq.err.BELOW_MIN', NO_DIAGNOSIS: 'tq.err.NO_DIAGNOSIS',
};

let nextKey = 1;

export default function QuoteBuilder() {
  const { id, which: whichParam } = useLocalSearchParams<{ id: string; which?: string }>();
  const which: 'MAIN' | 'EXTRA' = whichParam === 'EXTRA' ? 'EXTRA' : 'MAIN';
  const { t, l } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [lines, setLines] = useState<readonly Draft[]>([]);
  const [diagnosis, setDiagnosis] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    backend.tech.job(session.token, id).then((j) => {
      if (!alive) return;
      setJob(j);
      const prev = which === 'MAIN' ? j.quote : null;
      if (prev) {
        setLines(prev.lines.map((x) => ({ key: nextKey++, kind: x.kind, name: l(x.name), qty: x.qty, price: String(x.unitPrice) })));
        setDiagnosis(l(prev.diagnosis));
      } else {
        setLines([{ key: nextKey++, kind: 'LABOUR', name: t('tq.defaultLabour'), qty: 1, price: '' }]);
      }
    }, (e: unknown) => {
      if (alive) setLoadError(e);
    });
    return () => {
      alive = false;
    };
    // Load once per job; the draft is then the technician's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, session.token, id, which]);

  const drafts: QuoteLineDraft[] = lines.map((x) => ({ kind: x.kind, name: x.name, qty: x.qty, unitPrice: Number.parseInt(x.price, 10) || 0 }));
  const asLines: QuoteLine[] = drafts.map((d) => ({ kind: d.kind, name: { en: d.name, te: d.name }, qty: d.qty, unitPrice: d.unitPrice }));
  const labour = drafts.filter((d) => d.kind === 'LABOUR').reduce((s, d) => s + d.qty * d.unitPrice, 0);
  const material = drafts.filter((d) => d.kind === 'MATERIAL').reduce((s, d) => s + d.qty * d.unitPrice, 0);
  const total = labour + material;
  const svc = job ? serviceById(job.serviceId) : undefined;
  const [min, max] = typicalRange(svc);
  const problem = quoteProblem(diagnosis, drafts);
  // Extra work alone may be only materials; the main quote needs labour.
  const blocking = which === 'EXTRA' && problem === 'NO_LABOUR' ? null : problem;
  const check = total > 0 ? priceCheck(svc, asLines) : null;
  const tpl = job ? QUOTE_TEMPLATES[job.categoryId] : undefined;
  const suggestions = tpl ? [...tpl.lines, tpl.extra.line] : [];

  const update = (key: number, patch: Partial<Draft>) => setLines((ls) => ls.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const add = (kind: QuoteLine['kind'], name = '', price = '') => {
    feedback('pop');
    setLines((ls) => [...ls, { key: nextKey++, kind, name, qty: 1, price }]);
  };

  const send = async () => {
    setTouched(true);
    if (blocking || !job) {
      feedback('warning');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await backend.tech.submitQuote(session.token, job.id, which, {
        diagnosis: diagnosis.trim(),
        lines: drafts.map((d) => ({ kind: d.kind, name: d.name.trim(), qty: d.qty, unitPrice: d.unitPrice })),
      });
      feedback('send');
      router.back();
    } catch (e) {
      feedback('error');
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="tech-quote"
      wash="lavender"
      header={<Header title={which === 'EXTRA' ? t('tq.titleExtra') : job?.quote ? t('tq.titleRevise') : t('tq.title')} />}
      footer={job ? (
        <View style={styles.footer}>
          <View style={styles.footerTotal}>
            <Txt variant="caption" color="inkMuted">{t('quote.total')}</Txt>
            <Txt variant="title1" testID="tq-total">{formatRupees(total)}</Txt>
          </View>
          <Button label={t('tq.send')} icon="send" onPress={() => void send()} loading={busy} style={styles.flex} testID="tq-send" />
        </View>
      ) : undefined}
    >
      {loadError ? <ErrorView error={loadError} onRetry={() => router.back()} /> : null}
      {!job && !loadError ? <Skeleton style={styles.skel} /> : null}
      {job ? (
        <>
          <View style={styles.head}>
            <Art3D name="clipboard" size={64} float />
            <View style={styles.flex}>
              <Txt variant="bodyStrong">{svc ? l(svc.name) : ''} · {job.code}</Txt>
              <Txt variant="footnote" color="inkMuted">{t('tq.body')}</Txt>
            </View>
          </View>
          {which === 'MAIN' && job.quote?.decision === 'REVISION_REQUESTED' ? <Banner tone="warning" icon="pricetag" text={t('tq.revisionAsked', { name: job.customerName })} /> : null}

          <Field label={t('tq.diagnosis')} value={diagnosis} onChangeText={setDiagnosis} multiline maxLength={500} placeholder={t('tq.diagnosisPlaceholder')} testID="tq-diagnosis"
            textAlignVertical="top" error={touched && problem === 'NO_DIAGNOSIS' ? t('tq.err.NO_DIAGNOSIS') : null} />

          <Txt variant="title3" heading>{t('tq.items')}</Txt>
          {lines.map((x, i) => (
            <Card key={x.key} style={styles.line} testID={`tq-line-${i}`}>
              <View style={styles.lineTop}>
                <Tap onPress={() => update(x.key, { kind: x.kind === 'LABOUR' ? 'MATERIAL' : 'LABOUR' })} style={[styles.kind, x.kind === 'LABOUR' ? styles.kindLabour : styles.kindMaterial]}
                  accessibilityLabel={t(x.kind === 'LABOUR' ? 'quote.labour' : 'quote.material')} testID={`tq-kind-${i}`}>
                  <Icon name={x.kind === 'LABOUR' ? 'construct' : 'cube'} size={14} color={x.kind === 'LABOUR' ? 'blue' : 'orange'} />
                  <Txt variant="caption" color={x.kind === 'LABOUR' ? 'blue' : 'orange'}>{t(x.kind === 'LABOUR' ? 'quote.labour' : 'quote.material')}</Txt>
                  <Icon name="swap-horizontal" size={12} color="inkMuted" />
                </Tap>
                <Txt variant="label" style={styles.lineTotal}>{formatRupees(x.qty * (Number.parseInt(x.price, 10) || 0))}</Txt>
                <Tap onPress={() => setLines((ls) => ls.filter((y) => y.key !== x.key))} style={styles.remove} accessibilityLabel={t('common.remove')} testID={`tq-remove-${i}`}>
                  <Icon name="trash-outline" size={18} color="danger" />
                </Tap>
              </View>
              <TextInput value={x.name} onChangeText={(v) => update(x.key, { name: v })} placeholder={t(x.kind === 'LABOUR' ? 'tq.labourPlaceholder' : 'tq.materialPlaceholder')}
                placeholderTextColor={colors.inkSubtle} maxLength={80} autoCorrect={false} autoCapitalize="sentences" style={styles.input} accessibilityLabel={t('tq.itemName')} testID={`tq-name-${i}`} />
              <View style={styles.lineBottom}>
                <View style={styles.qty}>
                  <Tap onPress={() => update(x.key, { qty: Math.max(1, x.qty - 1) })} style={styles.qtyBtn} accessibilityLabel="-" testID={`tq-qty-minus-${i}`}><Icon name="remove" size={18} color="navy" /></Tap>
                  <Txt variant="bodyStrong" style={styles.qtyText}>{x.qty}</Txt>
                  <Tap onPress={() => update(x.key, { qty: Math.min(99, x.qty + 1) })} style={styles.qtyBtn} accessibilityLabel="+" testID={`tq-qty-plus-${i}`}><Icon name="add" size={18} color="navy" /></Tap>
                </View>
                <View style={styles.price}>
                  <Txt variant="bodyStrong" color="inkMuted">₹</Txt>
                  <TextInput value={x.price} onChangeText={(v) => update(x.key, { price: v.replace(/\D/g, '').slice(0, 6) })} keyboardType="number-pad" placeholder="0"
                    placeholderTextColor={colors.inkSubtle} style={styles.priceInput} accessibilityLabel={t('tq.price')} testID={`tq-price-${i}`} />
                </View>
              </View>
            </Card>
          ))}
          <View style={styles.addRow}>
            <Button label={t('tq.addLabour')} icon="construct" variant="secondary" size="md" onPress={() => add('LABOUR')} style={styles.flex} testID="tq-add-labour" />
            <Button label={t('tq.addMaterial')} icon="cube" variant="secondary" size="md" onPress={() => add('MATERIAL')} style={styles.flex} testID="tq-add-material" />
          </View>
          {suggestions.length > 0 ? (
            <View style={styles.block}>
              <Txt variant="label" color="inkMuted">{t('tq.common')}</Txt>
              <View style={styles.chips}>
                {suggestions.map((s, k) => (
                  <Chip key={k} label={`${l(s.name)} · ${formatRupees(s.unitPrice)}`} selected={false} icon="add" onPress={() => add(s.kind, l(s.name), String(s.unitPrice))} testID={`tq-suggest-${k}`} />
                ))}
              </View>
            </View>
          ) : null}

          <Card style={styles.totals} testID="tq-totals">
            <View style={styles.rowBetween}><Txt variant="callout">{t('quote.labour')}</Txt><Txt variant="label" testID="tq-labour">{formatRupees(labour)}</Txt></View>
            <View style={styles.rowBetween}><Txt variant="callout">{t('quote.material')}</Txt><Txt variant="label" testID="tq-material">{formatRupees(material)}</Txt></View>
            <Divider />
            <View style={styles.rowBetween}><Txt variant="bodyStrong">{t('quote.total')}</Txt><Txt variant="title2">{formatRupees(total)}</Txt></View>
            <Txt variant="caption" color="inkMuted">{t('tq.minimum', { min: formatRupees(QUOTE_MIN) })} · {t('tq.usual', { min: formatRupees(min), max: formatRupees(max) })}</Txt>
            {check ? (
              <Pill label={check === 'FAIR' ? t('tq.aiFair') : t('tq.aiReview')} tone={check === 'FAIR' ? 'success' : 'warning'} icon="sparkles" />
            ) : null}
          </Card>
          {touched && blocking && blocking !== 'NO_DIAGNOSIS' ? <Banner tone="danger" text={t(PROBLEM_TEXT[blocking] ?? 'tq.err.BAD_LINE', { min: formatRupees(QUOTE_MIN) })} testID="tq-problem" /> : null}
          <Banner tone="info" icon="sparkles" text={t('tq.aiNote')} />
          <ErrorBanner error={error} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  skel: { height: 300, borderRadius: radius.xl },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  footerTotal: { minWidth: 96 },
  block: { gap: space.sm },
  line: { gap: space.sm, padding: space.md },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, minHeight: 32, borderRadius: radius.pill },
  kindLabour: { backgroundColor: colors.blueTint },
  kindMaterial: { backgroundColor: '#FFF1E3' },
  lineTotal: { flex: 1, textAlign: 'right' },
  remove: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, paddingHorizontal: space.md, color: colors.ink, fontSize: 16, backgroundColor: colors.surface },
  lineBottom: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  qty: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderRadius: radius.pill, backgroundColor: colors.canvas, padding: 4 },
  qtyBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  qtyText: { minWidth: 28, textAlign: 'center' },
  price: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.blue, paddingHorizontal: space.md, backgroundColor: colors.surface },
  priceInput: { flex: 1, fontSize: 20, fontWeight: '700', color: colors.ink, minHeight: 44 },
  addRow: { flexDirection: 'row', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  totals: { gap: space.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
