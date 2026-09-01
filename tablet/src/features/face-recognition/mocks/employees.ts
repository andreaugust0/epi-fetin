import type { RecognizedEmployee } from '../types';

/**
 * Pessoas simuladas enquanto o reconhecimento facial real não existe.
 * Representam os registros que virão do banco depois que o embarcado
 * relacionar o rosto a um funcionário cadastrado.
 */
export const MOCK_EMPLOYEES: readonly RecognizedEmployee[] = [
  {
    id: 'employee-001',
    nome: 'Caio de Castro Yarouhas',
    email: 'caio@empresa.com',
    matricula: '001',
    setor: 'Segurança',
  },
  {
    id: 'employee-002',
    nome: 'Ana Ferreira',
    email: 'ana@empresa.com',
    matricula: '002',
    setor: 'Montagem',
  },
  {
    id: 'employee-003',
    nome: 'Roberto Lima',
    email: 'roberto@empresa.com',
    matricula: '003',
    setor: 'Qualidade',
  },
] as const;
