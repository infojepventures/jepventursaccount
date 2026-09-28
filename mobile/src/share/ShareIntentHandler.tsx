import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { fromSharedFiles } from '../claims/pickers';
import { handoff, type IncomingFile } from './handoff';

/**
 * Files shared to JEP Claims (Share, or "Open with") from another app: once signed in, asks whether they are
 * receipts for a new claim or (admins) the payment slip for an approved claim, then hands them to that screen.
 */
export function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const auth = useAuth();
  const router = useRouter();
  // Kept here rather than in the share-intent state, which resets whenever the app goes to the background
  // (for example during Google sign-in).
  const [incoming, setIncoming] = useState<IncomingFile[] | null>(null);

  useEffect(() => {
    if (!hasShareIntent) return;
    const files = (shareIntent.files ?? []).filter((f) => f.path) as IncomingFile[];
    if (files.length) setIncoming(files);
    resetShareIntent();
  }, [hasShareIntent]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = auth.status === 'signedIn' && auth.profileComplete;
  useEffect(() => {
    if (!incoming || !ready) return;
    const files = incoming;
    setIncoming(null);

    const toClaim = async () => {
      const attachments = await fromSharedFiles(files);
      if (!attachments.length) return;
      handoff.give('claim', attachments);
      router.navigate('/new');
    };
    const toSlip = async () => {
      const [slip] = await fromSharedFiles(files.slice(0, 1));
      if (!slip) return;
      handoff.give('slip', [slip]);
      router.push('/pay-slip');
    };

    const count = files.length === 1 ? 'this file' : `these ${files.length} files`;
    Alert.alert(
      'Shared to JEP Claims',
      auth.isAdmin
        ? `What would you like to do with ${count}?${files.length > 1 ? '\n(A payment slip uses the first file.)' : ''}`
        : `Create a new claim with ${count}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        ...(auth.isAdmin ? [{ text: 'Payment slip', onPress: () => void toSlip() }] : []),
        { text: 'Create claim', onPress: () => void toClaim() },
      ],
    );
  }, [incoming, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
