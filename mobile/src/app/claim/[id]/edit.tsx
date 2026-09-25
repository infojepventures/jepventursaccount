import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { draftFromClaim, remoteAttachments } from '../../../claims/draft';
import { ClaimForm } from '../../../components/ClaimForm';
import { useClaim } from '../../../data/useClaims';
import { Screen } from '../../../ui/Screen';
import { colors, space } from '../../../ui/theme';

export default function EditClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { data: claim, loading } = useClaim(id);
  // Snapshot the claim once so live updates do not reset what the user is typing.
  const initial = useMemo(
    () => (claim ? { draft: draftFromClaim(claim), attachments: remoteAttachments(claim) } : null),
    [claim?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (loading || !initial) return <ActivityIndicator style={{ marginTop: space(10) }} color={colors.primary} />;
  if (!claim || claim.status !== 'rejected' || claim.applicant.uid !== user?.uid) {
    return <Screen><Text>Only your rejected claims can be edited.</Text></Screen>;
  }
  return (
    <ClaimForm
      claimId={claim.id}
      resubmit
      initialDraft={initial.draft}
      initialAttachments={initial.attachments}
      showSaveBank={false}
      submitLabel="Resubmit claim"
      onSubmitted={() => router.back()}
    />
  );
}
