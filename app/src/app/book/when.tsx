// Step 3 of 4: when. "Now" (nearest technician, instant) or "Schedule" (date and two-hour window). Also used to
// reschedule a booking (?reschedule=<bookingId>).
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { bookableDates, INSTANT_ETA_MIN, INSTANT_HOURS, isInstantAvailable, isoDate } from '../../domain/rules';
import type { BookingMode, Slot, VisitTime, VisitWindow } from '../../domain/types';
import { Art3D, type ArtName } from '../../illustrations/Art3D';
import { formatHour, formatWindow, monthShort, weekdayShort } from '../../i18n/format';
import { useI18n, type StringKey } from '../../i18n/I18n';
import { isApiError } from '../../services/api';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { colors, GUTTER, radius, shadow, space } from '../../theme/tokens';
import { Banner, Button, ErrorBanner, ErrorView, Header, Icon, Screen, Skeleton, Tap, Txt, useToast } from '../../ui';
import { Appear } from '../../ui/motion';
import { StepHeader } from '../../ui/StepHeader';

const PARTS: readonly { key: StringKey; art: ArtName; from: number; to: number }[] = [
  { key: 'schedule.morning', art: 'sun', from: 0, to: 12 },
  { key: 'schedule.afternoon', art: 'sun_cloud', from: 12, to: 16 },
  { key: 'schedule.evening', art: 'moon', from: 16, to: 24 },
];

export default function WhenStep() {
  const { reschedule } = useLocalSearchParams<{ reschedule?: string }>();
  const { t, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const toast = useToast();
  const { draft, setTime } = useDraft();
  const now = useMemo(() => new Date(), []);
  const dates = useMemo(() => bookableDates(now), [now]);
  const instantOk = isInstantAvailable(now);
  const booking = useQuery(async () => (reschedule ? backend.bookings.get(session.token, reschedule) : null), [reschedule, backend, session.token]);
  const serviceId = reschedule ? booking.data?.serviceId : draft.serviceId;
  const initial = reschedule ? null : draft.time;
  const [mode, setMode] = useState<BookingMode | null>(initial?.mode ?? (instantOk && !reschedule ? 'INSTANT' : null));
  const [date, setDate] = useState(initial?.window?.date ?? isoDate(dates[0] ?? now));
  const [picked, setPicked] = useState<VisitWindow | null>(initial?.window ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const slots = useQuery(async () => (serviceId && mode === 'SCHEDULED' ? backend.bookings.slots(session.token, serviceId, date) : []), [serviceId, date, backend, mode, session.token]);
  const open = (slots.data ?? []).filter((s) => s.state === 'OPEN');

  // If nothing is left today, start the date strip on tomorrow.
  const [autoSkipped, setAutoSkipped] = useState(false);
  useEffect(() => {
    if (autoSkipped || mode !== 'SCHEDULED' || !slots.data || slots.loading || picked) return;
    setAutoSkipped(true);
    if (open.length === 0 && date === isoDate(dates[0] ?? now) && dates[1]) setDate(isoDate(dates[1]));
  }, [slots.data, slots.loading, open.length, autoSkipped, picked, date, dates, mode, now]);

  if (!reschedule && !draft.serviceId) return <Redirect href="/home" />;

  const time: VisitTime | null = mode === 'INSTANT' ? { mode: 'INSTANT', window: null } : mode === 'SCHEDULED' && picked ? { mode: 'SCHEDULED', window: picked } : null;

  const next = async () => {
    if (!time) return;
    if (!reschedule) {
      setTime(time);
      router.push('/book/confirm');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await backend.bookings.reschedule(session.token, reschedule, time);
      toast.show(t('track.rescheduled'), 'calendar');
      router.back();
    } catch (e) {
      if (isApiError(e, 'SLOT_UNAVAILABLE')) {
        setPicked(null);
        slots.reload();
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const today = isoDate(dates[0] ?? now);
  const tomorrow = isoDate(dates[1] ?? now);

  return (
    <Screen
      testID="book-when"
      header={reschedule ? <Header title={t('schedule.reschedule')} /> : <StepHeader step={3} />}
      footer={<Button label={reschedule ? t('schedule.confirmNew') : t('common.next')} trailingIcon={reschedule ? undefined : 'arrow-forward'} disabled={!time} loading={busy} onPress={() => void next()} testID="schedule-next" />}
    >
      {!reschedule ? <Txt variant="title1" heading>{t('schedule.title')}</Txt> : null}
      {booking.error ? <ErrorView error={booking.error} onRetry={booking.reload} /> : null}

      <View style={styles.modes}>
        <ModeCard testID="mode-instant" art="rocket" title={t('when.instant')} sub={instantOk ? t('when.instantSub', { min: INSTANT_ETA_MIN[0], max: INSTANT_ETA_MIN[1] }) : t('when.instantClosed', { from: formatHour(INSTANT_HOURS[0], locale), to: formatHour(INSTANT_HOURS[1], locale) })}
          selected={mode === 'INSTANT'} disabled={!instantOk} onPress={() => setMode('INSTANT')} />
        <ModeCard testID="mode-schedule" art="spiral_calendar" title={t('when.schedule')} sub={t('when.scheduleSub')} selected={mode === 'SCHEDULED'} onPress={() => setMode('SCHEDULED')} />
      </View>

      {mode === 'INSTANT' ? (
        <Appear>
          <Banner tone="success" icon="flash" text={t('when.instantNote')} testID="instant-note" />
        </Appear>
      ) : null}

      {mode === 'SCHEDULED' ? (
        <Appear style={styles.block}>
          <Txt variant="label" color="inkMuted">{t('schedule.date')}</Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.days}>
            {dates.map((d) => {
              const id = isoDate(d);
              const on = id === date;
              const top = id === today ? t('schedule.today') : id === tomorrow ? t('schedule.tomorrow') : weekdayShort(d, locale);
              return (
                <Tap key={id} onPress={() => setDate(id)} style={[styles.day, on && styles.dayOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${top} ${d.getDate()} ${monthShort(d, locale)}`} testID={`day-${id}`} haptic>
                  <Txt variant="caption" color={on ? 'onNavy' : 'inkMuted'} numberOfLines={1}>{top}</Txt>
                  <Txt variant="title2" color={on ? 'onNavy' : 'ink'}>{d.getDate()}</Txt>
                  <Txt variant="caption" color={on ? 'onNavy' : 'inkMuted'}>{monthShort(d, locale)}</Txt>
                </Tap>
              );
            })}
          </ScrollView>

          <Txt variant="label" color="inkMuted">{t('schedule.time')}</Txt>
          {slots.loading ? <View style={styles.grid}>{Array.from({ length: 6 }, (_, k) => <Skeleton key={k} style={styles.skel} />)}</View> : null}
          {slots.error ? <ErrorView error={slots.error} onRetry={slots.reload} title={t('schedule.loadError')} /> : null}
          {slots.data && !slots.loading && open.length === 0 ? <Banner tone="warning" text={t('schedule.noneLeft')} testID="no-slots" /> : null}
          {slots.data && !slots.loading ? PARTS.map((part) => {
            const inPart = (slots.data ?? []).filter((s: Slot) => s.startHour >= part.from && s.startHour < part.to);
            if (inPart.length === 0) return null;
            return (
              <View key={part.key} style={styles.part}>
                <View style={styles.partHead}>
                  <Art3D name={part.art} size={22} />
                  <Txt variant="label" color="inkMuted">{t(part.key)}</Txt>
                </View>
                <View style={styles.grid}>
                  {inPart.map((s) => {
                    const on = picked?.date === s.date && picked.startHour === s.startHour;
                    const label = formatWindow(s.startHour, s.endHour, locale);
                    const disabled = s.state !== 'OPEN';
                    return (
                      <Tap key={s.id} onPress={() => !disabled && setPicked({ date: s.date, startHour: s.startHour, endHour: s.endHour })} disabled={disabled}
                        style={[styles.slot, on && styles.slotOn, disabled && styles.slotOff]} accessibilityRole="radio" accessibilityState={{ selected: on, disabled }}
                        testID={`slot-${s.startHour}`} accessibilityLabel={disabled ? `${label}, ${t(s.state === 'FULL' ? 'schedule.full' : 'schedule.closed')}` : label} haptic>
                        <Txt variant="label" color={on ? 'onNavy' : disabled ? 'inkSubtle' : 'ink'} align="center">{label}</Txt>
                        {disabled ? <Txt variant="caption" color="inkSubtle">{t(s.state === 'FULL' ? 'schedule.full' : 'schedule.closed')}</Txt> : null}
                      </Tap>
                    );
                  })}
                </View>
              </View>
            );
          }) : null}
          <Banner tone="info" icon="time-outline" text={t('schedule.note')} />
        </Appear>
      ) : null}

      {isApiError(error, 'SLOT_UNAVAILABLE') ? <Banner tone="danger" text={t('review.slotTaken')} /> : <ErrorBanner error={error} />}
    </Screen>
  );
}

function ModeCard({ art, title, sub, selected, disabled, onPress, testID }: {
  readonly art: ArtName;
  readonly title: string;
  readonly sub: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Tap onPress={onPress} disabled={disabled} haptic style={[styles.mode, selected && styles.modeOn, disabled && styles.modeOff]} testID={testID}
      accessibilityRole="radio" accessibilityState={{ selected, disabled: !!disabled }} accessibilityLabel={`${title}. ${sub}`}>
      <View style={styles.modeTop}>
        <Art3D name={art} size={52} />
        <View style={[styles.check, selected && styles.checkOn]}>{selected ? <Icon name="checkmark" size={16} color="onNavy" /> : null}</View>
      </View>
      <Txt variant="title3">{title}</Txt>
      <Txt variant="footnote" color="inkMuted">{sub}</Txt>
    </Tap>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.md },
  modes: { flexDirection: 'row', gap: space.md },
  mode: { flex: 1, gap: space.xs, padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.line, ...shadow.card },
  modeOn: { borderColor: colors.blue, backgroundColor: '#FBFCFF' },
  modeOff: { opacity: 0.55 },
  modeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.blue, borderColor: colors.blue },
  bleed: { marginHorizontal: -GUTTER },
  days: { paddingHorizontal: GUTTER, gap: space.sm },
  day: { width: 72, minHeight: 88, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line },
  dayOn: { backgroundColor: colors.navy, borderColor: colors.navy, ...shadow.button },
  part: { gap: space.sm },
  partHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  skel: { width: '48%', height: 56, borderRadius: radius.md },
  slot: { width: '48%', flexGrow: 1, minHeight: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line, paddingHorizontal: space.sm },
  slotOn: { backgroundColor: colors.blue, borderColor: colors.blue },
  slotOff: { backgroundColor: colors.surfaceMuted, borderColor: colors.surfaceMuted },
});
