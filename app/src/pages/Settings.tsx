import { useState } from 'react';
import { Icon, List, ListRow, ScreenHeader, SectionTitle, Segmented, THEME_CHOICES, readThemeChoice, setThemeChoice, type IconName, type ThemeChoice } from '@mylife/kit';
import { shareTheme } from '../appearance';
import { useLogin } from '../store';

/** Réglages communs : apparence, puis le compte, les données, la confidentialité et l’installation. */
const LINKS: { href: string; icon: IconName; title: string; detail: string }[] = [
  { href: '/compte', icon: 'person', title: 'Ton compte', detail: 'Mot de passe, clé de secours, déconnexion' },
  { href: '/donnees', icon: 'shield', title: 'Tes données', detail: 'Exporter, archive, supprimer' },
  { href: '/confidentialite', icon: 'lock', title: 'Confidentialité', detail: 'Ce que MyLife garde, et pourquoi' },
  { href: '/installer', icon: 'phone', title: 'Installer MyLife', detail: 'Sur l’écran d’accueil du téléphone' },
];

export function SettingsPage() {
  const login = useLogin();
  const [choice, setChoice] = useState<ThemeChoice>(() => readThemeChoice());
  return (
    <>
      <ScreenHeader kicker={login ? `Connecté : ${login}` : undefined} title="Réglages" />
      <section className="stack" style={{ gap: 8 }}>
        <SectionTitle>Apparence</SectionTitle>
        <Segmented
          label="Apparence"
          value={choice}
          options={THEME_CHOICES}
          onChange={(next) => {
            setChoice(next);
            setThemeChoice(next);
            shareTheme(next);
          }}
        />
      </section>
      <section className="stack" style={{ gap: 8 }}>
        <SectionTitle>Compte et données</SectionTitle>
        <List>
          {LINKS.map((l) => (
            <ListRow key={l.href} href={l.href} lead={<Icon name={l.icon} size={20} />} title={l.title} detail={l.detail} />
          ))}
        </List>
      </section>
      <section className="stack" style={{ gap: 8 }}>
        <SectionTitle>Plus</SectionTitle>
        <List>
          <ListRow href="/ancien/" lead={<Icon name="flag" size={20} />} title="Ancien accueil" detail="Les Sorties, en attendant MyRave" />
          <ListRow href="/finances/" lead={<Icon name="card" size={20} />} title="Ancienne MyFinances" detail="Encore là le temps de la bascule : mêmes données" />
          <ListRow href="/kit" lead={<Icon name="modules" size={20} />} title="Le kit" detail="Les briques de l’interface" />
        </List>
      </section>
    </>
  );
}
