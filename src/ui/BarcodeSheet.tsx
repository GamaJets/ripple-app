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
//
// ── Why the camera is now in here ──────────────────────────────────────────
//
// Both entry points are labelled "Barcode". The accessibility label on one of
// them says, in as many words, "Scan a barcode". The sheet's own title said
// "Scan a Barcode". And what opened was a number pad and the sentence "Type the
// number under the barcode."
//
// Nobody types thirteen digits off a yoghurt pot in a supermarket. The whole
// value of a barcode is that a machine reads it, and this app already reads
// barcodes: `app/(client)/scan-machine.tsx` has driven `expo-camera`'s
// CameraView with `onBarcodeScanned` since it was written, expo-camera has been
// a dependency the whole time, and NSCameraUsageDescription is already in the
// build (scripts/check-native.mjs enforces it). The camera was one screen away
// the entire time this sheet was telling people to read digits aloud to
// themselves.
//
// The camera pattern here is scan-machine's, deliberately, down to the shape of
// the permission Notice — including its `!permission` arm, which is the tick
// before `useCameraPermissions` has answered and is NOT the same thing as a
// refusal.
//
// ── Why typing survives ────────────────────────────────────────────────────
//
// Three cases, and none of them is rare:
//
//   · the permission is refused, or was refused once and the OS will not ask
//     again — the only remaining way in is the keyboard;
//   · the label is scuffed, curved round a tin, or under cling film, and the
//     scanner simply will not lock on;
//   · the phone has no camera the app can reach at all.
//
// A scanner that replaces the keyboard turns each of those into a dead end, on
// a screen whose entire job is to record a meal. So the keyboard is still here,
// one tap away, and is what opens when the permission is not granted.
import { useState } from 'react';
import { View, Text, Modal, Pressable, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from './components';
import { lookupBarcode, normalizeBarcode } from '../lib/openfoodfacts';
import { radius, elevation, sp, type as ty, numeric } from '../theme/scale';

export interface LoggedFood {
  name: string; kcal: number;
  /** Null where Open Food Facts recorded nothing for it. These were `number`,
   *  and a product with only an energy figure arrived as protein 0, carbs 0,
   *  fat 0 — so `missingMacros` never fired and the log sheet pre-filled three
   *  zeros for the member to confirm. See `OffProduct` in
   *  src/lib/openfoodfacts.ts and the rule at the top of src/lib/foodPortion.ts. */
  protein: number | null; carbs: number | null; fat: number | null;
  /** What those figures are FOR — '100 g', '1 serving', '330 ml' — exactly as
   *  Open Food Facts described the basis it used.
   *
   *  It used to be dropped here, and dropping it is what made the portion
   *  question unaskable: a caller handed four numbers and no basis cannot say
   *  "how many of these did you have" without inventing what one of them is.
   *  A member scanning a 500 g yogurt pot and eating all of it logged 100 g. */
  basis: string | null;
}

/**
 * The symbologies actually printed on food.
 *
 * Listed rather than left to the default, which is "everything the OS can do" —
 * QR codes included. A camera pointed at a shelf in a supermarket will find a
 * QR code on a promotion card long before it finds the EAN on the tin, and it
 * would hand this sheet a URL to look up in a food database.
 *
 * EAN-13 is the European retail barcode, EAN-8 is its short form for small
 * packs, UPC-A and UPC-E are the North American pair, and Open Food Facts is
 * keyed on exactly these.
 */
const FOOD_BARCODES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

export function BarcodeSheet({
  visible,
  onClose,
  onLogged,
}: {
  visible: boolean;
  onClose: () => void;
  /** Called with the product once it has been read. The caller does the logging
   *  — and asks the portion, through src/ui/LogFoodSheet.tsx — so this
   *  component never needs to know which diary it is writing to. */
  onLogged: (food: LoggedFood) => void;
}) {
  const t = useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  // Whether the member has asked for the keyboard instead. Separate from the
  // permission: somebody whose camera works perfectly may still be holding an
  // empty wrapper they have already thrown the food away from, and typing is
  // the only way in for a label that will not scan.
  const [typing, setTyping] = useState(false);
  // The code the camera last handed over, so a shelf full of tins does not fire
  // a lookup a frame. `onBarcodeScanned` is called continuously while a code is
  // in view — scan-machine.tsx guards the same way with its `scanned` state.
  const [seen, setSeen] = useState<string | null>(null);

  /**
   * Look a code up and hand the product back, or say why not.
   *
   * `from` names how the code arrived, because the two failures need different
   * sentences: a typo is a thing to retype, and a scan that found no match is a
   * fact about the database rather than about the aim of the camera.
   */
  const run = async (raw: string, from: 'camera' | 'keyboard') => {
    if (!normalizeBarcode(raw)) {
      if (from === 'keyboard') Alert.alert('Enter a barcode', 'Type the 8–13 digit number under the barcode.');
      return;
    }
    setBusy(true);
    const out = await lookupBarcode(raw);
    setBusy(false);
    if (!out.ok) {
      // Five different things, and they used to be one sentence blaming the
      // database. "We could not ask" and "there is no such product" are not the
      // same fact, and on a supermarket's bad signal it was always the first
      // one being reported as the second.
      const scanned = from === 'camera' ? `That barcode read as ${raw}. ` : '';
      const said = out.reason === 'busy'
        ? { title: 'Could not check', body: `${scanned}The food database is busy right now, so we could not look this up. That says nothing about whether the product is in there — try again in a moment, or use “Describe it”.` }
        : out.reason === 'offline'
        ? { title: 'Could not check', body: `${scanned}We could not reach the food database, so we could not look this up. Nothing has been logged, and this says nothing about whether the product is in there. Try again when you have signal, or use “Describe it”.` }
        : out.reason === 'no-nutrition'
        ? { title: 'No figures for it', body: `${scanned}That product is in the Open Food Facts database, but it has no nutrition recorded — so there is nothing to log from it. Enter it with “Describe it” instead.` }
        : out.reason === 'bad-code'
        ? { title: 'Not a barcode', body: 'That is not an 8 to 13 digit barcode. Type the number printed under the bars.' }
        : { title: 'Not found', body: `${scanned}There is no match for it in the Open Food Facts database. Try “Describe it” instead.` };
      Alert.alert(said.title, said.body,
        // Cleared on the way out, or the camera would refuse to try the same
        // pack twice — and "it did nothing the second time" is how a member
        // concludes the scanner is broken.
        [{ text: 'OK', onPress: () => setSeen(null) }]);
      return;
    }
    const p = out.product;
    onLogged({ name: p.name, kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat, basis: p.serving || null });
    close();
  };

  const onScan = ({ data }: { data: string }) => {
    // One lookup per code. The callback fires on every frame the code is in
    // view, and without this a single tin would start a dozen network reads and
    // log the same yoghurt a dozen times.
    if (busy || seen != null) return;
    const clean = normalizeBarcode(data);
    if (!clean) return;   // a code this database is not keyed on — keep looking
    setSeen(clean);
    void run(clean, 'camera');
  };

  const close = () => { setCode(''); setSeen(null); setTyping(false); onClose(); };

  // The keyboard, not the camera, whenever the camera is not an option. A
  // refused permission must not leave this sheet showing a black rectangle with
  // no way forward — the screen's job is to record a meal, and there is another
  // way to do that.
  const scanning = !typing && permission?.granted === true;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={close}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 }}>
          <Text style={{ ...ty.title, color: t.ink }}>Scan a Barcode</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>
            {scanning
              ? 'Point the camera at the barcode — we look it up in Open Food Facts and add the real macros.'
              : 'Type the number under the barcode — we look it up in Open Food Facts and add the real macros.'}
          </Text>

          {scanning ? (<>
            <View accessible accessibilityLabel="Camera, pointed at a barcode" accessibilityRole="image"
              style={{ borderRadius: radius.md, overflow: 'hidden', aspectRatio: 4 / 3, backgroundColor: '#000', marginBottom: sp.md }}>
              <CameraView style={{ flex: 1 }} facing="back"
                barcodeScannerSettings={{ barcodeTypes: [...FOOD_BARCODES] }}
                onBarcodeScanned={onScan}>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  {/* Wide and short, because a food barcode is wide and short —
                      a square reticle borrowed from the QR scanner would have
                      people holding the phone in the wrong orientation. */}
                  <View style={{ width: '78%', aspectRatio: 2.4, borderWidth: 2, borderColor: t.brand, borderRadius: radius.sm }} />
                  <Text style={{ ...ty.label, fontWeight: '500', color: '#fff', marginTop: sp.lg }}>
                    {busy ? 'Looking it up…' : 'Hold the barcode inside the box'}
                  </Text>
                </View>
              </CameraView>
            </View>
            <Pressable onPress={() => setTyping(true)} style={{ paddingVertical: 10, alignItems: 'center' }}
              accessibilityRole="button" accessibilityLabel="Type the barcode number instead">
              <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2 }}>Type it instead</Text>
            </Pressable>
          </>) : (<>
            {/* Offered rather than assumed. `permission` is null until
                useCameraPermissions has answered, and that tick is not a
                refusal — asking during it would fire the system prompt at
                somebody who has already granted it. */}
            {!typing && permission != null && permission.canAskAgain ? (
              <Pressable onPress={requestPermission} accessibilityRole="button" accessibilityLabel="Use the camera to scan"
                style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center', marginBottom: sp.md }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: t.ink }}>Use the Camera</Text>
              </Pressable>
            ) : null}
            <TextInput
              value={code} onChangeText={setCode}
              placeholder="e.g. 0049000042566" placeholderTextColor={t.ink3}
              keyboardType="number-pad" returnKeyType="done" onSubmitEditing={() => void run(code, 'keyboard')} autoFocus={typing}
              accessibilityLabel="Barcode number"
              style={{ ...ty.head, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: 13, letterSpacing: 1, marginBottom: sp.md }} />
            <Pressable onPress={() => void run(code, 'keyboard')} disabled={busy} accessibilityState={{ disabled: busy }} accessibilityRole="button" accessibilityLabel="Look up and log"
              style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center', marginBottom: sp.sm }}>
              {busy ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>Look up &amp; log</Text>}
            </Pressable>
          </>)}

          <Pressable onPress={close} style={{ paddingVertical: 10, alignItems: 'center' }} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
