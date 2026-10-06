import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PositionWithMarket, useMarketsApi } from '../hooks/useMarketsApi';
import { RootStackParamList } from '../navigation/RootNavigator';

const fmt = (base: string) => (Number(base) / 1_000_000).toFixed(2);

export function PositionsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Positions'>) {
  const api = useMarketsApi();
  const [positions, setPositions] = useState<PositionWithMarket[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setPositions(await api.myPositions());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={positions}
      keyExtractor={(p) => p.marketId}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
      ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
      ListEmptyComponent={!refreshing ? <Text style={styles.muted}>No positions yet.</Text> : null}
      renderItem={({ item }) => (
        <Pressable style={styles.card} onPress={() => navigation.navigate('Market', { id: item.marketId, title: item.market.title })}>
          <Text style={styles.title}>{item.market.title}</Text>
          <Text style={styles.muted}>
            {fmt(item.stake)} USDC on {item.market.outcomes[item.option].label} · {item.market.status.toLowerCase()}
            {item.claimed ? ' · claimed' : item.claimable ? ` · claim ${fmt(item.payout)} USDC` : ''}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#e5e5e5' },
  title: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  muted: { color: '#666', fontSize: 13 },
  error: { color: '#d9532b' },
});
