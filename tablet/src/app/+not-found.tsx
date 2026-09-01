import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { StateView } from '@/components/feedback';
import { Screen } from '@/components/layout';
import { APP_MESSAGES } from '@/constants/messages';

/** Qualquer rota desconhecida devolve o terminal à tela inicial. */
export default function NotFoundScreen() {
  const router = useRouter();
  const goHome = useCallback(() => router.replace('/'), [router]);

  return (
    <Screen>
      <View style={styles.centered}>
        <StateView
          icon="compass-off-outline"
          title={APP_MESSAGES.notFound.title}
          description={APP_MESSAGES.notFound.description}
          tone="warning"
          actions={[{ label: APP_MESSAGES.result.backHomeButton, onPress: goHome, icon: 'home' }]}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
});
