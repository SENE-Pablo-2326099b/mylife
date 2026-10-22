import { useSearchParams } from 'react-router-dom';
import { MYLIFE_APPS } from '../vendor/lumen';
import { AccountForms, AccountOverview, type AccountStatusRow } from '../ui/account';
import { Reveal } from '../ui/index';
import { relativeTime } from '../ui/relative';
import { Screen } from '../ui/Screen';
import { useSession } from '../ui/session';

interface LocalSync {
  joinedAs: string | null;
  lastSyncAt: number | null;
}

/** Ce que chaque app a noté de sa synchro sur cet appareil (même adresse, même stockage). */
function localSync(app: string): LocalSync | null {
  try {
    return JSON.parse(localStorage.getItem(`mylife-sync-${app}`) ?? 'null') as LocalSync | null;
  } catch {
    return null;
  }
}

function rows(login: string): AccountStatusRow[] {
  const out: AccountStatusRow[] = MYLIFE_APPS.filter((a) => a.id !== 'raveloc').map((a) => {
    const s = localSync(a.id);
    const joined = s?.joinedAs === login;
    return {
      label: a.name,
      detail: joined ? `Synchronisée ${relativeTime(s?.lastSyncAt ?? null)}` : 'Se relie au compte à sa prochaine ouverture',
      state: joined ? 'ok' : 'off',
    };
  });
  out.push({ label: 'myRaveLoc', detail: 'Groupes et positions chiffrés, en direct', state: 'ok' });
  const prefs = localSync('mylife');
  out.push({ label: 'Apparence', detail: prefs?.joinedAs === login ? 'La même sur tous tes appareils' : 'Bientôt la même sur tous tes appareils', state: prefs?.joinedAs === login ? 'ok' : 'busy' });
  return out;
}

export function AccountPage() {
  const session = useSession();
  const [params] = useSearchParams();
  return (
    <Screen title="Compte" kicker="MyLife" mood="settings">
      <Reveal index={0}>{session ? <AccountOverview session={session} rows={rows(session.login)} /> : <AccountForms initial={params.get('mode') === 'login' ? 'login' : 'create'} />}</Reveal>
    </Screen>
  );
}
