import { useState } from 'react';
import { Button, List, ListRow } from '@mylife/kit';
import { useEngine } from '../data/engineStore';
import type { Category } from '../engine/schema';
import { archiveCategory, categoryUse, mergeCategories, removeCategory, saveCategory } from '../engine/state';
import { Screen, Sec } from './common';
import { SCOPES } from './labels';
import { CategorySheet } from './sheets';

/**
 * Les catégories, sur leur propre écran (on y arrive des réglages, des opérations et de « à classer ») : créer,
 * renommer, ranger sous une autre, fusionner, archiver, et supprimer celles qui ne servent à rien.
 */
export function CategoriesPage() {
  const engine = useEngine();
  const [category, setCategory] = useState<Category | 'new' | null>(null);
  return (
    <Screen engine={engine} tone="ops" title="Catégories" kicker="MyFinances" back="/argent/reglages" right={<Button onClick={() => setCategory('new')}>Ajouter</Button>}>
      {({ db, update }) => {
        const live = db.categories.filter((c) => !c.archivedAt && !c.mergedIntoId);
        const archived = db.categories.filter((c) => c.archivedAt && !c.mergedIntoId);
        const merged = db.categories.filter((c) => c.mergedIntoId);
        const envelopeName = (id: string) => db.envelopes.find((x) => x.categoryIds.includes(id))?.name;
        const count = (id: string) => db.allocations.filter((a) => a.categoryId === id).length;
        const close = () => setCategory(null);
        return (
          <>
            {SCOPES.map(([scope, name]) => {
              const mine = live.filter((c) => c.scope === scope);
              const top = mine.filter((c) => !c.parentId || !mine.some((p) => p.id === c.parentId));
              if (mine.length === 0) return null;
              return (
                <div key={scope} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Sec>{name}</Sec>
                  <List>
                    {top.flatMap((p) => [p, ...mine.filter((c) => c.parentId === p.id)]).map((c) => {
                      const n = count(c.id);
                      return (
                        <ListRow
                          key={c.id}
                          lead={<span style={{ width: 12, height: 12, borderRadius: 4, background: c.color, flex: 'none', marginLeft: c.parentId && mine.some((p) => p.id === c.parentId) ? 18 : 0 }} />}
                          title={c.name}
                          detail={[n ? `${n} opération${n > 1 ? 's' : ''}` : 'jamais utilisée', envelopeName(c.id) ? `enveloppe « ${envelopeName(c.id)} »` : null].filter(Boolean).join(' · ')}
                          onClick={() => setCategory(c)}
                        />
                      );
                    })}
                  </List>
                </div>
              );
            })}
            {live.length === 0 && <span className="t-small muted">Aucune catégorie pour l’instant.</span>}
            {(archived.length > 0 || merged.length > 0) && (
              <>
                <Sec>Archivées et fusionnées</Sec>
                <List>
                  {archived.map((c) => (
                    <ListRow key={c.id} title={c.name} detail="archivée : touche pour la restaurer ou la supprimer" onClick={() => setCategory(c)} />
                  ))}
                  {merged.map((c) => (
                    <ListRow key={c.id} title={c.name} detail={`fusionnée dans « ${db.categories.find((x) => x.id === c.mergedIntoId)?.name ?? '?'} »`} />
                  ))}
                </List>
              </>
            )}
            <CategorySheet
              value={category}
              all={db.categories}
              uses={category && category !== 'new' ? categoryUse(db, category.id) : 0}
              onClose={close}
              onSave={(c) => {
                update((s) => saveCategory(s, c, db.categories));
                close();
              }}
              onArchive={(id, at) => {
                update((s) => archiveCategory(s, id, db.categories, at));
                close();
              }}
              onMerge={(from, into) => {
                update((s) => mergeCategories(s, from, into, db.categories, Date.now()));
                close();
              }}
              onRemove={(id) => {
                update((s) => removeCategory(s, id, db.categories, Date.now()));
                close();
              }}
            />
          </>
        );
      }}
    </Screen>
  );
}
