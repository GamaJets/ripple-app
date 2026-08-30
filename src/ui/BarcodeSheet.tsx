// Look a product up by barcode and log it.
//
// ── Why this is a component and not two copies ─────────────────────────────
//
// There were two "Barcode" buttons in the client app. The one on Meals opened a
// sheet, read the number in Open Food Facts and logged the real macros. The one
// on the Food Log — which is the screen actually called "log a meal" — did not.
// It once logged a hardcoded protein bar on every press, which was rightly torn
// out, and what replaced it was an alert saying nothing had been scanned and
// that the real lookup lives on the other screen.
//
// So the Food Log had a button whose entire function was to say it did not
// work and name somewhere else. A tester put it plainly: "Have this issue that
// needs to be resolved one way or the other."
//
// Resolved by making it work. Both screens log through the same `useFoodLog`,
// so the sheet had no reason to belong to either of them — and copying forty
// lines of modal into the second screen is how the two calorie sums on these
// same two screens came to disagree by a thousand kilocalories. One component.
import { useState } from 'react';
import { View, Text, Modal, Pressable, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useTheme } from './components';
import { lookupBarcode, normalizeBarcode } from '../lib/openfoodfacts';
import { radius, elevation, sp, type as ty, numeric } from '../theme/scale';

export interface LoggedFood {
  name: string; kcal: number; protein: number; carbs: number; fat: number;
}

export function BarcodeSheet({
  visible,
  onClose,
  onLogged,
}: {
  visible: boolean;
  onClose: () => void;
  /** Called with the product once it has been read. The caller does the logging,
   *  so this component never needs to know which diary it is writing to. */
  onLogged: (food: LoggedFood) => void;
}) {
  const t = useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!normalizeBarcode(code)) {
      Alert.alert('Enter a barcode', 'Type the 8–13 digit number under the barcode.');
      return;
    }
    setBusy(true);
    const p = await lookupBarcode(code);
    setBusy(false);
    if (!p) {
      // Not found is a fact about this barcode, not about the app. Say which.
      Alert.alert('Not found', 'No match in the Open Food Facts database for that barcode. Try “Describe it” instead.');
      return;
    }
    onLogged({ name: p.name, kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat });
    setCode('');
    onClose();
  };

  const close = () => { setCode(''); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={close} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 }}>
          <Text style={{ ...ty.title, color: t.ink }}>Scan a Barcode</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>
            Type the number under the barcode — we look it up in Open Food Facts and add the real macros.
          </Text>
          <TextInput
            value={code} onChangeText={setCode}
            placeholder="e.g. 0049000042566" placeholderTextColor={t.ink3}
            keyboardType="number-pad" returnKeyType="done" onSubmitEditing={run} autoFocus
            accessibilityLabel="Barcode number"
            style={{ ...ty.head, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: 13, letterSpacing: 1, marginBottom: sp.md }} />
          <Pressable onPress={run} disabled={busy} accessibilityRole="button" accessibilityLabel="Look up and log"
            style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center', marginBottom: sp.sm }}>
            {busy ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>Look up &amp; log</Text>}
          </Pressable>
          <Pressable onPress={close} style={{ paddingVertical: 10, alignItems: 'center' }} accessibilityRole="button">
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
