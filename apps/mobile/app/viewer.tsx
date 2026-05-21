/**
 * app/viewer.tsx — UIX Viewer screen
 *
 * Flow:
 *   1. Read bytes from cache (pending.uix written by home screen)
 *   2. Unpack ZIP → extract web assets → inject bridge script into index.html
 *   3. Open state.db / data.db via useUixBridge
 *   4. Load index.html in WebView
 *   5. Relay bridge messages between WebView and SQLite
 *   6. Done → serializeStateDb → repackUix → share
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  SafeAreaView, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { unpackUix, extractSession, repackUix, makeMobileBridgeScript, bytesToBase64 } from '@/utils/uixPacker';
import { useUixBridge } from '@/hooks/useUixBridge';

const SESSION_DIR = `${FileSystem.cacheDirectory}uix-session/`;
const PENDING_UIX = `${FileSystem.cacheDirectory}pending.uix`;

export default function ViewerScreen() {
  const router = useRouter();
  const { name: fileName } = useLocalSearchParams<{ name: string }>();

  const [phase, setPhase] = useState<'unpack' | 'loading' | 'ready' | 'error'>('unpack');
  const [phaseMsg, setPhaseMsg] = useState('Opening file…');
  const [errMsg, setErrMsg] = useState('');
  const [appTitle, setAppTitle] = useState(fileName ?? 'Loading…');
  const [sharing, setSharing] = useState(false);

  // DB bytes and manifest set after unpack
  const [dataDbBytes, setDataDbBytes] = useState<Uint8Array | null>(null);
  const [stateDbBytes, setStateDbBytes] = useState<Uint8Array | null>(null);
  const [manifest, setManifest] = useState<Record<string, unknown>>({});
  const [bridgeEnabled, setBridgeEnabled] = useState(false);

  const uixFiles = useRef<Record<string, Uint8Array>>({});
  const webViewRef = useRef<WebView>(null);

  const bridge = useUixBridge(
    dataDbBytes, stateDbBytes, manifest,
    (title) => setAppTitle(title),
    bridgeEnabled,
  );

  // Step 1: unpack
  useEffect(() => {
    let cancelled = false;
    async function unpack() {
      try {
        setPhaseMsg('Reading file…');
        const b64 = await FileSystem.readAsStringAsync(PENDING_UIX, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

        setPhaseMsg('Unpacking…');
        const contents = unpackUix(bytes);
        uixFiles.current = contents.files;

        const title = (contents.manifest.name as string) || fileName || 'UIX App';
        if (!cancelled) {
          setAppTitle(title);
          setManifest(contents.manifest);
          setDataDbBytes(contents.dataDb);
          setStateDbBytes(contents.stateDb);
        }

        setPhaseMsg('Extracting assets…');
        const bridgeScript = makeMobileBridgeScript(contents.manifest);
        // Remove old session dir if present
        await FileSystem.deleteAsync(SESSION_DIR, { idempotent: true });
        await extractSession(contents.files, SESSION_DIR, bridgeScript);

        if (!cancelled) {
          setPhase('loading');
          setBridgeEnabled(true);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setErrMsg(e instanceof Error ? e.message : String(e));
          setPhase('error');
        }
      }
    }
    unpack();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 2: bridge ready → show viewer
  useEffect(() => {
    if (phase === 'loading' && bridge.ready) setPhase('ready');
    if (bridge.error) { setErrMsg(bridge.error); setPhase('error'); }
  }, [phase, bridge.ready, bridge.error]);

  // WebView message relay
  const handleWebViewMessage = useCallback(async (event: WebViewMessageEvent) => {
    const js = await bridge.handleMessage(event.nativeEvent.data);
    if (js && webViewRef.current) webViewRef.current.injectJavaScript(js);
  }, [bridge]);

  // Done → repack → share
  const handleDone = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const stateBytes = await bridge.serializeStateDb();
      await bridge.cleanup();
      if (!stateBytes) throw new Error('Could not read state database.');
      const repacked = repackUix(uixFiles.current, stateBytes);
      const outName = (fileName ?? 'output.uix').replace(/[^a-zA-Z0-9._-]/g, '_');
      const outPath = `${FileSystem.cacheDirectory}${outName}`;
      await FileSystem.writeAsStringAsync(outPath, bytesToBase64(repacked), {
        encoding: FileSystem.EncodingType.Base64,
      });
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(outPath, { mimeType: 'application/octet-stream', dialogTitle: `Share ${outName}` });
      } else {
        Alert.alert('Saved', 'File saved. Sharing is not available on this device.');
      }
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  }, [sharing, bridge, fileName]);

  const handleBack = useCallback(async () => {
    await bridge.cleanup();
    router.back();
  }, [bridge, router]);

  if (phase === 'error') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.navBtn}>
            <Text style={s.navBtnText}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle} numberOfLines={1}>Error</Text>
          <View style={s.navBtn} />
        </View>
        <View style={s.centered}>
          <Text style={s.errorTitle}>Failed to open file</Text>
          <Text style={s.errorMsg}>{errMsg}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => router.back()}>
            <Text style={s.navBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isLoading = phase === 'unpack' || phase === 'loading';

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={handleBack} style={s.navBtn}>
          <Text style={s.navBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{appTitle}</Text>
        <TouchableOpacity
          onPress={handleDone}
          style={[s.navBtn, s.navBtnRight, (sharing || isLoading) && s.navBtnDisabled]}
          disabled={sharing || isLoading}
        >
          {sharing
            ? <ActivityIndicator size="small" color="#60a5fa" />
            : <Text style={[s.navBtnText, s.navBtnBold]}>Done</Text>}
        </TouchableOpacity>
      </View>

      {isLoading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color="#60a5fa" />
          <Text style={s.loadingMsg}>{phaseMsg}</Text>
        </View>
      )}

      {phase === 'ready' && (
        <WebView
          ref={webViewRef}
          source={{ uri: `${SESSION_DIR}index.html` }}
          style={s.webview}
          originWhitelist={['*']}
          allowFileAccess
          allowUniversalAccessFromFileURLs
          allowFileAccessFromFileURLs
          allowingReadAccessToURL={FileSystem.cacheDirectory!}
          javaScriptEnabled
          domStorageEnabled
          onMessage={handleWebViewMessage}
          onError={(e) => {
            setErrMsg(`WebView error: ${e.nativeEvent.description}`);
            setPhase('error');
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1e293b', paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#334155',
  },
  navBtn: { minWidth: 60 },
  navBtnRight: { alignItems: 'flex-end' },
  navBtnDisabled: { opacity: 0.5 },
  navBtnText: { color: '#60a5fa', fontSize: 15 },
  navBtnBold: { fontWeight: '600' },
  headerTitle: {
    flex: 1, color: '#f1f5f9', fontSize: 15, fontWeight: '600',
    textAlign: 'center', marginHorizontal: 8,
  },
  webview: { flex: 1, backgroundColor: '#ffffff' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  loadingMsg: { color: '#94a3b8', marginTop: 16, fontSize: 14 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { color: '#f87171', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  errorMsg: { color: '#94a3b8', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  retryBtn: { backgroundColor: '#1e293b', paddingVertical: 12, paddingHorizontal: 32, borderRadius: 10 },
});
