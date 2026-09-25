import { Alert, Text } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { ProfileForm } from '../../components/ProfileForm';
import { Button } from '../../ui/Button';
import { Screen } from '../../ui/Screen';
import { colors } from '../../ui/theme';

export default function ProfileTab() {
  const { user, signOut } = useAuth();
  return (
    <Screen>
      <Text style={{ color: colors.muted }}>
        Signed in as {user?.email} · {user?.role === 'admin' ? 'Admin' : 'Member'}
      </Text>
      <ProfileForm submitLabel="Save profile" onSaved={() => Alert.alert('Saved', 'Your profile has been updated.')} />
      <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={() => void signOut()} />
    </Screen>
  );
}
