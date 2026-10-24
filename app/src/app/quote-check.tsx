// Quote checker: the customer photographs any repair quote (also one from outside Housefi), checks the lines the AI
// read (or types them), and sees how the total compares with Housefi's usual price for that service and its parts
// price list. The AI only reads; fixed rules on the server judge the price. Nothing is stored.
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { categoryById, currentCatalog, serviceById } from '../data/catalog';
import type { Photo, QuoteCheckLine, QuoteCheckResult } from '../domain/types';
import { Art3D } from '../illustrations/Art3D';
import { formatRupees } from '../i18n/format';
import { useI18n } from '../i18n/I18n';
import { pickPhoto } from '../services/device';
import { feedback } from '../services/feedback';
import { useBackend } from '../services/ServicesProvider';
import { useSession } from '../state/AppState';
import { useDraft } from '../state/BookingDraft';
import { colors, radius, space } from '../theme/tokens';
import { Banner, Button, Card, Chip, ErrorBanner, Field, Header, Icon, Screen, Sheet, Tap, Txt, useToast } from '../ui';
import { CategoryBadge } from '../ui/CategoryTile';
import { Appear, Pulse } from '../ui/motion';
import { PhotoThumb } from '../ui/PhotoThumb';

type Step = 'start' | 'reading' | 'edit' | 'result';
/** A line while the customer edits it (amount as typed). */
interface Draft { readonly key: string; name: string; kind: QuoteCheckLine['kind']; qty: number; amount: string; partId: string | null }

let seq = 0;
const blank = (kind: QuoteCheckLine['kind'] = 'LABOUR'): Draft => ({ key: `l${++seq}`, name: '', kind, qty: 1, amount: '', partId: null });
const valid = (d: Draft) => d.name.trim().length > 0 && /^\d{1,6}$/.test(d.amount) && Number(d.amount) >= 1 && Number(d.amount) <= 200_000;

export default function QuoteCheck() {
  const { t, l } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const toast = useToast();
  const draft = useDraft();
  const [step, setStep] = useState<Step>('start');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [readable, setReadable] = useState<boolean | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [lines, setLines] = useState<Draft[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<QuoteCheckResult | null>(null);

  const read = async (p: Photo) => {
    setPhoto(p);
    setStep('reading');
    try {
      const r = await backend.ai.readQuote(session.token, p);
      setReadable(r.readable);
      setServiceId(r.serviceId);
      setLines(r.lines.length ? r.lines.map((x) => ({ key: `l${++seq}`, name: x.name, kind: x.kind, qty: x.qty, amount: String(x.amount), partId: x.partId })) : [blank()]);
      feedback(r.readable ? 'success' : 'pop');
    } catch {
      // No answer (no network, upload refused): the customer types the lines.
      setReadable(false);
      setLines([blank()]);
    }
    setStep('edit');
  };

  const take = async (source: 'camera' | 'gallery') => {
    const r = await pickPhoto(source);
    if (r.ok) void read({ id: `ph_${Date.now().toString(36)}`, uri: r.uri });
    else if (r.reason === 'DENIED') toast.show(t('photos.denied'), 'lock-closed');
    else if (r.reason === 'UNAVAILABLE') toast.show(t('photos.unavailable'), 'information-circle');
  };

  const typeIt = () => {
    setPhoto(null);
    setReadable(null);
    setLines([blank()]);
    setStep('edit');
  };

  const update = (key: string, patch: Partial<Draft>) => setLines((ls) => ls.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const ready = !!serviceId && lines.length > 0 && lines.every(valid);

  const check = async () => {
    if (!serviceId || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await backend.ai.checkQuote(session.token, serviceId, lines.map((x) => ({ name: x.name.trim(), kind: x.kind, qty: x.qty, amount: Number(x.amount), partId: x.partId })));
      setResult(r);
      feedback(r.verdict === 'FAIR' ? 'success' : 'warning');
      setStep('result');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    setStep('start');
    setPhoto(null);
    setResult(null);
    setServiceId(null);
    setLines([]);
    setError(null);
  };

  const svc = serviceId ? serviceById(serviceId) : undefined;
  const cat = svc ? categoryById(svc.categoryId) : undefined;

  return (
    <Screen testID="quote-check" wash="mint" header={<Header title={t('qc.title')} />}
      footer={step === 'edit' ? (
        <Button label={t('qc.check')} icon="shield-checkmark" onPress={() => void check()} loading={busy} disabled={!ready} testID="qc-check" />
      ) : step === 'result' && result ? (
        <Button label={t('qc.book', { fee: formatRupees(result.visitFee) })} trailingIcon="arrow-forward" testID="qc-book"
          onPress={() => { draft.clear(); draft.start(result.serviceId); router.push('/book/problem'); }} />
      ) : undefined}>
      {step === 'start' ? (
        <>
          <Appear style={styles.hero}><Art3D name="receipt" size={120} float shadow /></Appear>
          <Txt variant="title1" align="center" heading>{t('qc.heading')}</Txt>
          <Txt variant="callout" color="inkMuted" align="center">{t('qc.body')}</Txt>
          <View style={styles.row}>
            <Button label={t('photos.camera')} icon="camera" onPress={() => void take('camera')} style={styles.flex} testID="qc-camera" />
            <Button label={t('photos.gallery')} icon="images" variant="secondary" onPress={() => void take('gallery')} style={styles.flex} testID="qc-gallery" />
          </View>
          <Button label={t('qc.type')} icon="create-outline" variant="ghost" onPress={typeIt} testID="qc-type" />
          <Txt variant="footnote" color="inkMuted" align="center">{t('qc.privacy')}</Txt>
        </>
      ) : null}

      {step === 'reading' && photo ? (
        <View style={styles.preview}>
          <PhotoThumb photo={photo} size="100%" />
          <View style={styles.scan}>
            <Pulse size={160} color={colors.surface} />
            <Art3D name="magnifier" size={72} float />
            <Txt variant="bodyStrong" color="onNavy">{t('qc.reading')}</Txt>
          </View>
        </View>
      ) : null}

      {step === 'edit' ? (
        <>
          {readable === true ? <Banner tone="success" icon="sparkles" text={t('qc.readOk')} testID="qc-read-ok" /> : null}
          {readable === false ? <Banner tone="info" icon="create-outline" text={t('qc.readNot')} testID="qc-read-not" /> : null}
          <Card style={styles.card}>
            <Txt variant="label" color="inkMuted">{t('qc.service')}</Txt>
            <Tap onPress={() => setPicking(true)} style={styles.pick} testID="qc-service" accessibilityLabel={t('qc.service')}>
              {svc && cat ? <CategoryBadge category={cat} serviceId={svc.id} size={44} /> : <Icon name="construct-outline" size={24} color="inkMuted" />}
              <Txt variant="bodyStrong" style={styles.flex}>{svc ? l(svc.name) : t('qc.pickService')}</Txt>
              <Icon name="chevron-forward" size={18} color="inkSubtle" />
            </Tap>
          </Card>
          <Card style={styles.card}>
            <Txt variant="title3" heading>{t('qc.lines')}</Txt>
            {lines.map((x, i) => (
              <View key={x.key} style={styles.line} testID={`qc-line-${i}`}>
                <View style={styles.row}>
                  <Chip label={t('qc.work')} selected={x.kind === 'LABOUR'} onPress={() => update(x.key, { kind: 'LABOUR', partId: null })} testID={`qc-line-${i}-labour`} />
                  <Chip label={t('qc.parts')} selected={x.kind === 'MATERIAL'} onPress={() => update(x.key, { kind: 'MATERIAL' })} testID={`qc-line-${i}-material`} />
                  <View style={styles.flex} />
                  {lines.length > 1 ? (
                    <Tap onPress={() => setLines((ls) => ls.filter((y) => y.key !== x.key))} accessibilityLabel={t('qc.remove')} style={styles.remove} testID={`qc-line-${i}-remove`}>
                      <Icon name="trash-outline" size={20} color="danger" />
                    </Tap>
                  ) : null}
                </View>
                <Field label={t('qc.what')} value={x.name} onChangeText={(v) => update(x.key, { name: v, partId: null })} maxLength={60} testID={`qc-line-${i}-name`} />
                <Field label={x.qty > 1 ? t('qc.amountQty', { qty: x.qty }) : t('qc.amount')} value={x.amount} prefix="₹" keyboardType="number-pad" maxLength={6}
                  onChangeText={(v) => update(x.key, { amount: v.replace(/\D/g, '') })} testID={`qc-line-${i}-amount`} />
              </View>
            ))}
            <Button label={t('qc.addLine')} icon="add" variant="outline" size="md" onPress={() => setLines((ls) => (ls.length < 20 ? [...ls, blank()] : ls))} disabled={lines.length >= 20} testID="qc-add" />
          </Card>
          <ErrorBanner error={error} />
        </>
      ) : null}

      {step === 'result' && result ? <Result result={result} onAgain={again} /> : null}

      <Sheet visible={picking} onClose={() => setPicking(false)} testID="qc-service-sheet">
        <Txt variant="title3" heading>{t('qc.pickService')}</Txt>
        <ScrollView style={styles.sheetList}>
          {currentCatalog().services.map((s) => {
            const c = categoryById(s.categoryId);
            return c ? (
              <Tap key={s.id} onPress={() => { setServiceId(s.id); setPicking(false); }} style={styles.pick} testID={`qc-service-${s.id}`} accessibilityLabel={l(s.name)}>
                <CategoryBadge category={c} serviceId={s.id} size={40} />
                <Txt variant="body" style={styles.flex}>{l(s.name)}</Txt>
                {s.id === serviceId ? <Icon name="checkmark-circle" size={20} color="success" /> : null}
              </Tap>
            ) : null;
          })}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

function Result({ result: r, onAgain }: { readonly result: QuoteCheckResult; readonly onAgain: () => void }) {
  const { t, l } = useI18n();
  const svc = serviceById(r.serviceId);
  const tone = r.verdict === 'FAIR' ? 'success' : r.verdict === 'A_BIT_HIGH' ? 'warning' : 'danger';
  return (
    <Appear style={styles.result}>
      <Card style={[styles.verdict, { borderColor: tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : colors.danger }]} testID={`qc-verdict-${r.verdict}`}>
        <Icon name={r.verdict === 'FAIR' ? 'checkmark-circle' : 'alert-circle'} size={40} color={tone} />
        <Txt variant="title2" align="center">{r.verdict === 'FAIR' ? t('qc.fair') : t('qc.over', { amount: formatRupees(r.over) })}</Txt>
        <Txt variant="callout" color="inkMuted" align="center">
          {t('qc.usual', { service: svc ? l(svc.name) : r.serviceId, min: formatRupees(r.usualMin), max: formatRupees(r.usualMax) })}
        </Txt>
        <Txt variant="hero" testID="qc-total">{formatRupees(r.total)}</Txt>
        <Txt variant="caption" color="inkMuted">{t('qc.yourQuote')}</Txt>
      </Card>
      {r.lines.some((x) => x.overList > 0) ? (
        <Card style={styles.card}>
          <Txt variant="title3" heading>{t('qc.partsTitle')}</Txt>
          {r.lines.filter((x) => x.overList > 0).map((x, i) => (
            <View key={`${x.name}-${i}`} style={styles.partRow} testID={`qc-part-over-${i}`}>
              <Icon name="pricetag" size={18} color="warning" />
              <Txt variant="body" style={styles.flex}>{t('qc.partOver', { name: x.name, amount: formatRupees(x.overList), list: formatRupees(x.listPrice ?? 0) })}</Txt>
            </View>
          ))}
        </Card>
      ) : null}
      <Banner tone={r.verdict === 'FAIR' ? 'info' : 'warning'} icon="chatbubbles-outline" text={r.verdict === 'FAIR' ? t('qc.tipFair') : t('qc.tipHigh')} />
      <Txt variant="footnote" color="inkMuted">{t('qc.note')}</Txt>
      <Button label={t('qc.again')} icon="refresh" variant="outline" size="md" onPress={onAgain} testID="qc-again" />
    </Appear>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { alignItems: 'center', marginTop: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  preview: { width: '100%', aspectRatio: 1.1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  scan: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(19,35,91,0.55)', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  card: { gap: space.md },
  pick: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.xs },
  line: { gap: space.sm, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colors.line },
  remove: { padding: space.sm },
  result: { gap: space.md },
  verdict: { alignItems: 'center', gap: space.sm, borderWidth: 2 },
  partRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  sheetList: { maxHeight: 420 },
});
