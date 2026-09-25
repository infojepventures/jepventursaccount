import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Switch, Text, View, type KeyboardTypeOptions } from 'react-native';
import { Button } from './Button';
import { TextField } from './TextField';
import { colors, radius, space } from './theme';
import { useBusy } from './useBusy';

export type PromptField = {
  key: string;
  label: string;
  type?: 'text' | 'switch';
  placeholder?: string;
  initial?: string | boolean;
  multiline?: boolean;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words';
};

const initialValues = (fields: PromptField[]) =>
  Object.fromEntries(fields.map((f) => [f.key, f.initial ?? (f.type === 'switch' ? false : '')]));

export function PromptModal(p: {
  visible: boolean;
  title: string;
  message?: string;
  fields: PromptField[];
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: (values: Record<string, string | boolean>) => Promise<void> | void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => initialValues(p.fields));
  const [busy, run] = useBusy();

  useEffect(() => {
    if (p.visible) setValues(initialValues(p.fields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.visible]);

  return (
    <Modal visible={p.visible} transparent animationType="fade" onRequestClose={p.onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{p.title}</Text>
          {p.message ? <Text style={styles.message}>{p.message}</Text> : null}
          {p.fields.map((f) =>
            f.type === 'switch' ? (
              <View key={f.key} style={styles.switchRow}>
                <Text style={styles.switchLabel}>{f.label}</Text>
                <Switch value={!!values[f.key]} onValueChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
              </View>
            ) : (
              <TextField
                key={f.key}
                label={f.label}
                placeholder={f.placeholder}
                value={String(values[f.key] ?? '')}
                onChangeText={(t) => setValues((s) => ({ ...s, [f.key]: t }))}
                multiline={f.multiline}
                secureTextEntry={f.secure}
                keyboardType={f.keyboardType}
                autoCapitalize={f.autoCapitalize ?? 'sentences'}
              />
            ),
          )}
          <View style={styles.actions}>
            <View style={styles.flex}>
              <Button title="Cancel" variant="secondary" onPress={p.onCancel} disabled={busy} />
            </View>
            <View style={styles.flex}>
              <Button
                title={p.confirmLabel}
                variant={p.destructive ? 'danger' : 'primary'}
                loading={busy}
                onPress={() => run(async () => { await p.onConfirm(values); })}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: space(5) },
  sheet: { backgroundColor: colors.card, borderRadius: radius, padding: space(5), gap: space(3) },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  message: { fontSize: 14, color: colors.muted },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchLabel: { fontSize: 15, color: colors.text },
  actions: { flexDirection: 'row', gap: space(3), marginTop: space(2) },
  flex: { flex: 1 },
});
