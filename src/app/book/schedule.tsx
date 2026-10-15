// Step 4: date and two-hour arrival window. Also used to reschedule a booking (?reschedule=<bookingId>).
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { bookableDates, isoDate } from '../../domain/rules';
import type { Slot, VisitWindow } from '../../domain/types';
import { formatWindow, monthShort, weekdayShort } from '../../i18n/format';
import { useI18n, type StringKey } from '../../i18n/I18n';
import { isApiError } from '../../services/api';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { colors, GUTTER, radius, shadow, space } from '../../theme/tokens';
import { Banner, Button, ErrorBanner, ErrorView, Header, Icon, Screen, Skeleton, Tap, Txt, useToast } from '../../ui';
import { StepHeader } from '../../ui/StepHeader';

const PARTS: readonly { key: StringKey; icon: 'sunny-outline' | 'partly-sunny-outline' | 'moon-outline'; from: number; to: number }[] = [
  { key: 'schedule.morning', icon: 'sunny-outline', from: 0, to: 12 },
  { key: 'schedule.afternoon', icon: 'partly-sunny-outline', from: 12, to: 16 },
  { key: 'schedule.evening', icon: 'moon-outline', from: 16, to: 24 },
];

export default function ScheduleStep() {
  const { reschedule } = useLocalSearchParams<{ reschedule?: string }>();
  const { t, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const toast = useToast();
  const { draft, setWindow } = useDraft();
  const dates = useMemo(() => bookableDates(new Date()), []);
  const booking = useQuery(async () => (reschedule ? backend.bookings.get(session.token, reschedule) : null), [reschedule, backend, session.token]);
  const serviceId = reschedule ? booking.data?.serviceId : draft.serviceId;
  const initial = reschedule ? null : draft.window;
  const [date, setDate] = useState(initial?.date ?? isoDate(dates[0] ?? new Date()));
  const [picked, setPicked] = useState<VisitWindow | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const slots = useQuery(async () => (serviceId ? backend.bookings.slots(serviceId, date) : []), [serviceId, date, backend]);
  const open = (slots.data ?? []).filter((s) => s.state === 'OPEN');

  // On first load, jump past "today" when nothing is left today.
  const [autoSkipped, setAutoSkipped] = useState(false);
  useEffect(() => {
    if (autoSkipped || !slots.data || picked) return;
    setAutoSkipped(true);
    if (open.length === 0 && date === isoDate(dates[0] ?? new Date()) && dates[1]) setDate(isoDate(dates[1]));
  }, [slots.data, open.length, autoSkipped, picked, date, dates]);

  if (!reschedule && !draft.serviceId) return <Redirect href="/home" />;

  const choose = (s: Slot) => {
    if (s.state !== 'OPEN') return;
    setPicked({ date: s.date, startHour: s.startHour, endHour: s.endHour });
    setError(null);
  };

  const next = async () => {
    if (!picked) return;
    if (!reschedule) {
      setWindow(picked);
      router.push('/book/review');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await backend.bookings.reschedule(session.token, reschedule, picked);
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

  const today = isoDate(dates[0] ?? new Date());
  const tomorrow = isoDate(dates[1] ?? new Date());

  return (
    <Screen
      testID="book-schedule"
      header={reschedule ? <Header title={t('schedule.reschedule')} /> : <StepHeader step={4} />}
      footer={<Button label={reschedule ? t('schedule.confirmNew') : t('common.next')} trailingIcon={reschedule ? undefined : 'arrow-forward'} disabled={!picked} loading={busy} onPress={() => void next()} testID="schedule-next" />}
    >
      {!reschedule ? <Txt variant="title1" heading>{t('schedule.title')}</Txt> : null}
      {booking.error ? <ErrorView error={booking.error} onRetry={booking.reload} /> : null}

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
        const inPart = (slots.data ?? []).filter((s) => s.startHour >= part.from && s.startHour < part.to);
        if (inPart.length === 0) return null;
        return (
          <View key={part.key} style={styles.part}>
            <View style={styles.partHead}>
              <Icon name={part.icon} size={18} color="inkMuted" />
              <Txt variant="label" color="inkMuted">{t(part.key)}</Txt>
            </View>
            <View style={styles.grid}>
              {inPart.map((s) => {
                const on = picked?.date === s.date && picked.startHour === s.startHour;
                const label = formatWindow(s.startHour, s.endHour, locale);
                const disabled = s.state !== 'OPEN';
                return (
                  <Tap key={s.id} onPress={() => choose(s)} disabled={disabled} style={[styles.slot, on && styles.slotOn, disabled && styles.slotOff]}
                    accessibilityRole="radio" accessibilityState={{ selected: on, disabled }} testID={`slot-${s.startHour}`}
                    accessibilityLabel={disabled ? `${label}, ${t(s.state === 'FULL' ? 'schedule.full' : 'schedule.closed')}` : label} haptic>
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
      {isApiError(error, 'SLOT_UNAVAILABLE') ? <Banner tone="danger" text={t('review.slotTaken')} /> : <ErrorBanner error={error} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
