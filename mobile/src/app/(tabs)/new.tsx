import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
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
      onSubmitted={(id) => {
        setRound((r) => r + 1);
        // /claim/[id] route is added in Task 6; cast until it exists.
        router.push({ pathname: '/claim/[id]', params: { id } } as never);
      }}
    />
  );
}
