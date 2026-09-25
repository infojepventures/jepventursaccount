import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { routeFor } from '../auth/routeFor';
import { colors } from '../ui/theme';

function Gate() {
  const auth = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const first = segments[0] as string | undefined;

  useEffect(() => {
    const target = routeFor(auth, first);
    if (target) router.replace(target);
  }, [auth.status, auth.profileComplete, first]); // eslint-disable-line react-hooks/exhaustive-deps

  if (auth.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="profile-setup" options={{ title: 'Your profile', headerBackVisible: false }} />
      <Stack.Screen name="claim/[id]/index" options={{ title: 'Claim' }} />
      <Stack.Screen name="claim/[id]/edit" options={{ title: 'Edit & resubmit' }} />
      <Stack.Screen name="viewer" options={{ title: 'Attachment' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
