import { m } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MYLIFE_APPS, type MyLifeApp } from '../vendor/lumen';
import { AccountForms } from '../ui/account';
import { setDockHidden } from '../ui/dockStore';
import { Icon, type IconName } from '../ui/icons';
import { springs } from '../ui/motion';
import { Button } from '../ui/index';
import { useSession } from '../ui/session';
import { markWelcomed } from '../welcome';

const APP_ICON: Record<MyLifeApp['id'], IconName> = { finances: 'diamond-fill', perf: 'barbell', raveloc: 'navigate' };

/** Premier lancement : ce qu'est MyLife, puis le compte (ou plus tard). */
export function WelcomePage() {
  const navigate = useNavigate();
  const session = useSession();
  const [step, setStep] = useState<'hello' | 'account'>('hello');
  const [existing, setExisting] = useState(false);
  useEffect(() => {
    setDockHidden(true);
    return () => setDockHidden(false);
  }, []);
  const done = () => {
    markWelcomed();
    navigate('/', { replace: true });
  };
  // Compte créé ou ouvert : la clé de secours s'affiche sur l'accueil (RecoveryReminder).
  useEffect(() => {
    if (session && step === 'account') done();
  }, [session, step]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main id="contenu" className="mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col px-4" style={{ paddingTop: 'calc(var(--safe-top) + 32px)', paddingBottom: 'calc(var(--safe-bottom) + 24px)' }}>
      {step === 'hello' ? (
        <>
          <m.img src="/pwa-192x192.png" alt="" width={88} height={88} className="rounded-[24px]" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={springs.liquid} />
          <p className="t-label mt-6 text-gold">Bienvenue</p>
          <h1 className="t-hero mt-1">MyLife</h1>
          <p className="t-body mt-2 text-secondary">Tes finances, ton entraînement et tes sorties dans une seule app. Un compte, tes données chiffrées sur ton téléphone.</p>
          <div className="mt-6 flex flex-col gap-3">
            {MYLIFE_APPS.map((a, i) => (
              <m.div key={a.id} className="flex items-center gap-3" initial={{ x: -12, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...springs.soft, delay: 0.1 + i * 0.07 }}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-white" style={{ background: `linear-gradient(150deg, ${a.colors[0]}, ${a.colors[1]})` }}>
                  <Icon name={APP_ICON[a.id]} size={22} />
                </span>
                <span>
                  <span className="t-body-strong block">{a.name}</span>
                  <span className="t-small block text-secondary">{a.tagline}</span>
                </span>
              </m.div>
            ))}
          </div>
          <div className="flex-1" />
          <div className="mt-8 flex flex-col gap-2">
            <Button size="lg" onClick={() => setStep('account')}>
              Commencer
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setExisting(true);
                setStep('account');
              }}
            >
              J’ai déjà un compte
            </Button>
          </div>
        </>
      ) : (
        <>
          <button type="button" onClick={() => setStep('hello')} className="mb-4 flex h-11 w-11 items-center justify-center rounded-full" aria-label="Retour">
            <Icon name="chevron-back" size={22} />
          </button>
          <AccountForms initial={existing ? 'login' : 'create'} />
        </>
      )}
    </main>
  );
}
