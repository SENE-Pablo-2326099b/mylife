import { useState } from 'react';
import { Badge, Button, EmptyState, Field, Glass, IconTile, List, ListRow, ModuleCard, ModuleLabel, ScreenHeader, SectionTitle, Sheet, Switch, type Tone } from '@mylife/kit';

/** La page « kit » : tous les composants, dans leurs états. C'est la référence qui garde MyLife cohérent. */
const TONES: { tone: Tone; name: string; icon: 'card' | 'barbell' | 'navigate' | 'chef' }[] = [
  { tone: 'finances', name: 'MyFinances', icon: 'card' },
  { tone: 'perf', name: 'MyPerf', icon: 'barbell' },
  { tone: 'rave', name: 'MyRave', icon: 'navigate' },
  { tone: 'chef', name: 'MyChef', icon: 'chef' },
];

export function KitPage() {
  const [on, setOn] = useState(true);
  const [sheet, setSheet] = useState(false);
  return (
    <>
      <ScreenHeader kicker="Référence" title="Le kit" />

      <SectionTitle>Matière : verre, carte de module</SectionTitle>
      <div className="grid-2">
        <Glass className="pad">
          <span className="t-strong">Panneau de verre</span>
          <p className="t-small muted" style={{ margin: '4px 0 0' }}>Listes, barre, réglages.</p>
        </Glass>
        <ModuleCard tone="finances">
          <div className="pad">
            <span className="t-strong">Carte de module</span>
            <p className="t-small muted" style={{ margin: '4px 0 0' }}>Bord et teinte à sa couleur.</p>
          </div>
        </ModuleCard>
      </div>

      <SectionTitle>Lumière : une couleur par module</SectionTitle>
      <div className="grid-2">
        {TONES.map((t) => (
          <ModuleCard key={t.tone} tone={t.tone}>
            <div className="pad row">
              <IconTile tone={t.tone} icon={t.icon} />
              <ModuleLabel tone={t.tone}>{t.name}</ModuleLabel>
            </div>
          </ModuleCard>
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Badge tone="ok">Tout va bien</Badge>
        <Badge tone="warn">Attention</Badge>
        <Badge tone="bad">Problème</Badge>
        <Badge>Neutre</Badge>
      </div>

      <SectionTitle>Texte</SectionTitle>
      <Glass className="pad stack">
        <span className="t-hero">25,35 €</span>
        <span className="t-screen">Titre d'écran</span>
        <span className="t-card">Titre de carte</span>
        <span className="t-body">Texte courant, pour ce qu'on lit vraiment.</span>
        <span className="t-small muted">Texte second : précisions, dates, unités.</span>
      </Glass>

      <SectionTitle>Boutons : un seul bouton en dégradé par écran</SectionTitle>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Button variant="action">Action clé</Button>
        <Button>Secondaire</Button>
        <Button variant="quiet">Discret</Button>
        <Button variant="danger">Supprimer</Button>
        <Button disabled>Indisponible</Button>
      </div>

      <SectionTitle>Saisie</SectionTitle>
      <Glass className="pad stack">
        <Field id="kit-montant" label="Montant" hint="Un champ est creusé dans le verre ; l'aide est toujours dessous.">
          <input id="kit-montant" defaultValue="12,50" inputMode="decimal" />
        </Field>
        <div className="row">
          <span className="grow t-body">Un interrupteur</span>
          <Switch checked={on} onChange={setOn} label="Interrupteur d'exemple" />
        </div>
      </Glass>

      <SectionTitle>Liste</SectionTitle>
      <List>
        <ListRow title="Titre de la ligne" detail="Précision" value="−12,50 €" />
        <ListRow title="Ligne qui mène ailleurs" href="#" />
      </List>

      <SectionTitle>Écran vide : toujours une explication et une action</SectionTitle>
      <EmptyState title="Aucune séance prévue" body="Importe ton programme ou choisis-en un prêt à l'emploi." action={<Button>Choisir un programme</Button>} />

      <SectionTitle>Feuille</SectionTitle>
      <Button onClick={() => setSheet(true)}>Ouvrir une feuille</Button>
      <Sheet open={sheet} title="Une feuille" onClose={() => setSheet(false)}>
        <p className="t-body muted" style={{ margin: 0 }}>Elle passe par-dessus tout, et se ferme par le fond, la croix ou Échap.</p>
      </Sheet>
    </>
  );
}
