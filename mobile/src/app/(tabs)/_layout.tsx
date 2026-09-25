import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { colors } from '../../ui/theme';

type IconName = keyof typeof Ionicons.glyphMap;
// tabBarIcon's `color` param type is a private react-navigation ColorValue variant (permits null) that
// isn't importable here; widen to `unknown` and cast at the call site rather than fight that internal type.
const icon = (name: IconName) => ({ color, size }: { color: unknown; size: number }) => (
  <Ionicons name={name} color={color as string} size={size} />
);

export default function TabsLayout() {
  const { isAdmin } = useAuth();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'My Claims', tabBarIcon: icon('receipt-outline') }} />
      <Tabs.Screen name="new" options={{ title: 'New Claim', tabBarIcon: icon('add-circle-outline') }} />
      <Tabs.Screen name="review" options={{ title: 'Review', href: isAdmin ? undefined : null, tabBarIcon: icon('checkmark-done-outline') }} />
      <Tabs.Screen name="users" options={{ title: 'Users', href: isAdmin ? undefined : null, tabBarIcon: icon('people-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
