// The Call button's behaviour, shared by the customer's booking and the technician's job: masked call, else a call back
// from Housefi, with a short message for each outcome.
import { useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { dial, maskedCall, SUPPORT_PHONE } from '../services/calls';
import { useBackend } from '../services/ServicesProvider';
import { feedback } from '../services/feedback';
import { useToast } from './Overlays';

export function useMaskedCall(token: string, bookingId: string, getNumber: () => Promise<{ readonly dialNumber: string }>) {
  const { t } = useI18n();
  const backend = useBackend();
  const toast = useToast();
  const [calling, setCalling] = useState(false);
  const call = async () => {
    if (calling) return;
    setCalling(true);
    const outcome = await maskedCall(backend, token, bookingId, getNumber);
    setCalling(false);
    if (outcome === 'CALLBACK') {
      feedback('success');
      toast.show(t('call.callback'), 'call');
    } else if (outcome === 'NOT_NOW') toast.show(t('call.notNow'), 'time');
    else if (outcome === 'FAILED') toast.show(t('call.failed'), 'alert-circle');
  };
  return { calling, call };
}

/**
 * "Call customer care": dials Housefi's support number when the build has one, else asks for a call back (the team
 * sees it in the support queue and calls the person).
 */
export function useCareCall(token: string, bookingId: string | null = null) {
  const { t } = useI18n();
  const backend = useBackend();
  const toast = useToast();
  const [calling, setCalling] = useState(false);
  const call = async () => {
    if (calling) return;
    if (SUPPORT_PHONE && (await dial(SUPPORT_PHONE))) return;
    setCalling(true);
    try {
      await backend.support.callback(token, bookingId, 'customer care from the app');
      feedback('success');
      toast.show(t('call.callback'), 'call');
    } catch {
      toast.show(t('call.failed'), 'alert-circle');
    } finally {
      setCalling(false);
    }
  };
  return { calling, call };
}
