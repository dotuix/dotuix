/**
 * components/PinModal.tsx
 *
 * PIN entry modal shown when manifest.security.auth === "pin".
 * Parent calls onSubmit(pin) which returns false if the PIN is wrong.
 */
import { useState, useRef } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

interface Props {
  visible: boolean;
  appName: string;
  onSubmit: (pin: string) => Promise<boolean>;
  onCancel: () => void;
}

export default function PinModal({
  visible,
  appName,
  onSubmit,
  onCancel,
}: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<TextInput>(null);

  async function handleSubmit() {
    if (!pin || checking) return;
    setChecking(true);
    setError("");
    const ok = await onSubmit(pin);
    setChecking(false);
    if (!ok) {
      setError("Incorrect PIN. Try again.");
      setPin("");
      inputRef.current?.focus();
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={s.card}>
          <Text style={s.title}>PIN Required</Text>
          <Text style={s.subtitle} numberOfLines={1}>
            {appName}
          </Text>
          <TextInput
            ref={inputRef}
            style={s.input}
            value={pin}
            onChangeText={setPin}
            placeholder="Enter PIN"
            placeholderTextColor="#64748b"
            secureTextEntry
            keyboardType="number-pad"
            autoFocus
            onSubmitEditing={handleSubmit}
            returnKeyType="done"
            editable={!checking}
          />
          {error ? <Text style={s.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[s.btn, (!pin || checking) && s.btnDisabled]}
            onPress={handleSubmit}
            disabled={!pin || checking}
          >
            {checking ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.btnText}>Unlock</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 28,
    width: 300,
    alignItems: "center",
  },
  title: { color: "#f1f5f9", fontSize: 20, fontWeight: "700", marginBottom: 4 },
  subtitle: {
    color: "#94a3b8",
    fontSize: 13,
    marginBottom: 24,
    maxWidth: "100%",
  },
  input: {
    width: "100%",
    backgroundColor: "#0f172a",
    borderRadius: 10,
    padding: 14,
    color: "#f1f5f9",
    fontSize: 18,
    textAlign: "center",
    letterSpacing: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  error: { color: "#f87171", fontSize: 13, marginBottom: 12 },
  btn: {
    backgroundColor: "#3b82f6",
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 40,
    marginTop: 8,
    width: "100%",
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  cancelBtn: { marginTop: 14 },
  cancelText: { color: "#64748b", fontSize: 14 },
});
