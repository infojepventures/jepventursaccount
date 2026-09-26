import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { colors, space } from '../ui/theme';
import { useBusy } from '../ui/useBusy';

export default function LoginScreen() {
  const { signInWithGoogle, signInWithEmail, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, run] = useBusy();

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.hero}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} contentFit="contain" />
        <Text style={styles.title}>JEP Claims</Text>
        <Text style={styles.subtitle}>Expense claims for JEP Ventures</Text>
      </View>
      <View style={styles.form}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Sign in with Google" icon="logo-google" onPress={() => run(signInWithGoogle)} loading={busy} />
        <Text style={styles.or}>or sign in with the account your admin created</Text>
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
        <Button
          title="Sign in"
          variant="secondary"
          disabled={!email || !password}
          loading={busy}
          onPress={() => run(() => signInWithEmail(email, password))}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: space(6), justifyContent: 'center', gap: space(8) },
  hero: { alignItems: 'center', gap: space(2) },
  logo: { width: 96, height: 96, borderRadius: 20 },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 15, color: colors.muted },
  form: { gap: space(3) },
  or: { textAlign: 'center', color: colors.muted, fontSize: 13, marginVertical: space(2) },
  error: { color: colors.danger, textAlign: 'center', fontSize: 14 },
});
