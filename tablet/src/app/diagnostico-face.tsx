import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';

import { Screen, ScreenHeader } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { FaceDetector } from '@/features/face-recognition/face/faceDetector';
import { formatBox } from '@/features/face-recognition/face/faceGeometry';
import { analyzePhoto, type PipelineResult } from '@/features/face-recognition/face/facePipeline';
import {
  FACE_DISTANCIA_MAX,
  FACE_RAZAO_MIN,
} from '@/features/face-recognition/gallery/matchEmbedding';
import { FaceNetSession } from '@/features/face-recognition/onnx/FaceNetSession';
import { colors, radii, spacing } from '@/theme';

type Stage = 'preparando' | 'pronto' | 'analisando' | 'erro';

/**
 * Diagnóstico de reconhecimento facial real.
 *
 * Fora do fluxo do terminal e sem laço automático: cada análise acontece por
 * toque. O que interessa aqui são os números brutos — distâncias, geometria e
 * tempos —, não um veredito bonito.
 */
export default function FaceDiagnosticScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();

  const cameraRef = useRef<CameraView>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const sessionRef = useRef<FaceNetSession | null>(null);
  /** Impede análises concorrentes: `stage` só muda no render seguinte. */
  const busyRef = useRef(false);

  const [stage, setStage] = useState<Stage>('preparando');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [detectorStatus, setDetectorStatus] = useState('—');
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [captureMs, setCaptureMs] = useState<number | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  /**
   * Detector e modelo são preparados uma única vez ao entrar. Carregar o
   * FaceNet custa quase um segundo; repetir isso a cada foto seria desperdício.
   */
  useEffect(() => {
    let ativo = true;
    const detector = new FaceDetector();
    const session = new FaceNetSession();
    detectorRef.current = detector;
    sessionRef.current = session;

    void (async () => {
      try {
        await detector.initialize();
        if (!ativo) return;
        setDetectorStatus(detector.status);

        await session.load();
        if (!ativo) return;
        setLoadMs(session.loadMs);
        setStage('pronto');
      } catch (caught) {
        if (!ativo) return;
        setSetupError(caught instanceof Error ? caught.message : String(caught));
        setStage('erro');
      }
    })();

    return () => {
      ativo = false;
      void session.release();
    };
  }, []);

  const capture = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    const camera = cameraRef.current;
    const detector = detectorRef.current;
    const session = sessionRef.current;
    if (!camera || !detector || !session) {
      return;
    }

    busyRef.current = true;
    setStage('analisando');
    setResult(null);

    try {
      const t0 = Date.now();
      // `skipProcessing` evita o pós-processamento do aparelho, que poderia
      // alterar pixels entre o que o ML Kit vê e o que o FaceNet recebe.
      const foto = await camera.takePictureAsync({ skipProcessing: true, quality: 1 });
      setCaptureMs(Date.now() - t0);

      if (!foto?.uri) {
        throw new Error('A câmera não devolveu imagem.');
      }

      setResult(
        await analyzePhoto({
          photoUri: foto.uri,
          photoWidth: foto.width,
          photoHeight: foto.height,
          detector,
          session,
        }),
      );
    } catch (caught) {
      setResult({
        ...emptyPipelineResult(),
        error: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      busyRef.current = false;
      setStage('pronto');
    }
  }, []);

  const match = result?.match ?? null;

  return (
    <Screen>
      <ScreenHeader title="Teste facial real" subtitle="Diagnóstico" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.viewport}>
          {permission?.granted ? (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing="front"
              animateShutter={false}
              mute
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <Text variant="caption" color={colors.slate[400]}>
                Câmera indisponível
              </Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Row label="ML Kit" value={detectorStatus} />
          <Row
            label="FaceNet"
            value={loadMs === null ? 'carregando...' : `carregado (${loadMs} ms)`}
          />
          {setupError ? <ErrorBox message={setupError} /> : null}
        </View>

        <Button
          label={stage === 'analisando' ? 'Analisando...' : 'Capturar e analisar'}
          icon="camera"
          size="large"
          loading={stage === 'analisando'}
          disabled={stage !== 'pronto'}
          onPress={() => void capture()}
        />

        {result ? (
          <>
            {/*
              A caixa é conferida sobre o recorte que realmente foi ao modelo,
              não sobre o preview ao vivo: é a única forma de saber se o ML Kit
              enquadrou o rosto certo da imagem analisada.
            */}
            {result.cropPreviewUri ? (
              <View style={styles.cropRow}>
                <Image source={{ uri: result.cropPreviewUri }} style={styles.crop} />
                <Text variant="caption" color={colors.slate[500]} style={styles.cropHint}>
                  Recorte 160×160 enviado ao FaceNet
                </Text>
              </View>
            ) : null}

            <View style={styles.card}>
              <Text variant="captionStrong" color={colors.slate[500]}>
                GEOMETRIA
              </Text>
              <Row label="Rostos detectados" value={String(result.facesDetected)} />
              <Row label="Imagem" value={`${result.imageWidth} × ${result.imageHeight}`} />
              <Row label="ML Kit bbox" value={formatBox(result.rawBox)} />
              {/*
                Os extremos da caixa são o dado que diz em qual espaço de
                coordenadas o ML Kit respondeu: comparar contra a largura e a
                altura da foto revela se ele enxergou a imagem de pé ou
                deitada, sem precisar mexer em nada ainda.
              */}
              <Row label="ML Kit x + w" value={extent(result.rawBox, 'x')} />
              <Row label="ML Kit y + h" value={extent(result.rawBox, 'y')} />
              <Row label="FaceNet crop" value={formatBox(result.cropBox)} />
              <Row
                label="Ângulos X / Y / Z"
                value={
                  result.headEulerAngleX === null && result.headEulerAngleY === null
                    ? '—'
                    : `${fmtAngle(result.headEulerAngleX)} / ${fmtAngle(result.headEulerAngleY)} / ${fmtAngle(result.headEulerAngleZ)}`
                }
              />
              <Row label="trackingId" value={result.trackingId?.toString() ?? '—'} />
            </View>

            <View style={styles.card}>
              <Text variant="captionStrong" color={colors.slate[500]}>
                EMBEDDING
              </Text>
              <Row label="Dimensão" value={result.embeddingDim?.toString() ?? '—'} />
              <Row
                label="Norma L2"
                value={result.embeddingNorm === null ? '—' : result.embeddingNorm.toFixed(6)}
                valueColor={normColor(result.embeddingNorm)}
              />
            </View>

            {match ? (
              <View style={styles.card}>
                <Text variant="captionStrong" color={colors.slate[500]}>
                  DISTÂNCIAS
                </Text>
                {match.candidates.map((c) => (
                  <Row key={c.nome} label={c.nome} value={c.distance.toFixed(4)} />
                ))}

                <View style={styles.separator} />

                <Row label="Melhor" value={match.best?.nome ?? '—'} />
                <Row label="Melhor distância" value={match.best?.distance.toFixed(4) ?? '—'} />
                <Row label="Segunda distância" value={match.second?.distance.toFixed(4) ?? '—'} />
                <Row label="Razão" value={match.ratio === null ? '—' : match.ratio.toFixed(4)} />

                <View style={styles.separator} />

                <Row
                  label={`Distância ≤ ${FACE_DISTANCIA_MAX}`}
                  value={sim(match.passesDistance)}
                />
                <Row label={`Razão ≥ ${FACE_RAZAO_MIN}`} value={sim(match.passesRatio)} />
                <Row
                  label="Passaria pela regra"
                  value={sim(match.passes)}
                  valueColor={
                    match.passes ? colors.status.approvedText : colors.status.rejectedText
                  }
                />
              </View>
            ) : null}

            {result.timings ? (
              <View style={styles.card}>
                <Text variant="captionStrong" color={colors.slate[500]}>
                  TEMPOS
                </Text>
                <Row label="Captura" value={captureMs === null ? '—' : `${captureMs} ms`} />
                <Row label="Detecção" value={`${result.timings.detectMs} ms`} />
                <Row label="Crop + resize" value={`${result.timings.cropMs} ms`} />
                <Row label="Decode PNG" value={`${result.timings.decodeMs} ms`} />
                <Row label="Tensor" value={`${result.timings.tensorMs} ms`} />
                <Row label="Inferência" value={`${result.timings.inferenceMs} ms`} />
                <Row label="Comparação" value={`${result.timings.matchMs} ms`} />
                <Row label="Total pipeline" value={`${result.timings.totalMs} ms`} />
              </View>
            ) : null}

            {result.error ? <ErrorBox message={result.error} /> : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const sim = (valor: boolean): string => (valor ? 'SIM' : 'NÃO');

const fmtAngle = (valor: number | null): string => (valor === null ? '—' : `${valor.toFixed(1)}°`);

/** Borda direita ou inferior da caixa — o limite a comparar com a foto. */
const extent = (box: { x: number; y: number; width: number; height: number } | null, eixo: 'x' | 'y'): string =>
  box === null
    ? '—'
    : String(eixo === 'x' ? box.x + box.width : box.y + box.height);

/** Fora de ~1 a saída do modelo está errada e o diagnóstico precisa gritar. */
const normColor = (norma: number | null): string => {
  if (norma === null) return colors.slate[900];
  return Math.abs(norma - 1) < 0.01 ? colors.status.approvedText : colors.status.rejectedText;
};

const emptyPipelineResult = (): PipelineResult => ({
  facesDetected: 0,
  imageWidth: 0,
  imageHeight: 0,
  rawBox: null,
  cropBox: null,
  headEulerAngleX: null,
  headEulerAngleY: null,
  headEulerAngleZ: null,
  trackingId: null,
  embeddingDim: null,
  embeddingNorm: null,
  match: null,
  timings: null,
  cropPreviewUri: null,
  error: null,
});

const ErrorBox = ({ message }: { message: string }) => (
  <View style={styles.errorBox}>
    <Text variant="captionStrong" color={colors.status.rejectedText}>
      Erro
    </Text>
    <Text variant="caption" color={colors.slate[700]} selectable>
      {message}
    </Text>
  </View>
);

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
    gap: spacing.md,
    padding: spacing.lg,
  },
  viewport: {
    height: 260,
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: colors.scanner.viewport,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.slate[200],
  },
  cropRow: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  crop: {
    width: 160,
    height: 160,
    borderRadius: radii.lg,
    backgroundColor: colors.slate[100],
  },
  cropHint: {
    textAlign: 'center',
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
  separator: {
    height: 1,
    backgroundColor: colors.slate[100],
    marginVertical: spacing.xxs,
  },
  errorBox: {
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.status.rejectedSoft,
  },
});
