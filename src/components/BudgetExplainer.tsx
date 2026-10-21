import type { Account, Category, Settings, Transaction } from '../db/types';
import { isVariable, type CatMap, type DailyBudget } from '../domain/budget';
import { plannedSavings, totalFixed, totalIncome } from '../domain/defaults';
import { formatShort } from '../lib/dates';
import { Button, Card, Divider, Group, Money, SectionTitle, Sheet } from '../ui/index';
import { TxRow } from './TxRow';

function Line({ label, cents, sign, strong }: { label: string; cents: number; sign?: '−' | '=' | '÷'; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className={`${strong ? 't-body-strong' : 't-body text-secondary'} min-w-0`}>
        {sign && <span className="mr-1.5 inline-block w-3 text-muted">{sign}</span>}
        {label}
      </span>
      <Money cents={cents} className={strong ? 'text-[17px]' : 'text-[15px]'} tone={strong && cents < 0 ? 'danger' : undefined} />
    </div>
  );
}

/** « Comment c'est calculé » : de l'enveloppe au budget du jour, avec les dépenses qui pèsent le plus. */
export function BudgetExplainer({
  open,
  onClose,
  b,
  settings,
  txs,
  cats,
  accounts,
  onEdit,
}: {
  open: boolean;
  onClose: () => void;
  b: DailyBudget;
  settings: Settings;
  txs: Transaction[];
  cats: CatMap;
  accounts: Map<string, Account>;
  onEdit: (tx: Transaction) => void;
}) {
  const counted = txs.filter((t) => t.date < b.today && isVariable(t, cats));
  const biggest = [...counted].sort((x, y) => x.amount - y.amount).slice(0, 6);
  const unclassified = counted.filter((t) => t.categoryId === null);
  const unclassifiedTotal = -unclassified.reduce((s, t) => s + t.amount, 0);
  const override = settings.envelopeOverride !== null;
  const noIncome = !override && totalIncome(settings) === 0;
  const available = b.envelope - b.spentBefore;
  const cat = (t: Transaction): Category | undefined => (t.categoryId ? cats.get(t.categoryId) : undefined);

  return (
    <Sheet open={open} onClose={onClose} title="Comment c’est calculé">
      {noIncome && (
        <Card tone="warning" className="mb-3">
          <p className="t-body-strong">Aucun revenu renseigné</p>
          <p className="t-small mt-1 text-secondary">Ton enveloppe vaut donc 0 € et chaque dépense la dépasse. Ajoute ton salaire ou tes aides dans les réglages du budget.</p>
          <Button to="/reglages/budget" size="sm" className="mt-3" onClick={onClose}>
            Renseigner mes revenus
          </Button>
        </Card>
      )}
      <Card>
        {override ? (
          <Line label="Enveloppe fixée à la main" cents={b.envelope} />
        ) : (
          <>
            <Line label="Revenus du mois" cents={totalIncome(settings)} />
            <Line sign="−" label="Charges fixes" cents={totalFixed(settings)} />
            <Line sign="−" label="Épargne prévue" cents={plannedSavings(settings)} />
            <Divider />
            <Line sign="=" label="Enveloppe vie courante" cents={b.envelope} strong />
          </>
        )}
        <Line sign="−" label={`Dépensé du ${formatShort(b.cycle.start)} à hier`} cents={b.spentBefore} />
        <Divider />
        <Line sign="=" label="Disponible pour la fin du cycle" cents={available} strong />
        <Line sign="÷" label={`${b.daysLeft} jour${b.daysLeft > 1 ? 's' : ''} restant${b.daysLeft > 1 ? 's' : ''}, aujourd’hui compris`} cents={b.dailyBudget} />
        <p className="t-small mt-2 text-muted">
          {available < 0
            ? 'Le disponible est négatif : les dépenses du cycle ont déjà dépassé l’enveloppe, donc le budget du jour est négatif même sans rien dépenser aujourd’hui.'
            : 'Les dépenses d’aujourd’hui consomment ce budget ; celles des jours passés le recalculent.'}
        </p>
      </Card>

      {unclassified.length > 0 && (
        <Card tone="warning" className="mt-3">
          <p className="t-body-strong">
            {unclassified.length} opération{unclassified.length > 1 ? 's' : ''} non classée{unclassified.length > 1 ? 's' : ''} : <Money cents={unclassifiedTotal} />
          </p>
          <p className="t-small mt-1 text-secondary">Un débit non classé compte comme une dépense courante. Un virement vers ton épargne, un achat d’ETF ou un remboursement ne devraient pas : classe-les pour les sortir du budget.</p>
          <Button to="/a-classer" size="sm" variant="secondary" className="mt-3" onClick={onClose}>
            Classer maintenant
          </Button>
        </Card>
      )}

      {biggest.length > 0 && (
        <>
          <SectionTitle>Ce qui pèse le plus</SectionTitle>
          <Group>
            {biggest.map((t) => (
              <TxRow key={t.id} tx={t} category={cat(t)} account={accounts.get(t.accountId)} onClick={() => onEdit(t)} />
            ))}
          </Group>
          <p className="t-caption mt-2 px-1 text-muted">Touche une opération pour changer sa catégorie : « Transferts internes » ou « Épargne & investissement » la retirent du budget.</p>
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button to="/reglages/budget" variant="secondary" size="sm" onClick={onClose}>
          Revenus, charges, épargne
        </Button>
        <Button to="/budget" variant="ghost" size="sm" onClick={onClose}>
          Voir le cycle
        </Button>
      </div>
    </Sheet>
  );
}
