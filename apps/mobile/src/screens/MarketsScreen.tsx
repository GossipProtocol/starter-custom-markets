import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { usePrivy } from '@privy-io/expo';
import { Market, useMarketsApi } from '../hooks/useMarketsApi';
import { RootStackParamList } from '../navigation/RootNavigator';

const fmt = (base: string) => (Number(base) / 1_000_000).toFixed(2);

export function MarketsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Markets'>) {
  const api = useMarketsApi();
  const { logout } = usePrivy();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setMarkets(await api.listMarkets());
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

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <Pressable onPress={() => navigation.navigate('Positions')}>
            <Text style={styles.link}>Positions</Text>
          </Pressable>
          <Pressable onPress={() => logout()}>
            <Text style={styles.link}>Sign out</Text>
          </Pressable>
        </View>
      ),
    });
  }, [navigation, logout]);

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={markets}
      keyExtractor={(m) => m.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
      ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
      ListEmptyComponent={!refreshing ? <Text style={styles.muted}>No markets yet.</Text> : null}
      renderItem={({ item }) => (
        <Pressable style={styles.card} onPress={() => navigation.navigate('Market', { id: item.id, title: item.title })}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.muted}>
            {fmt(item.totalPool)} USDC · {item.status.toLowerCase()} · {item.outcomes.map((o) => o.label).join(' / ')}
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
  link: { fontWeight: '600' },
  error: { color: '#d9532b' },
});
