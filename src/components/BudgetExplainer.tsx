import type { Account, Category, Transaction } from '../db/types';
import { isVariable, type BudgetState, type CatMap } from '../domain/budget';
import { formatShort } from '../lib/dates';
import { Button, Card, Divider, Group, Money, SectionTitle, Sheet } from '../ui/index';
import { TxRow } from './TxRow';

function Line({ label, cents, sign, strong }: { label: string; cents: number; sign?: '−' | '=' | '÷' | '+'; strong?: boolean }) {
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
  txs,
  cats,
  accounts,
  onEdit,
}: {
  open: boolean;
  onClose: () => void;
  b: BudgetState;
  txs: Transaction[];
  cats: CatMap;
  accounts: Map<string, Account>;
  onEdit: (tx: Transaction) => void;
}) {
  const counted = txs.filter((t) => t.date < b.today && isVariable(t, cats));
  const biggest = [...counted].sort((x, y) => x.amount - y.amount).slice(0, 6);
  const unclassified = counted.filter((t) => t.categoryId === null);
  const unclassifiedTotal = -unclassified.reduce((s, t) => s + t.amount, 0);
  const env = b.envelope;
  const noIncome = env.incomeSource === 'received' && env.income === 0;
  const available = b.available;
  const pending = b.charges.filter((c) => !c.paidBy);
  const cat = (t: Transaction): Category | undefined => (t.categoryId ? cats.get(t.categoryId) : undefined);

  return (
    <Sheet open={open} onClose={onClose} title="Comment c’est calculé">
      {noIncome && (
        <Card tone="warning" className="mb-3">
          <p className="t-body-strong">Aucun revenu renseigné ni reçu ce cycle</p>
          <p className="t-small mt-1 text-secondary">Ton enveloppe vaut donc 0 € et chaque dépense la dépasse. Ajoute ta paie et tes aides (une APL versée au CROUS se coche « versée directement ») dans les réglages du budget.</p>
          <Button to="/reglages/budget" size="sm" className="mt-3" onClick={onClose}>
            Renseigner mes revenus
          </Button>
        </Card>
      )}
      <Card>
        {env.incomeSource === 'override' ? (
          <Line label="Enveloppe fixée à la main" cents={Math.round(env.total - env.exceptional)} />
        ) : (
          <>
            <Line label={env.incomeSource === 'received' ? 'Revenus reçus ce cycle' : 'Revenus du cycle'} cents={env.income} />
            <Line sign="−" label="Charges fixes" cents={env.fixed} />
            <Line sign="−" label="Épargne / investissement" cents={env.savings} />
            {env.coverage < 1 && <p className="t-caption py-1 text-muted">Premier cycle incomplet : enveloppe ramenée à {Math.round(env.coverage * 100)} % (jours sans données).</p>}
            {env.exceptional > 0 && <Line sign="+" label="Revenus exceptionnels affectés" cents={env.exceptional} />}
            <Divider />
            <Line sign="=" label="Enveloppe vie courante" cents={env.total} strong />
          </>
        )}
        <Line sign="−" label={`Dépensé du ${formatShort(b.cycle.start)} à hier`} cents={b.spentBefore} />
        <Divider />
        <Line sign="=" label="Disponible pour la fin du cycle" cents={available} strong />
        <Line sign="÷" label={`${b.daysLeft} jour${b.daysLeft > 1 ? 's' : ''} jusqu’à la paie, aujourd’hui compris`} cents={b.dailyBudget} />
        <p className="t-small mt-2 text-muted">
          {available < 0
            ? 'Les dépenses du cycle ont déjà dépassé l’enveloppe : le budget du jour est à 0 € et chaque dépense creuse le déficit.'
            : 'Ce budget ne bouge pas de la journée : tes achats du jour s’y comparent. Une journée économe fait monter celui des jours suivants, un excès le fait baisser.'}
        </p>
      </Card>

      {(pending.length > 0 || b.realFree !== null) && (
        <Card className="mt-3">
          <p className="t-body-strong">Encore réservé ce cycle</p>
          {pending.map((c) => (
            <Line key={c.line.id} label={c.line.label} cents={c.line.amount} />
          ))}
          {b.reservedSavings > 0 && <Line label="Épargne pas encore versée" cents={b.reservedSavings} />}
          {b.realFree !== null && (
            <>
              <Divider />
              <Line label="Sur tes comptes courants, réellement libre" cents={b.realFree} strong />
            </>
          )}
          <p className="t-caption mt-1 text-muted">Une charge prévue mais pas encore débitée reste réservée : elle n’est pas libre même si l’argent est encore sur le compte.</p>
        </Card>
      )}

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
