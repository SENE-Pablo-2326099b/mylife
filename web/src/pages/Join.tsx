import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { parseSpaceInvite } from '../vendor/mylife-sync';
import { client, loadSpaces } from '../spaces';
import { Button, Card, TextField } from '../ui/index';
import { Screen } from '../ui/Screen';
import { useSession } from '../ui/session';
import { toast } from '../ui/toastStore';

/** /rejoindre#espace=… : « Rejoindre la sortie ? » puis le pseudo. Les invitations d'un autre type sont refusées. */

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const defaultPseudo = (login: string | undefined) => (login ? login.charAt(0).toUpperCase() + login.slice(1) : '');
const GONE = 'Cette invitation mène à une fonction qui n’existe plus dans MyLife (Crew, foyer). Seules les Sorties restent.';

export function JoinPage() {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const invite = useMemo(() => parseSpaceInvite(location.hash), [location.hash]);
  const [info, setInfo] = useState<{ sid: string; kind: string; name: string; member: boolean } | null>(null);
  const [error, setError] = useState<string | null>(invite ? null : 'Ce lien d’invitation est incomplet. Demande-le à nouveau.');
  const [pseudo, setPseudo] = useState(defaultPseudo(session?.login));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = client();
    if (!invite || !c) return;
    c.peek(invite).then(
      (r) => {
        if (r.kind !== 'sortie') setError(GONE);
        else if (r.member) navigate(`/sorties/${r.sid}`, { replace: true });
        else setInfo(r);
      },
      (e: unknown) => setError(errorText(e)),
    );
  }, [invite, navigate]);

  const join = async () => {
    const c = client();
    if (!c || !invite || !info) return;
    setBusy(true);
    try {
      const { uid } = await c.list();
      await c.join(invite, info.sid, pseudo.trim() || defaultPseudo(session?.login), uid);
      await loadSpaces();
      toast({ message: `Bienvenue dans « ${info.name} »`, tone: 'gold' });
      navigate(`/sorties/${info.sid}`, { replace: true });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen stack title="Rejoindre une sortie" mood="today" back="/">
      <div className="flex flex-col gap-3">
        {error && (
          <Card>
            <p className="t-body text-danger">{error}</p>
          </Card>
        )}
        {!error && !info && <p className="t-small px-1 text-muted">Lecture du lien…</p>}
        {info && (
          <>
            <Card level="raised" glow>
              <p className="t-label text-gold">Invitation à une sortie</p>
              <p className="t-title">Rejoindre « {info.name} » ?</p>
              <div className="mt-3 flex flex-col gap-3">
                <TextField label="Ton pseudo pour cette sortie" value={pseudo} onChange={setPseudo} />
                <Button icon="people" disabled={busy} onClick={() => void join()}>
                  {busy ? 'Un instant…' : 'Rejoindre'}
                </Button>
              </div>
            </Card>
            <Card>
              <p className="t-small text-secondary">Réponses, planning, budget et liste sont chiffrés : seuls les membres de la sortie les voient, pas même le serveur.</p>
            </Card>
          </>
        )}
      </div>
    </Screen>
  );
}
