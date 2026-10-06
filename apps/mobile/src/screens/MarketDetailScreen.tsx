import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Market, Position, useMarketsApi } from '../hooks/useMarketsApi';
import { RootStackParamList } from '../navigation/RootNavigator';

const PRESETS = [1, 5, 10, 25];
const fmt = (base: string) => (Number(base) / 1_000_000).toFixed(2);

/**
 * The quote and the bet both come from the server, which runs the same
 * integer maths as the program. The app shows the server's quote and signs
 * what the server built. It does no arithmetic of its own.
 */
export function MarketDetailScreen({ route }: NativeStackScreenProps<RootStackParamList, 'Market'>) {
  const api = useMarketsApi();
  const [market, setMarket] = useState<Market | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [option, setOption] = useState(0);
  const [amount, setAmount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.getMarket(route.params.id);
    setMarket(r.market);
    setPosition(r.position);
    if (r.position && !r.position.claimed) setOption(r.position.option);
  }, [route.params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load().catch((e) => setNote(e.message));
  }, [load]);

  async function bet() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.placeBet(route.params.id, option, amount);
      setNote(`Bet landed. If it wins it pays ${fmt(r.quote.payout)} USDC.`);
      await load();
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.claim(route.params.id);
      setNote(`Claimed ${fmt(r.amount)} USDC.`);
      await load();
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!market) return <Text style={[styles.muted, { padding: 16 }]}>{note ?? 'Loading…'}</Text>;
  const total = Number(market.totalPool);
  const open = market.status === 'OPEN';
  const canClaim =
    position && !position.claimed && (market.status === 'CANCELLED' || (market.status === 'RESOLVED' && market.winningOption === position.option));

  return (
    <ScrollView contentContainerStyle={styles.root}>
      {market.description ? <Text style={styles.muted}>{market.description}</Text> : null}
      <Text style={styles.muted}>Closes {new Date(market.resolveAt * 1000).toLocaleString()}</Text>
      <View style={styles.card}>
        {market.outcomes.map((o) => {
          const share = total > 0 ? Math.round((Number(o.pool) / total) * 100) : 0;
          const won = market.status === 'RESOLVED' && market.winningOption === o.index;
          return (
            <Pressable
              key={o.index}
              disabled={!open || (position && !position.claimed && position.option !== o.index) || false}
              onPress={() => setOption(o.index)}
              style={[styles.option, option === o.index && open && styles.optionSelected, won && styles.optionWon]}
            >
              <Text style={[styles.optionText, option === o.index && open && { color: '#fff' }]}>
                {o.label} · {fmt(o.pool)} USDC · {share}%
              </Text>
            </Pressable>
          );
        })}
      </View>

      {position && (
        <View style={styles.card}>
          <Text style={styles.muted}>Your position</Text>
          <Text style={styles.strong}>
            {fmt(position.stake)} USDC on {market.outcomes[position.option].label}
            {position.claimed ? ' · claimed' : ''}
          </Text>
          {canClaim && (
            <Pressable style={styles.button} disabled={busy} onPress={claim}>
              <Text style={styles.buttonText}>{busy ? 'Signing…' : 'Claim'}</Text>
            </Pressable>
          )}
        </View>
      )}

      {open && (
        <View style={styles.card}>
          <View style={styles.row}>
            {PRESETS.map((p) => (
              <Pressable key={p} style={[styles.pill, amount === p && styles.pillSelected]} onPress={() => setAmount(p)}>
                <Text style={amount === p ? { color: '#fff' } : undefined}>${p}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.button} disabled={busy || !api.walletAddress} onPress={bet}>
            <Text style={styles.buttonText}>{busy ? 'Signing…' : `Bet $${amount} on ${market.outcomes[option].label}`}</Text>
          </Pressable>
          <Text style={styles.muted}>Early bets get up to 1.00x shares per dollar, late bets as little as 0.60x. A {market.feeBps / 100}% fee comes off the pot.</Text>
        </View>
      )}
      {note && <Text style={styles.note}>{note}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#e5e5e5', gap: 10 },
  option: { borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#ddd' },
  optionSelected: { backgroundColor: '#17181a', borderColor: '#17181a' },
  optionWon: { backgroundColor: '#cef17b', borderColor: '#cef17b' },
  optionText: { fontWeight: '500' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#ddd' },
  pillSelected: { backgroundColor: '#17181a', borderColor: '#17181a' },
  button: { backgroundColor: '#cef17b', borderRadius: 999, padding: 14, alignItems: 'center' },
  buttonText: { fontWeight: '700' },
  strong: { fontWeight: '600' },
  muted: { color: '#666', fontSize: 13 },
  note: { color: '#17181a', fontSize: 13 },
});
