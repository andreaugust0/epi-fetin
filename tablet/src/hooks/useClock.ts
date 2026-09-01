import { useEffect, useState } from 'react';

/** Relógio que atualiza a cada segundo, como o cabeçalho do terminal original. */
export const useClock = (): Date => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return now;
};
