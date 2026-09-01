import { CameraView } from 'expo-camera';
import { useEffect, useState } from 'react';

export type CameraAvailability = 'checking' | 'available' | 'unavailable';

/**
 * Detecta dispositivos sem câmera (emuladores e navegadores), permitindo exibir
 * o estado "câmera indisponível" em vez de uma tela preta.
 */
export const useCameraAvailability = (): CameraAvailability => {
  const [availability, setAvailability] = useState<CameraAvailability>('checking');

  useEffect(() => {
    let active = true;

    CameraView.isAvailableAsync()
      .then((isAvailable) => {
        if (active) {
          setAvailability(isAvailable ? 'available' : 'unavailable');
        }
      })
      .catch(() => {
        // A verificação só é implementada na web; nas demais plataformas
        // assumimos que a câmera existe e deixamos a permissão decidir.
        if (active) {
          setAvailability('available');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return availability;
};
