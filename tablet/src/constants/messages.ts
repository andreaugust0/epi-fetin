/**
 * Todos os textos visíveis ao usuário. Centralizados para manter a consistência
 * com o protótipo e facilitar revisão/tradução futura.
 */
export const APP_MESSAGES = {
  home: {
    title: 'Verificação de EPIs',
    subtitle: 'Identifique-se e verifique seus equipamentos de proteção individual.',
    equipmentCountSuffix: 'equipamentos exigidos',
    equipmentCountSuffixSingular: 'equipamento exigido',
    startButton: 'Iniciar',
    simulationNotice:
      'Modo simulado: os resultados são gerados localmente até que a integração com a detecção real seja configurada.',
    noEquipmentTitle: 'Nenhum equipamento ativo',
    noEquipmentDescription: 'Nenhum equipamento está configurado para verificação neste terminal.',
  },

  steps: {
    start: 'Início',
    identification: 'Identificação',
    verification: 'Verificação',
    access: 'Acesso',
  },

  camera: {
    title: 'Verificação',
    back: 'Voltar',
    frameHint: 'Posicione-se dentro do quadro e permaneça parado',
    captureLabel: 'Capturar foto',
    flipLabel: 'Alternar câmera',
    capturing: 'Capturando...',
    permissionTitle: 'Precisamos da sua câmera',
    permissionDescription:
      'A câmera é usada apenas durante a verificação dos equipamentos de proteção individual. Nenhuma imagem sai do aparelho enquanto o modo simulado estiver ativo.',
    permissionRequestButton: 'Permitir câmera',
    permissionDeniedTitle: 'Permissão de câmera negada',
    permissionDeniedDescription:
      'Autorize o acesso à câmera nas configurações do aparelho para realizar a verificação.',
    openSettingsButton: 'Abrir configurações',
    unavailableTitle: 'Câmera indisponível',
    unavailableDescription:
      'Este dispositivo não possui uma câmera compatível para realizar a verificação.',
    captureErrorTitle: 'Não foi possível capturar',
    captureErrorDescription: 'Tente novamente mantendo o aparelho estável.',
  },

  scan: {
    title: 'Verificação de EPIs',
    analyzing: 'Analisando...',
    epiDetecting: 'Verificando equipamentos...',
    epiDetectingHint: 'Permaneça na posição marcada até o fim da verificação.',
    checklistTitle: 'Equipamentos',
    waiting: 'Aguardando',
    detected: 'Detectado',
    notDetected: 'Não detectado',
    cancelledTitle: 'Verificação interrompida',
    cancelledDescription: 'A verificação foi cancelada antes de terminar.',
    errorTitle: 'Falha na verificação',
    errorDescription: 'Não foi possível concluir a verificação. Tente novamente.',
    retryButton: 'Tentar novamente',
  },

  face: {
    title: 'Identificação Facial',
    instruction: 'Posicione seu rosto em frente à câmera.',
    instructionDetail: 'Mantenha-se na posição e olhe diretamente para a câmera.',
    startButton: 'Iniciar Reconhecimento',
    scanning: 'Identificando funcionário...',
    scanningHint: 'Mantenha o rosto posicionado e olhe para a câmera.',
    unknownTitle: 'Não foi possível identificar o funcionário',
    /**
     * Deliberadamente sem apontar uma causa: pode ser posicionamento, luz ou
     * simplesmente um rosto que não corresponde a nenhum cadastro.
     */
    unknownDescription:
      'Nenhum cadastro correspondeu ao rosto com confiança suficiente. Isso também pode acontecer por condições da captura.',
    /** Versão curta, para a tela operacional — legível de relance. */
    unknownShortHint: 'Olhe diretamente para a câmera e tente novamente.',
    unknownShortChecks: ['Centralize o rosto', 'Evite sombras fortes', 'Mantenha distância adequada'],
    /** Resultado AMBIGUO do servidor: mais de um cadastro ficou próximo demais para decidir. */
    ambiguousTitle: 'Não foi possível confirmar com segurança',
    ambiguousHint: 'Mais de um cadastro correspondeu ao rosto. Centralize bem o rosto e tente novamente.',
    /** Resultado SEM_CONSENTIMENTO: a pessoa bateria o limiar, mas sem consentimento vigente. */
    noConsentTitle: 'Biometria indisponível para este cadastro',
    noConsentHint: 'Procure o responsável administrativo — o consentimento biométrico não está vigente.',
    retryButton: 'Tentar Novamente',
    backHomeButton: 'Voltar ao Início',
    errorTitle: 'Falha na identificação',
    errorDescription: 'Não foi possível concluir a identificação. Tente novamente.',
    /** Erros administrativos/operacionais — nunca detalhe técnico para o funcionário. */
    configMissingDescription:
      'O aplicativo não está configurado para falar com o servidor. Procure o responsável pela configuração do tablet.',
    tokenMissingDescription:
      'Este tablet ainda não foi autorizado pelo servidor. Procure o responsável administrativo.',
    noFaceTitle: 'Nenhum rosto detectado',
    identifiedTitle: 'Usuário identificado',
    identifiedAdvancing: 'Preparando próxima etapa...',
    registrationLabel: 'Matrícula',
    sectorLabel: 'Setor',
    confidenceLabel: 'Confiança',
  },

  preparation: {
    title: 'Funcionário identificado',
    positionInstruction:
      'Dirija-se à posição marcada no chão para realizar a verificação dos equipamentos.',
    positionDetail:
      'Permaneça na posição indicada e certifique-se de que todo o corpo esteja visível para a câmera.',
    startButton: 'Iniciar Verificação de EPI',
    exitButton: 'Sair',
    exitHint: 'Voltar ao início',
    missingEmployeeTitle: 'Nenhum funcionário identificado',
    missingEmployeeDescription: 'Faça a identificação facial antes de verificar os equipamentos.',
  },

  result: {
    approvedTitle: 'ACESSO LIBERADO',
    rejectedTitle: 'ACESSO NEGADO',
    checklistTitle: 'Equipamentos analisados',
    /** Compõe "Verificação reprovada por ausência de N equipamento(s) obrigatório(s)." */
    rejectedReasonPrefix: 'Verificação reprovada por ausência de',
    rejectedReasonSuffixSingular: 'equipamento obrigatório.',
    rejectedReasonSuffix: 'equipamentos obrigatórios.',
    rejectedLowConfidence:
      'Verificação reprovada: os equipamentos não foram reconhecidos com confiança suficiente.',
    retryQuestion: 'Deseja realizar a verificação dos EPIs novamente?',
    retryButton: 'Verificar Novamente',
    exitButton: 'Sair',
    backHomeButton: 'Voltar ao Início',
    missingResultTitle: 'Resultado indisponível',
    missingResultDescription: 'Nenhuma verificação em andamento. Inicie uma nova.',
  },

  notFound: {
    title: 'Tela não encontrada',
    description: 'Esta rota não faz parte do terminal de verificação.',
  },

  counts: {
    detectedCountLabel: 'detectados',
    detectedCountLabelSingular: 'detectado',
    missingCountLabel: 'ausentes',
    missingCountLabelSingular: 'ausente',
  },

  states: {
    loading: 'Carregando...',
    genericErrorTitle: 'Algo deu errado',
    genericErrorDescription: 'Não foi possível concluir a operação. Tente novamente.',
    offlineTitle: 'Sem conexão',
    offlineDescription:
      'A análise por API precisa de internet. Verifique sua conexão e tente novamente.',
    retryButton: 'Tentar novamente',
  },

  common: {
    confirm: 'Confirmar',
    cancel: 'Cancelar',
    close: 'Fechar',
    delete: 'Apagar',
    remove: 'Remover',
    edit: 'Editar',
    back: 'Voltar',
  },
} as const;
