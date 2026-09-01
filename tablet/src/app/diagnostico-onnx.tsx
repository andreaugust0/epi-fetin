import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Screen, ScreenHeader } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import {
  runMlkitProbe,
  type MlkitProbeResult,
} from '@/features/face-recognition/detection/mlkitProbe';
import {
  runFaceNetOnnxProbe,
  type FaceNetProbeResult,
} from '@/features/face-recognition/onnx/facenetOnnxProbe';
import { colors, radii, spacing } from '@/theme';

/**
 * Ferramenta de desenvolvimento, fora do fluxo do terminal.
 *
 * Só prova que o FaceNet ONNX carrega e executa no dispositivo. Não faz
 * reconhecimento facial, não usa a câmera e não toca na sessão de
 * verificação.
 */
export default function OnnxDiagnosticScreen() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FaceNetProbeResult | null>(null);

  const [mlkitRunning, setMlkitRunning] = useState(false);
  const [mlkit, setMlkit] = useState<MlkitProbeResult | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      setResult(await runFaceNetOnnxProbe());
    } finally {
      setRunning(false);
    }
  }, []);

  const runMlkit = useCallback(async () => {
    setMlkitRunning(true);
    setMlkit(null);
    try {
      setMlkit(await runMlkitProbe());
    } finally {
      setMlkitRunning(false);
    }
  }, []);

  const status = result ? (result.success ? 'SUCESSO' : 'FALHA') : '—';
  const statusColor = result
    ? result.success
      ? colors.status.approvedText
      : colors.status.rejectedText
    : colors.slate[500];

  return (
    <Screen>
      <ScreenHeader title="FaceNet ONNX" subtitle="Diagnóstico" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.body}>
        <Button
          label={running ? 'Executando...' : 'Executar prova'}
          icon="play"
          size="large"
          loading={running}
          onPress={() => void run()}
        />

        {result ? (
          <View style={styles.card}>
            <Row label="Modelo" value={result.modelLoaded ? 'carregado' : 'não carregado'} />
            <Row label="Input" value={result.inputName ?? '—'} />
            <Row label="Output" value={result.outputName ?? '—'} />
            <Row label="Input dims" value={result.inputDims} />
            <Row label="Output dims" value={result.outputDims} />
            <Row label="Valores" value={result.outputLength?.toString() ?? '—'} />
            <Row
              label="Carregamento"
              value={result.loadMs === null ? '—' : `${result.loadMs} ms`}
            />
            <Row
              label="Inferência"
              value={result.inferenceMs === null ? '—' : `${result.inferenceMs} ms`}
            />
            <Row label="Status" value={status} valueColor={statusColor} />

            {result.error ? (
              <View style={styles.errorBox}>
                <Text variant="captionStrong" color={colors.status.rejectedText}>
                  Erro
                </Text>
                {/* Selecionável para poder copiar a mensagem do tablet. */}
                <Text variant="caption" color={colors.slate[700]} selectable>
                  {result.error}
                </Text>
              </View>
            ) : null}

            {result.modelUri ? (
              <View style={styles.uriBox}>
                <Text variant="micro" color={colors.slate[400]} selectable>
                  {result.modelUri}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/*
          Prova do ML Kit: só resolve o módulo nativo e chama `initialize`.
          Nenhuma imagem é fornecida e nenhum rosto é detectado nesta etapa.
        */}
        <View style={styles.divider} />

        <Text variant="heading">ML Kit Face Detection</Text>

        <Button
          label={mlkitRunning ? 'Verificando...' : 'Verificar módulo'}
          icon="face-recognition"
          size="large"
          variant="secondary"
          loading={mlkitRunning}
          onPress={() => void runMlkit()}
        />

        <Button
          label="Teste facial real"
          icon="account-search"
          size="large"
          onPress={() => router.push('/diagnostico-face')}
        />

        {mlkit ? (
          <View style={styles.card}>
            <Row label="Módulo nativo" value={mlkit.moduleAvailable ? 'disponível' : 'ausente'} />
            <Row label="Estado" value={mlkit.status ?? '—'} />
            <Row label="Inicialização" value={mlkit.initMs === null ? '—' : `${mlkit.initMs} ms`} />
            <Row
              label="Status"
              value={mlkit.success ? 'SUCESSO' : 'FALHA'}
              valueColor={mlkit.success ? colors.status.approvedText : colors.status.rejectedText}
            />

            {mlkit.error ? (
              <View style={styles.errorBox}>
                <Text variant="captionStrong" color={colors.status.rejectedText}>
                  Erro
                </Text>
                <Text variant="caption" color={colors.slate[700]} selectable>
                  {mlkit.error}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const Row = ({
  label,
  value,
  valueColor = colors.slate[900],
}: {
  label: string;
  value: string;
  valueColor?: string;
}) => (
  <View style={styles.row}>
    <Text variant="caption" color={colors.slate[500]}>
      {label}
    </Text>
    <Text variant="bodyStrong" color={valueColor} selectable style={styles.rowValue}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  card: {
    gap: spacing.md,
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
  rowValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  errorBox: {
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.status.rejectedSoft,
  },
  uriBox: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.slate[100],
  },
  divider: {
    height: 1,
    backgroundColor: colors.slate[200],
    marginVertical: spacing.sm,
  },
});
