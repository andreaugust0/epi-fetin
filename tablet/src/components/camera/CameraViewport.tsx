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
  ({ children, style }, ref) => {
    const [permission, requestPermission] = useCameraPermissions();
    const availability = useCameraAvailability();

    const showCamera = availability === 'available' && Boolean(permission?.granted);

    useEffect(() => {
      if (permission && !permission.granted && permission.canAskAgain) {
        void requestPermission();
      }
    }, [permission, requestPermission]);

    return (
      <View testID="camera-viewport" style={[styles.viewport, style]}>
        {showCamera ? (
          <CameraView ref={ref} style={StyleSheet.absoluteFill} facing="front" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
            <MaterialCommunityIcons name="account-outline" size={120} color={colors.overlayBorder} />
            <Text variant="caption" color={colors.slate[400]} align="center">
              {APP_MESSAGES.camera.unavailableTitle}
            </Text>
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
