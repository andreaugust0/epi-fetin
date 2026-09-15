import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { forwardRef, useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui';
import { APP_MESSAGES } from '@/constants/messages';
import { useCameraAvailability } from '@/hooks/useCameraAvailability';
import { colors, radii, spacing } from '@/theme';

export interface CameraViewportProps {
  /** Sobreposições do visor: moldura, guia facial, legendas. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Liga a câmera de verdade. Falso mantém o visor com a mesma moldura e a
   * mesma silhueta, mas sem nenhuma view nativa de câmera dentro dele.
   *
   * Existe por causa de um travamento concreto. `useCameraAvailability`
   * começa em `checking`, então o primeiro render põe o substituto na
   * posição 0 e a resposta assíncrona TROCA essa posição pela `CameraView`
   * nativa. Numa tela que vive segundos, a troca acontece e pronto. Numa que
   * vive menos de um segundo — que é o caso quando o servidor decide rápido —
   * a troca cai em cima do desmonte da superfície e o Fabric aborta com
   * `addViewAt: failed to insert view […] at index 0 · The specified child
   * already has a parent`.
   *
   * Onde a câmera é usada de fato (identificação facial), ela continua ligada
   * e a tela vive tempo suficiente. Onde ela é só enfeite, `live={false}`
   * elimina a troca inteira: a posição 0 passa a ser sempre a mesma view.
   */
  live?: boolean;
}

/**
 * Visor da câmera frontal do tablet.
 *
 * A permissão é solicitada uma única vez e não bloqueia nada: o visor é apenas
 * a referência visual para o funcionário se posicionar, então um aparelho sem
 * câmera mostra um substituto em vez de travar o fluxo.
 *
 * A ref é encaminhada para o `CameraView` nativo — quem precisa disparar
 * `takePictureAsync` (o reconhecimento facial automático) a usa diretamente;
 * fica `null` sempre que o placeholder está no lugar da câmera real.
 */
export const CameraViewport = forwardRef<CameraView, CameraViewportProps>(
  ({ children, style, live = true }, ref) => {
    const [permission, requestPermission] = useCameraPermissions();
    const availability = useCameraAvailability();

    const showCamera = live && availability === 'available' && Boolean(permission?.granted);

    useEffect(() => {
      if (!live) {
        return;
      }
      if (permission && !permission.granted && permission.canAskAgain) {
        void requestPermission();
      }
    }, [live, permission, requestPermission]);

    return (
      <View testID="camera-viewport" style={[styles.viewport, style]}>
        {showCamera ? (
          <CameraView
            ref={ref}
            style={StyleSheet.absoluteFill}
            facing="front"
            /*
             * `animateShutter` vem ligado por padrão e é o clarão que aparece
             * ao disparar `takePictureAsync`. Num aplicativo de câmera ele diz
             * "foto tirada"; aqui ele mente. O funcionário não está tirando
             * foto: está sendo reconhecido, e nenhuma imagem é guardada. O
             * efeito sugere um registro fotográfico que não existe, bem no
             * ponto do fluxo em que a promessa de privacidade mais importa.
             */
            animateShutter={false}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
            <MaterialCommunityIcons name="account-outline" size={120} color={colors.overlayBorder} />
            {/*
              O aviso só faz sentido quando a câmera era para estar ligada e
              não está. Com `live={false}` ela está desligada de propósito, e
              dizer "indisponível" mandaria a manutenção procurar um defeito
              que não existe.
            */}
            {live ? (
              <Text variant="caption" color={colors.slate[400]} align="center">
                {APP_MESSAGES.camera.unavailableTitle}
              </Text>
            ) : null}
          </View>
        )}

        {children}
      </View>
    );
  },
);

CameraViewport.displayName = 'CameraViewport';

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    minHeight: 200,
    borderRadius: radii.xxl,
    overflow: 'hidden',
    backgroundColor: colors.scanner.viewport,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
