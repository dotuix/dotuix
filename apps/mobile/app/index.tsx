/**
 * app/index.tsx — Home / welcome screen
 */
import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

export const PENDING_UIX_PATH = `${FileSystem.cacheDirectory}pending.uix`;

export default function HomeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function openFile() {
    setErr(null);
    setLoading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: Platform.OS === 'ios' ? ['public.data'] : ['*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) { setLoading(false); return; }
      const asset = result.assets[0];
      await FileSystem.copyAsync({ from: asset.uri, to: PENDING_UIX_PATH });
      router.push({ pathname: '/viewer', params: { name: asset.name } });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  return (
    <View style={s.container}>
      <View style={s.hero}>
        <Text style={s.logo}>dotuix</Text>
        <Text style={s.tagline}>viewer</Text>
      </View>
      <ScrollView style={s.info} contentContainerStyle={s.infoContent}>
        <Text style={s.infoText}>
          Open any{' '}
          <Text style={s.mono}>.uix</Text>
          {' '}file from Files, AirDrop, or email — and run it right here.
        </Text>
        <Text style={s.infoText}>
          State is saved back into the file when you tap Done, so you can share it forward.
        </Text>
      </ScrollView>
      {err ? <Text style={s.error}>{err}</Text> : null}
      <TouchableOpacity
        style={[s.btn, loading && s.btnDisabled]}
        onPress={openFile}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.btnText}>Open .uix File</Text>}
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#0f172a', alignItems: 'center',
    justifyContent: 'center', padding: 32,
  },
  hero: { alignItems: 'center', marginBottom: 24 },
  logo: { fontSize: 48, fontWeight: '800', color: '#60a5fa', letterSpacing: -1 },
  tagline: {
    fontSize: 18, color: '#94a3b8', marginTop: 4,
    letterSpacing: 4, textTransform: 'uppercase',
  },
  info: { maxHeight: 140, marginBottom: 32 },
  infoContent: { gap: 12 },
  infoText: { color: '#cbd5e1', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: '#93c5fd' },
  error: { color: '#f87171', fontSize: 13, textAlign: 'center', marginBottom: 12 },
  btn: {
    backgroundColor: '#3b82f6', paddingVertical: 16, paddingHorizontal: 48,
    borderRadius: 14, alignItems: 'center', minWidth: 200,
    shadowColor: '#3b82f6', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
