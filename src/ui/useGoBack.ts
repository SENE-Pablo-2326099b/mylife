import { useNavigate } from 'react-router-dom';

/** Retour : l'écran précédent, ou `fallback` quand il n'y en a pas (lien direct, rechargement). */
export function useGoBack(fallback = '/'): () => void {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}
