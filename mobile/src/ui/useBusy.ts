import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { friendlyMessage } from '../lib/api';

/** Runs an async action with a busy flag, showing an alert on failure. */
export function useBusy(): [boolean, (fn: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Error', friendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);
  return [busy, run];
}
