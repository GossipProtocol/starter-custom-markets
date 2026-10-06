import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLoginWithEmail } from '@privy-io/expo';

/** Email code login. Privy creates the embedded Solana wallet on first login
 *  because App.tsx asks for it under `embedded.solana`. */
export function AuthScreen() {
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setError(null);
    try {
      if (!sent) {
        await sendCode({ email: email.trim() });
        setSent(true);
      } else {
        await loginWithCode({ code: code.trim(), email: email.trim() });
      }
    } catch (e: any) {
      setError(e.message || 'Login failed');
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
      <Text style={styles.title}>Custom Markets</Text>
      <Text style={styles.sub}>Parimutuel markets with a time multiplier. Early bets own more of the pot.</Text>
      <TextInput style={styles.input} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} editable={!sent} />
      {sent && <TextInput style={styles.input} placeholder="6-digit code" keyboardType="number-pad" value={code} onChangeText={setCode} />}
      <Pressable style={styles.button} onPress={go}>
        <Text style={styles.buttonText}>{sent ? 'Sign in' : 'Send code'}</Text>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f6f5f0', gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  sub: { color: '#555', marginBottom: 8 },
  input: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#ddd' },
  button: { backgroundColor: '#17181a', borderRadius: 999, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#d9532b' },
});
