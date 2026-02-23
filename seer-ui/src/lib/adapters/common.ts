export type ViewModelMeta = {
  adapted_at: string;
};

export function buildViewModelMeta(): ViewModelMeta {
  return {
    adapted_at: new Date().toISOString(),
  };
}
