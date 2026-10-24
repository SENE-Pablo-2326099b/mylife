import { retryLocation } from '../services/location';
import { Button } from '../ui/index';

/** iPhone ou iPad (iPadOS se présente comme un Mac tactile). */
export const isIos = () => typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const installed = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/**
 * Localisation refusée : les étapes exactes pour la rétablir, selon l'appareil. Sur iPhone, l'app installée suit le
 * réglage « Sites web Safari » : coupé, ou un premier « Ne pas autoriser », et iOS refuse sans même redemander.
 */
export function LocationHelp({ compact = false }: { compact?: boolean }) {
  const ios = isIos();
  return (
    <div className="flex flex-col gap-2">
      {ios ? (
        <ol className={`${compact ? 't-caption' : 't-small'} list-decimal space-y-1 pl-5 text-left text-secondary`}>
          <li>Réglages → Confidentialité et sécurité → Service de localisation : activé.</li>
          <li>Dans cette liste, « Sites web Safari » : « Lorsque l’app est active », avec « Position exacte » activée.</li>
          <li>Réglages → Apps → Safari → Localisation (ou Réglages → Safari selon ta version d’iOS) : « Demander » ou « Autoriser ».</li>
          <li>{installed() ? 'Ferme complètement MyLife (balaie-la vers le haut dans le sélecteur d’apps), rouvre-la' : 'Recharge la page'}, puis touche « Réessayer ».</li>
        </ol>
      ) : (
        <p className={`${compact ? 't-caption' : 't-small'} text-secondary`}>
          Autorise la localisation pour ce site : icône à gauche de l’adresse → Autorisations → Position (sur Android : appui long sur l’icône de MyLife → Infos sur l’appli → Autorisations → Position), puis réessaie.
        </p>
      )}
      <Button size="sm" variant="secondary" icon="sync" onClick={retryLocation}>
        Réessayer
      </Button>
    </div>
  );
}
