import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { updateSettings } from '../db/seed';
import { computeEnvelope, totalFixed, totalIncome } from '../domain/defaults';
import { loadDemo } from '../domain/demo';
import { syncHolderRules } from '../domain/learn';
import { useSettings } from '../hooks';
import { APP_NAME } from '../lib/app';
import { formatCents } from '../lib/money';
import { setMood } from '../ui/mood';
import { setDockHidden } from '../ui/dockStore';
import { Orb, ThemePicker } from '../ui/extras';
import { springs } from '../ui/motion';
import { Button, Card, Chip, Glass, Icon, MoneyField, Segmented, StepperRow, TextField, toast } from '../ui/index';
import { isThemeId } from '../ui/themes';
import { LinesEditor } from './settings/LinesEditor';

const STEPS = ['welcome', 'income', 'charges', 'savings', 'names', 'look', 'done'] as const;
type Step = (typeof STEPS)[number];

/** Premier lancement : tout ce qui rend l'app personnelle, en quelques écrans, tout modifiable ensuite. */
export default function OnboardingPage() {
  const s = useSettings();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('welcome');
  const [dir, setDir] = useState(1);
  const [name, setName] = useState('');
  const index = STEPS.indexOf(step);

  useEffect(() => {
    setMood('focus');
    setDockHidden(true);
    return () => setDockHidden(false);
  }, []);

  const go = (delta: number) => {
    setDir(delta);
    setStep(STEPS[Math.max(0, Math.min(STEPS.length - 1, index + delta))] as Step);
    window.scrollTo({ top: 0 });
  };
  const finish = async (to: string, demo = false) => {
    await updateSettings({ onboarded: true });
    if (demo) {
      const n = await loadDemo();
      toast({ message: `${n} opérations de démo chargées`, tone: 'gold' });
    }
    navigate(to, { replace: true });
  };

  const envelope = computeEnvelope(s);

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-content flex-col px-4" style={{ paddingTop: 'calc(var(--safe-top) + 20px)', paddingBottom: 'calc(var(--safe-bottom) + 20px)' }}>
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1.5" aria-label={`Étape ${index + 1} sur ${STEPS.length}`}>
          {STEPS.map((x, i) => (
            <span key={x} className="h-1 flex-1 rounded-pill" style={{ background: i <= index ? 'linear-gradient(90deg, var(--accent-g0), var(--accent-g1))' : 'var(--surface-alt)', boxShadow: i === index ? '0 0 10px var(--accent-glow)' : undefined }} />
          ))}
        </div>
        {step !== 'done' && (
          <Button variant="ghost" size="sm" onClick={() => void finish('/')}>
            Passer
          </Button>
        )}
      </div>

      <main id="contenu" className="relative mt-6 flex-1 overflow-x-clip">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.section key={step} custom={dir} initial={{ opacity: 0, x: 40 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 * dir }} transition={springs.soft} className="space-y-4">
            {step === 'welcome' && (
              <>
                <Glass level="raised" className="flex h-[72px] w-[72px] items-center justify-center rounded-[24px] text-accent" style={{ boxShadow: '0 0 40px var(--accent-glow), inset 0 1px 0 var(--glass-raised-spec)' }}>
                  <Icon name="diamond-fill" size={32} />
                </Glass>
                <p className="t-label text-gold">Bienvenue</p>
                <h1 className="t-large">{APP_NAME}</h1>
                <p className="t-body text-secondary">Ton budget au jour près, tes comptes, tes placements et tes objectifs, au même endroit. Tout reste sur ton téléphone : pas de compte, pas de pub, pas de traceur.</p>
                <Card className="space-y-2">
                  {[
                    ['flash', 'Combien tu peux dépenser aujourd’hui'],
                    ['trend-up', 'Ton solde prévu jusqu’à la prochaine paie'],
                    ['diamond', 'Patrimoine, ETF, crypto, objectifs'],
                    ['lock', 'Synchro bancaire en lecture seule'],
                  ].map(([icon, text]) => (
                    <p key={text} className="t-body flex items-center gap-3">
                      <Icon name={icon as 'flash'} className="text-accent" />
                      {text}
                    </p>
                  ))}
                </Card>
                <TextField label="Ton prénom (facultatif)" value={s.firstName} onCommit={(firstName) => void updateSettings({ firstName: firstName.trim() })} placeholder="Pour te saluer" autoComplete="given-name" />
              </>
            )}

            {step === 'income' && (
              <>
                <p className="t-label text-gold">1 · Tes rentrées</p>
                <h1 className="t-large">Quand et combien ?</h1>
                <p className="t-body text-secondary">Ton cycle budgétaire commence le jour où tu es payé. Ajoute tes revenus du mois : salaire, bourse, aides, pension…</p>
                <Card>
                  <StepperRow label="Jour de paie" hint="Début de chaque cycle" value={s.payday} min={1} max={31} onChange={(payday) => void updateSettings({ payday })} format={(d) => `le ${d}`} />
                </Card>
                <LinesEditor lines={s.incomes} onChange={(incomes) => void updateSettings({ incomes })} icon="cash" addLabel="Ajouter un revenu" emptyLabel="Aucun revenu pour l’instant." suggestions={['Salaire', 'Bourse', 'APL', 'Alternance']} />
              </>
            )}

            {step === 'charges' && (
              <>
                <p className="t-label text-gold">2 · Tes charges fixes</p>
                <h1 className="t-large">Ce qui part chaque mois</h1>
                <p className="t-body text-secondary">Loyer, énergie, forfait, assurances, abonnements… Pas besoin d’être exhaustif : l’app repérera aussi les prélèvements récurrents dans tes comptes.</p>
                <LinesEditor lines={s.fixedCharges} onChange={(fixedCharges) => void updateSettings({ fixedCharges })} icon="receipt" addLabel="Ajouter une charge" emptyLabel="Aucune charge fixe pour l’instant." suggestions={['Loyer', 'Électricité', 'Forfait mobile', 'Box internet']} />
              </>
            )}

            {step === 'savings' && (
              <>
                <p className="t-label text-gold">3 · Ton épargne</p>
                <h1 className="t-large">Payer ton futur d’abord</h1>
                <p className="t-body text-secondary">Ce que tu mets de côté ou investis chaque mois (Livret A, PEA, Trade Republic, Bitstack…) sort de ton budget du quotidien.</p>
                <Card className="space-y-3">
                  <Segmented
                    options={[
                      { value: 'manual', label: 'Un montant fixe' },
                      { value: 'auto', label: 'Je réglerai mes plans' },
                    ]}
                    value={s.savings.mode}
                    onChange={(mode) => void updateSettings({ savings: { ...s.savings, mode } })}
                    label="Épargne"
                  />
                  {s.savings.mode === 'manual' ? (
                    <MoneyField label="Par mois" value={s.savings.manual} onCommit={(v) => void updateSettings({ savings: { ...s.savings, manual: Math.abs(v ?? 0) } })} />
                  ) : (
                    <p className="t-small text-secondary">Tes investissements programmés et objectifs (onglet Patrimoine) seront additionnés automatiquement.</p>
                  )}
                </Card>
                <Card level="raised" glow={envelope > 0} tone={envelope <= 0 ? 'danger' : 'neutral'}>
                  <p className="t-label text-muted">Ton enveloppe vie courante</p>
                  <p className={`num mt-1 font-display text-[30px] font-bold tracking-[-0.8px] ${envelope <= 0 ? 'text-danger' : ''}`}>{formatCents(envelope)}</p>
                  <p className="t-small text-secondary">
                    {formatCents(totalIncome(s))} de revenus − {formatCents(totalFixed(s))} de charges − {formatCents(s.savings.mode === 'manual' ? s.savings.manual : s.plannedSavingsAuto)} d’épargne, à dépenser sur le cycle.
                  </p>
                </Card>
              </>
            )}

            {step === 'names' && (
              <>
                <p className="t-label text-gold">4 · Tes virements</p>
                <h1 className="t-large">Ton nom sur tes relevés</h1>
                <p className="t-body text-secondary">Quand tu vires de l’argent d’une de tes banques à une autre, ce n’est ni une dépense ni un revenu. Indique ton nom tel qu’il apparaît sur les virements pour que l’app les reconnaisse.</p>
                <div className="flex flex-wrap gap-2">
                  {s.holderNames.map((n) => (
                    <Chip key={n} selected onClick={() => void updateSettings({ holderNames: s.holderNames.filter((x) => x !== n) })}>
                      {n} ✕
                    </Chip>
                  ))}
                </div>
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = name.trim();
                    if (!n) return;
                    setName('');
                    void updateSettings({ holderNames: [...s.holderNames, n] });
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <TextField label="Prénom Nom" value={name} onChange={setName} placeholder="Ex. Camille Martin" autoComplete="name" />
                  </div>
                  <Button type="submit" disabled={!name.trim()}>
                    Ajouter
                  </Button>
                </form>
              </>
            )}

            {step === 'look' && (
              <>
                <p className="t-label text-gold">5 · Ton ambiance</p>
                <h1 className="t-large">Choisis ta lumière</h1>
                <ThemePicker value={isThemeId(s.theme) ? s.theme : 'nuit'} onChange={(theme) => void updateSettings({ theme })} />
                <Card>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="t-body-strong">Suivre le téléphone</p>
                      <p className="t-caption text-muted">Clair le jour, sombre le soir, selon ton réglage système.</p>
                    </div>
                    <Chip selected={s.followSystem} onClick={() => void updateSettings({ followSystem: !s.followSystem })}>
                      {s.followSystem ? 'Oui' : 'Non'}
                    </Chip>
                  </div>
                </Card>
              </>
            )}

            {step === 'done' && (
              <div className="flex flex-col items-center gap-4 pt-6 text-center">
                <Orb trigger="done" size={84} />
                <p className="t-label text-gold">C’est prêt</p>
                <h1 className="t-large">{s.firstName ? `À toi de jouer, ${s.firstName}` : 'À toi de jouer'}</h1>
                <p className="t-body max-w-[360px] text-secondary">Connecte ta banque pour que tes opérations arrivent toutes seules, ou découvre l’app avec des données fictives. Tout se modifie ensuite dans Réglages.</p>
                <div className="mt-2 flex w-full flex-col gap-2">
                  <Button size="lg" icon="bank" className="w-full" onClick={() => void finish('/synchro')}>
                    Connecter ma banque
                  </Button>
                  <Button variant="secondary" className="w-full" onClick={() => void finish('/', true)}>
                    Essayer avec la démo
                  </Button>
                  <Button variant="ghost" className="w-full" onClick={() => void finish('/')}>
                    Commencer sans banque
                  </Button>
                </div>
              </div>
            )}
          </motion.section>
        </AnimatePresence>
      </main>

      {step !== 'done' && (
        <div className="sticky bottom-0 mt-6 flex gap-2 pt-2" style={{ paddingBottom: 'calc(var(--safe-bottom) + 4px)' }}>
          {index > 0 && (
            <Button variant="secondary" icon="chevron-back" onClick={() => go(-1)} label="Étape précédente">
              Retour
            </Button>
          )}
          <Button
            size="lg"
            className="flex-1"
            onClick={() => {
              if (step === 'names') void syncHolderRules(s.holderNames);
              go(1);
            }}
          >
            Continuer
          </Button>
        </div>
      )}
    </div>
  );
}
