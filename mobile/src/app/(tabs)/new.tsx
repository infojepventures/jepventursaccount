import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { emptyDraft } from '../../claims/draft';
import { ClaimForm } from '../../components/ClaimForm';
import { newClaimId } from '../../lib/firebase';

export default function NewClaimTab() {
  const { user } = useAuth();
  const router = useRouter();
  const [round, setRound] = useState(0);
  // A fresh claim id per form. After a successful submit the form resets with a new id.
  const claimId = useMemo(() => newClaimId(), [round]); // eslint-disable-line react-hooks/exhaustive-deps
  const initialDraft = useMemo(() => emptyDraft(user?.bank ?? null), [round]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ClaimForm
      key={claimId}
      claimId={claimId}
      resubmit={false}
      initialDraft={initialDraft}
      initialAttachments={[]}
      showSaveBank
      submitLabel="Submit claim"
      onSubmitted={(ids) => {
        setRound((r) => r + 1);
        if (ids.length === 1) {
          router.push({ pathname: '/claim/[id]', params: { id: ids[0]! } });
        } else {
          // Items paying different people went in as one claim each.
          router.push('/');
          Alert.alert('Submitted', `Your items were submitted as ${ids.length} claims, one per payee.`);
        }
      }}
      // A fresh claim id and an empty form; the old one's leftover (empty) upload folder is swept up daily.
      onDiscarded={() => setRound((r) => r + 1)}
    />
  );
}
