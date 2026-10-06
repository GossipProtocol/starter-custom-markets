import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { usePrivy } from '@privy-io/expo';
import { ActivityIndicator, View } from 'react-native';
import { AuthScreen } from '../screens/AuthScreen';
import { MarketsScreen } from '../screens/MarketsScreen';
import { MarketDetailScreen } from '../screens/MarketDetailScreen';
import { PositionsScreen } from '../screens/PositionsScreen';

export type RootStackParamList = {
  Markets: undefined;
  Market: { id: string; title: string };
  Positions: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { isReady, user } = usePrivy();
  if (!isReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return (
    <NavigationContainer>
      {user ? (
        <Stack.Navigator>
          <Stack.Screen name="Markets" component={MarketsScreen} />
          <Stack.Screen name="Market" component={MarketDetailScreen} options={({ route }) => ({ title: route.params.title })} />
          <Stack.Screen name="Positions" component={PositionsScreen} options={{ title: 'My positions' }} />
        </Stack.Navigator>
      ) : (
        <AuthScreen />
      )}
    </NavigationContainer>
  );
}
