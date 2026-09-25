import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useState } from 'react';
import { Alert } from 'react-native';
import { validateBank } from '@jep/shared';
import { useAuth } from '../auth/AuthProvider';
import { db } from '../lib/firebase';
import { Button } from '../ui/Button';
import { Section } from '../ui/Section';
import { TextField } from '../ui/TextField';
import { useBusy } from '../ui/useBusy';

export function ProfileForm({ submitLabel, onSaved }: { submitLabel: string; onSaved?: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [position, setPosition] = useState(user?.position ?? '');
  const [bankName, setBankName] = useState(user?.bank?.bankName ?? '');
  const [accountHolder, setAccountHolder] = useState(user?.bank?.accountHolder ?? '');
  const [accountNumber, setAccountNumber] = useState(user?.bank?.accountNumber ?? '');
  const [busy, run] = useBusy();

  const save = () =>
    run(async () => {
      if (!user) return;
      const bank = { bankName: bankName.trim(), accountHolder: accountHolder.trim(), accountNumber: accountNumber.trim() };
      const errors = [
        ...(name.trim() ? [] : ['Name is required']),
        ...(position.trim() ? [] : ['Position is required']),
        ...validateBank(bank),
      ];
      if (errors.length) {
        Alert.alert('Please check your details', errors.join('\n'));
        return;
      }
      await updateDoc(doc(db, 'users', user.uid), { name: name.trim(), position: position.trim(), bank, updatedAt: serverTimestamp() });
      onSaved?.();
    });

  return (
    <>
      <Section title="About you">
        <TextField label="Full name (as shown on claims)" value={name} onChangeText={setName} autoCapitalize="words" />
        <TextField label="Position" value={position} onChangeText={setPosition} autoCapitalize="words" />
        <TextField label="Email" value={user?.email ?? ''} editable={false} />
      </Section>
      <Section title="Bank details for reimbursement">
        <TextField label="Bank" value={bankName} onChangeText={setBankName} placeholder="e.g. Maybank" />
        <TextField label="Account holder" value={accountHolder} onChangeText={setAccountHolder} autoCapitalize="words" />
        <TextField label="Account number" value={accountNumber} onChangeText={setAccountNumber} keyboardType="number-pad" />
      </Section>
      <Button title={submitLabel} onPress={save} loading={busy} />
    </>
  );
}
