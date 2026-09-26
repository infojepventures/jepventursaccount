import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { colors } from '../../ui/theme';

type IconName = keyof typeof Ionicons.glyphMap;
// tabBarIcon's `color` param type is a private react-navigation ColorValue variant (permits null) that
// isn't importable here; widen to `unknown` and cast at the call site rather than fight that internal type.
const icon = (name: IconName) => ({ color, size }: { color: unknown; size: number }) => (
  <Ionicons name={name} color={color as string} size={size} />
);

const FAB_SIZE = 62;

/** Raised round "New claim" button that sits in the middle of the tab bar, overlapping its top edge. */
function NewClaimTabButton({ onPress }: { onPress?: ((e: GestureResponderEvent) => void) | null }) {
  return (
    <View style={styles.fabSlot} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New claim"
        onPress={(e) => onPress?.(e)}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <Ionicons name="add" size={34} color={colors.primaryText} />
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  const { isAdmin } = useAuth();
  // Screen order puts New Claim in the centre: members see 3 tabs, admins see 5.
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: styles.tabBar,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'My Claims', tabBarIcon: icon('receipt-outline') }} />
      <Tabs.Screen name="review" options={{ title: 'Review', href: isAdmin ? undefined : null, tabBarIcon: icon('checkmark-done-outline') }} />
      <Tabs.Screen
        name="new"
        options={{
          title: 'New Claim',
          tabBarLabel: () => null,
          // react-navigation types onPress for both web anchors and native presses; on native it is a GestureResponderEvent.
          tabBarButton: (props) => (
            <NewClaimTabButton onPress={props.onPress as ((e: GestureResponderEvent) => void) | undefined} />
          ),
        }}
      />
      <Tabs.Screen name="users" options={{ title: 'Users', href: isAdmin ? undefined : null, tabBarIcon: icon('people-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: { overflow: 'visible', backgroundColor: colors.card, borderTopColor: colors.border },
  fabSlot: { flex: 1, alignItems: 'center' },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    marginTop: -FAB_SIZE / 2 + 4,
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabPressed: { opacity: 0.85 },
});
