import { Text } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { ProfileForm } from '../components/ProfileForm';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { colors } from '../ui/theme';

export default function ProfileSetupScreen() {
  const { signOut } = useAuth();
  return (
    <Screen>
      <Text style={{ fontSize: 15, color: colors.muted }}>
        Before your first claim, tell us who you are and where to send reimbursements.
      </Text>
      <ProfileForm submitLabel="Save and continue" />
      <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}
