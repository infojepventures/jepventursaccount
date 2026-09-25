import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { useInvites, useUsers, type UserRow } from '../../data/useUsers';
import { api } from '../../lib/apiInstance';
import { Button } from '../../ui/Button';
import { PromptModal } from '../../ui/PromptModal';
import { Screen } from '../../ui/Screen';
import { Section } from '../../ui/Section';
import { colors, space } from '../../ui/theme';
import { useBusy } from '../../ui/useBusy';

export default function UsersTab() {
  const { user: me, isAdmin } = useAuth();
  const users = useUsers(isAdmin);
  const invites = useInvites(isAdmin);
  const [modal, setModal] = useState<'invite' | 'create' | null>(null);
  const [busy, run] = useBusy();

  if (!isAdmin) return null;

  const manage = (u: UserRow) => {
    if (u.uid === me?.uid) {
      Alert.alert('This is you', 'Ask another admin to change your own role or status.');
      return;
    }
    Alert.alert(u.name || u.email, `${u.email}\n${u.role === 'admin' ? 'Admin' : 'Member'} · ${u.active ? 'Active' : 'Deactivated'}`, [
      {
        text: u.role === 'admin' ? 'Make member' : 'Make admin',
        onPress: () => void run(async () => { await api.adminUsers({ action: 'setRole', uid: u.uid, role: u.role === 'admin' ? 'member' : 'admin' }); }),
      },
      {
        text: u.active ? 'Deactivate' : 'Reactivate',
        style: u.active ? 'destructive' : 'default',
        onPress: () => void run(async () => { await api.adminUsers({ action: 'setActive', uid: u.uid, active: !u.active }); }),
      },
      { text: 'Close', style: 'cancel' },
    ]);
  };

  return (
    <Screen>
      <View style={styles.row}>
        <View style={styles.flex}><Button title="Invite Google" icon="logo-google" onPress={() => setModal('invite')} /></View>
        <View style={styles.flex}><Button title="Email account" icon="mail-outline" variant="secondary" onPress={() => setModal('create')} /></View>
      </View>

      {invites.data.length ? (
        <Section title={`Pending invites (${invites.data.length})`}>
          {invites.data.map((inv) => (
            <View key={inv.email} style={styles.userRow}>
              <View style={styles.flex}>
                <Text style={styles.name}>{inv.email}</Text>
                <Text style={styles.meta}>{inv.role === 'admin' ? 'Admin' : 'Member'} · waiting for first sign-in</Text>
              </View>
              <Pressable onPress={() => void run(async () => { await api.adminUsers({ action: 'deleteInvite', email: inv.email }); })}>
                <Text style={styles.danger}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </Section>
      ) : null}

      <Section title={`Users (${users.data.length})`}>
        {users.data.map((u) => (
          <Pressable key={u.uid} style={styles.userRow} onPress={() => manage(u)}>
            <View style={styles.flex}>
              <Text style={[styles.name, !u.active && styles.inactive]}>{u.name || '(no name yet)'}{u.uid === me?.uid ? ' (you)' : ''}</Text>
              <Text style={styles.meta}>{u.email} · {u.authProvider === 'google' ? 'Google' : 'Email'}</Text>
            </View>
            <Text style={[styles.role, u.role === 'admin' && styles.admin]}>{u.active ? (u.role === 'admin' ? 'Admin' : 'Member') : 'Inactive'}</Text>
          </Pressable>
        ))}
      </Section>

      <Section title="Google Sheet">
        <Text style={styles.meta}>If a Sheet update failed, push all unsynced claims again.</Text>
        <Button
          title="Resync Sheet"
          variant="secondary"
          icon="sync-outline"
          loading={busy}
          onPress={() => run(async () => {
            const r = await api.resyncSheet();
            Alert.alert('Sheet resync', `${r.synced} synced, ${r.failed} failed.`);
          })}
        />
      </Section>

      <PromptModal
        visible={modal === 'invite'}
        title="Invite a Google account"
        message="They can sign in with Google using exactly this email (Gmail or company account)."
        fields={[
          { key: 'email', label: 'Email', keyboardType: 'email-address', autoCapitalize: 'none' },
          { key: 'admin', label: 'Admin', type: 'switch' },
        ]}
        confirmLabel="Invite"
        onCancel={() => setModal(null)}
        onConfirm={async (v) => {
          await api.adminUsers({ action: 'invite', email: String(v.email), role: v.admin ? 'admin' : 'member' });
          setModal(null);
        }}
      />
      <PromptModal
        visible={modal === 'create'}
        title="Create email account"
        message="Share the password with the member privately; they sign in with email and password."
        fields={[
          { key: 'name', label: 'Full name', autoCapitalize: 'words' },
          { key: 'email', label: 'Email', keyboardType: 'email-address', autoCapitalize: 'none' },
          { key: 'password', label: 'Initial password (min 8 characters)', secure: true, autoCapitalize: 'none' },
          { key: 'admin', label: 'Admin', type: 'switch' },
        ]}
        confirmLabel="Create"
        onCancel={() => setModal(null)}
        onConfirm={async (v) => {
          await api.adminUsers({
            action: 'createPasswordUser',
            name: String(v.name),
            email: String(v.email),
            password: String(v.password),
            role: v.admin ? 'admin' : 'member',
          });
          setModal(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space(3) },
  flex: { flex: 1 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(1) },
  name: { fontWeight: '600', color: colors.text },
  inactive: { color: colors.muted, textDecorationLine: 'line-through' },
  meta: { color: colors.muted, fontSize: 13 },
  role: { color: colors.muted, fontWeight: '600' },
  admin: { color: colors.text },
  danger: { color: colors.danger, fontWeight: '600' },
});
