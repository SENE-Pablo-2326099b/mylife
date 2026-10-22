import { useState } from 'react';
import { updateSettings } from '../../db/seed';
import { syncHolderRules } from '../../domain/learn';
import { useSettings } from '../../hooks';
import { Button, Card, Chip, Reveal, SectionTitle, TextField, toast } from '../../ui/index';
import { Screen } from '../../ui/Screen';

/** Profil : prénom et noms des titulaires (reconnaissance des virements entre ses propres comptes). */
export default function ProfilePage() {
  const s = useSettings();
  const [name, setName] = useState('');

  const setHolders = async (names: string[]) => {
    await updateSettings({ holderNames: names });
    await syncHolderRules(names);
  };
  const add = async () => {
    const n = name.trim();
    if (!n || s.holderNames.some((h) => h.toLowerCase() === n.toLowerCase())) return;
    setName('');
    await setHolders([...s.holderNames, n]);
    toast({ message: `Les virements entre comptes de ${n} seront reconnus` });
  };
  const remove = async (n: string) => {
    const before = s.holderNames;
    await setHolders(before.filter((h) => h !== n));
    toast({ message: `${n} retiré`, actionLabel: 'Annuler', onAction: () => void setHolders(before) });
  };

  return (
    <Screen stack title="Profil" kicker="Rien ne quitte ton appareil" mood="settings" back="/reglages">
      <Reveal index={0}>
        <Card>
          <TextField label="Prénom" value={s.firstName} onCommit={(firstName) => void updateSettings({ firstName: firstName.trim() })} placeholder="Facultatif" hint="Utilisé seulement pour te saluer." />
        </Card>
      </Reveal>
      <Reveal index={1}>
        <SectionTitle>Noms sur tes virements</SectionTitle>
        <Card>
          <p className="t-small text-secondary">
            Tel qu’il apparaît sur tes relevés (« M JEAN DUPONT »). Un virement émis ou reçu à ce nom entre deux de tes banques est un transfert interne : il n’est jamais compté comme une dépense ni un revenu. Ajoute aussi un conjoint si vous avez des comptes communs.
          </p>
          {s.holderNames.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {s.holderNames.map((n) => (
                <Chip key={n} selected onClick={() => void remove(n)} label={`Retirer ${n}`}>
                  {n} ✕
                </Chip>
              ))}
            </div>
          )}
          <form
            className="mt-3 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <div className="min-w-0 flex-1">
              <TextField label="Ajouter un nom" value={name} onChange={setName} placeholder="Prénom Nom" autoComplete="name" />
            </div>
            <Button type="submit" disabled={!name.trim()}>
              Ajouter
            </Button>
          </form>
        </Card>
      </Reveal>
    </Screen>
  );
}
