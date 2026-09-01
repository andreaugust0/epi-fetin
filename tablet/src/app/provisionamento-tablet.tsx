import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Screen, ScreenHeader } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { deviceTokenStore } from '@/features/face-recognition/services/deviceTokenStore';
import {
  isValidBaseUrl,
  resolveFaceApiConfig,
  type FaceApiConfigStatus,
} from '@/features/face-recognition/services/faceApiConfig';
import { faceApiOverrideStore } from '@/features/face-recognition/services/faceApiOverrideStore';
import { colors, radii, spacing } from '@/theme';

type TokenStatus = 'verificando' | 'provisionado' | 'nao_provisionado';

interface Feedback {
  tone: 'success' | 'error';
  message: string;
}

const EMPTY_CONFIG_STATUS: FaceApiConfigStatus = {
  baseUrl: null,
  baseUrlSource: null,
  pointId: null,
  pointIdSource: null,
};

/**
 * Validação estrutural mínima: três segmentos não vazios separados por ".".
 *
 * Não decodifica nem confia em nenhum claim — isso é responsabilidade do
 * backend. Serve só para recusar colagens claramente erradas antes de gastar
 * uma escrita no SecureStore.
 */
const isStructurallyValidJwt = (value: string): boolean => {
  const partes = value.split('.');
  return partes.length === 3 && partes.every((parte) => parte.length > 0);
};

const parsePositiveInt = (value: string): number | null => {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const sourceLabel = (source: 'override' | 'env' | null): string => {
  if (source === 'override') return 'definida neste tablet';
  if (source === 'env') return 'padrão da build';
  return 'nenhuma';
};

/**
 * Provisionamento do tablet — tela administrativa, fora do fluxo do
 * funcionário. Acessada diretamente pela rota durante a configuração do
 * totem, não por um botão na home.
 *
 * Duas responsabilidades bem separadas:
 * - URL/ponto do backend: não são segredo, ficam em AsyncStorage
 *   (`faceApiOverrideStore`) e têm prioridade sobre `EXPO_PUBLIC_*` — assim
 *   o IP do backend de desenvolvimento pode mudar sem exigir nova build.
 * - JWT do dispositivo: é credencial, fica só em SecureStore
 *   (`deviceTokenStore`) e nunca é lido de volta para a tela.
 */
export default function ProvisionamentoTabletScreen() {
  const router = useRouter();

  const [tokenStatus, setTokenStatus] = useState<TokenStatus>('verificando');
  const [tokenInput, setTokenInput] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenFeedback, setTokenFeedback] = useState<Feedback | null>(null);

  const [configStatus, setConfigStatus] = useState<FaceApiConfigStatus>(EMPTY_CONFIG_STATUS);
  const [urlInput, setUrlInput] = useState('');
  const [pointIdInput, setPointIdInput] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [configFeedback, setConfigFeedback] = useState<Feedback | null>(null);

  const refreshTokenStatus = useCallback(async () => {
    const stored = await deviceTokenStore.get();
    setTokenStatus(stored ? 'provisionado' : 'nao_provisionado');
  }, []);

  const refreshConfigStatus = useCallback(async () => {
    const status = await resolveFaceApiConfig();
    setConfigStatus(status);
    setUrlInput(status.baseUrl ?? '');
    setPointIdInput(status.pointId !== null ? String(status.pointId) : '');
  }, []);

  useEffect(() => {
    void refreshTokenStatus();
    void refreshConfigStatus();
  }, [refreshTokenStatus, refreshConfigStatus]);

  const handleSaveToken = useCallback(async () => {
    const trimmed = tokenInput.trim();

    if (!isStructurallyValidJwt(trimmed)) {
      setTokenFeedback({
        tone: 'error',
        message: 'Token inválido: precisa ter três partes separadas por ".".',
      });
      return;
    }

    setSavingToken(true);
    setTokenFeedback(null);
    try {
      await deviceTokenStore.set(trimmed);
      setTokenInput('');
      setTokenFeedback({ tone: 'success', message: 'Token salvo com sucesso.' });
      await refreshTokenStatus();
    } catch (error) {
      // Mensagem do AppError já vem sanitizada (nunca inclui o token) — ver
      // deviceTokenStore.ts. Exibir aqui é diagnóstico temporário para esta
      // tela administrativa, não vaza para o fluxo do funcionário.
      setTokenFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível salvar o token.',
      });
    } finally {
      setSavingToken(false);
    }
  }, [tokenInput, refreshTokenStatus]);

  const handleRemoveToken = useCallback(async () => {
    setSavingToken(true);
    setTokenFeedback(null);
    try {
      await deviceTokenStore.remove();
      setTokenFeedback({ tone: 'success', message: 'Token removido.' });
      await refreshTokenStatus();
    } catch (error) {
      setTokenFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível remover o token.',
      });
    } finally {
      setSavingToken(false);
    }
  }, [refreshTokenStatus]);

  const handleSaveConfig = useCallback(async () => {
    const trimmedUrl = urlInput.trim();
    const pointId = parsePositiveInt(pointIdInput);

    if (!isValidBaseUrl(trimmedUrl)) {
      setConfigFeedback({
        tone: 'error',
        message: 'URL inválida: use http:// ou https:// seguido do host (porta é opcional).',
      });
      return;
    }
    if (pointId === null) {
      setConfigFeedback({
        tone: 'error',
        message: 'Ponto de acesso inválido: informe um número inteiro positivo.',
      });
      return;
    }

    setSavingConfig(true);
    setConfigFeedback(null);
    try {
      await faceApiOverrideStore.set({ baseUrl: trimmedUrl, pointId });
      setConfigFeedback({ tone: 'success', message: 'Configuração salva neste tablet.' });
      await refreshConfigStatus();
    } catch {
      setConfigFeedback({ tone: 'error', message: 'Não foi possível salvar a configuração.' });
    } finally {
      setSavingConfig(false);
    }
  }, [urlInput, pointIdInput, refreshConfigStatus]);

  const handleResetConfig = useCallback(async () => {
    setSavingConfig(true);
    setConfigFeedback(null);
    try {
      await faceApiOverrideStore.remove();
      setConfigFeedback({ tone: 'success', message: 'Override removido — voltou ao padrão da build.' });
      await refreshConfigStatus();
    } catch {
      setConfigFeedback({ tone: 'error', message: 'Não foi possível restaurar o padrão.' });
    } finally {
      setSavingConfig(false);
    }
  }, [refreshConfigStatus]);

  return (
    <Screen>
      <ScreenHeader
        title="Provisionamento do tablet"
        subtitle="Configuração administrativa"
        onBack={() => router.back()}
      />

      <View style={styles.body}>
        <View style={styles.card}>
          <Text variant="captionStrong" color={colors.slate[500]}>
            SERVIDOR
          </Text>

          <StatusRow label="API" configured={configStatus.baseUrl !== null} />
          <Text variant="caption" color={colors.slate[500]}>
            {configStatus.baseUrl ?? '—'} ({sourceLabel(configStatus.baseUrlSource)})
          </Text>

          <StatusRow label="Ponto de acesso" configured={configStatus.pointId !== null} />
          <Text variant="caption" color={colors.slate[500]}>
            {configStatus.pointId ?? '—'} ({sourceLabel(configStatus.pointIdSource)})
          </Text>

          <TextInput
            value={urlInput}
            onChangeText={setUrlInput}
            placeholder="http://192.168.0.10:8000"
            placeholderTextColor={colors.slate[400]}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.inputSingleLine}
          />
          <TextInput
            value={pointIdInput}
            onChangeText={setPointIdInput}
            placeholder="ponto_id (ex.: 1)"
            placeholderTextColor={colors.slate[400]}
            keyboardType="number-pad"
            style={styles.inputSingleLine}
          />

          <Button
            label={savingConfig ? 'Salvando...' : 'Salvar configuração'}
            onPress={() => void handleSaveConfig()}
            disabled={savingConfig}
            loading={savingConfig}
          />
          <Button
            label="Restaurar padrão"
            variant="outline"
            onPress={() => void handleResetConfig()}
            disabled={savingConfig || configStatus.baseUrlSource !== 'override'}
          />

          {configFeedback ? (
            <Text
              variant="caption"
              color={
                configFeedback.tone === 'success' ? colors.status.approvedText : colors.status.rejectedText
              }
            >
              {configFeedback.message}
            </Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text variant="captionStrong" color={colors.slate[500]}>
            TOKEN DO DISPOSITIVO
          </Text>
          <View style={styles.row}>
            <Text variant="caption" color={colors.slate[500]}>
              Status
            </Text>
            <Text
              variant="bodyStrong"
              color={
                tokenStatus === 'provisionado' ? colors.status.approvedText : colors.slate[500]
              }
            >
              {tokenStatus === 'verificando'
                ? 'Verificando...'
                : tokenStatus === 'provisionado'
                  ? 'Provisionado'
                  : 'Não provisionado'}
            </Text>
          </View>

          <TextInput
            value={tokenInput}
            onChangeText={setTokenInput}
            placeholder="Cole o JWT do dispositivo aqui"
            placeholderTextColor={colors.slate[400]}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={styles.input}
          />

          <Button
            label={savingToken ? 'Salvando...' : 'Salvar token'}
            onPress={() => void handleSaveToken()}
            disabled={savingToken}
            loading={savingToken}
          />

          <Button
            label="Remover token"
            variant="danger"
            onPress={() => void handleRemoveToken()}
            disabled={savingToken || tokenStatus !== 'provisionado'}
          />

          {tokenFeedback ? (
            <Text
              variant="caption"
              color={
                tokenFeedback.tone === 'success' ? colors.status.approvedText : colors.status.rejectedText
              }
            >
              {tokenFeedback.message}
            </Text>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

const StatusRow = ({ label, configured }: { label: string; configured: boolean }) => (
  <View style={styles.row}>
    <Text variant="caption" color={colors.slate[500]}>
      {label}
    </Text>
    <Text
      variant="bodyStrong"
      color={configured ? colors.status.approvedText : colors.status.rejectedText}
    >
      {configured ? 'Configurada' : 'Não configurada'}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.slate[200],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.slate[200],
    borderRadius: radii.lg,
    padding: spacing.sm,
    color: colors.slate[900],
    textAlignVertical: 'top',
  },
  inputSingleLine: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.slate[200],
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm,
    color: colors.slate[900],
  },
});
