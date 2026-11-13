import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, List, ListRow, ScreenHeader, SectionTitle, Segmented, THEME_CHOICES, readThemeChoice, setThemeChoice, type IconName, type ThemeChoice } from '@mylife/kit';
import { useLogin } from '../store';

/** Réglages communs : apparence, puis le compte, les données, la confidentialité et l'installation. */
const LINKS: { href: string; icon: IconName; title: string; detail: string }[] = [
  { href: '/v5/compte', icon: 'person', title: 'Ton compte', detail: 'Mot de passe, clé de secours, déconnexion' },
  { href: '/v5/donnees', icon: 'shield', title: 'Tes données', detail: 'Exporter, archive, supprimer' },
  { href: '/v5/confidentialite', icon: 'lock', title: 'Confidentialité', detail: 'Ce que MyLife garde, et pourquoi' },
  { href: '/v5/installer', icon: 'phone', title: 'Installer MyLife', detail: 'Sur l’écran d’accueil du téléphone' },
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
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <a href="/" className="btn btn-quiet">Ancien accueil</a>
        <Link to="/kit" className="btn btn-quiet">Le kit</Link>
      </div>
    </>
  );
}
