import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, List, ListRow, Notice } from '@mylife/kit';
import { AI_MODELS, readAiKey, readAiModel, writeAiModel, type AiModel } from '@mylife/core/aiKey';
import { programPrompt } from '@mylife/training';
import { call } from '../data/client';
import { ConvertError, convertWithClaude, readFile } from '../data/convert';
import type { ImportOptions, ImportPreview } from '../data/importer';
import { Head } from './common';
import { errorText, today } from './util';
import '../perf.css';

/**
 * Importer et partager un programme (maquette V3-Import, validée le 22/11). On colle un programme (JSON d'une IA,
 * texte « Squat 4x8 »), on choisit un fichier (texte, PDF, photo) ou un programme prêt ; un texte libre, un PDF ou une
 * photo se convertissent avec Claude (Opus 5.5 ou Sonnet 5.5, avec ta clé). Tout est montré avant d'être écrit.
 */
const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

export function ImportPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'text' | 'file'>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ data: string; mediaType: string; name: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [by, setBy] = useState<string | null>(null);
  const [ready, setReady] = useState<{ id: string; title: string; level: string }[]>([]);
  const [model, setModel] = useState<AiModel>(() => readAiModel());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const [detail, setDetail] = useState(false);
  const [options, setOptions] = useState<ImportOptions>({ mode: 'add', days: true, oneRms: true, blocks: true });
  const hasKey = readAiKey() !== null;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void call('readyPrograms').then(setReady);
  }, []);
  // Lecture sur l'appareil à mesure qu'on tape (sans IA) : JSON d'une IA ou texte « Squat 4x8 ».
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!text.trim()) return setPreview(null);
    timer.current = setTimeout(() => {
      void call('importPreview', text).then((p) => {
        setPreview(p);
        if (!p.ok) setBy(null);
      });
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text]);

  const convert = async () => {
    setBusy(true);
    setNote(null);
    try {
      const answer = await convertWithClaude(file ? { file } : { text }, model);
      const p = await call('importPreview', answer);
      if (!p.ok) throw new ConvertError('La réponse de Claude n’a pas pu être lue. Réessaie.');
      setText(answer);
      setFile(null);
      setMode('text');
      setBy(AI_MODELS.find((m) => m.id === model)?.label ?? model);
    } catch (e) {
      setNote({ tone: 'bad', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      await call('applyImport', text, options, today());
      navigate('/sport/programme', { replace: true });
    } catch (e) {
      setNote({ tone: 'bad', text: errorText(e) });
      setBusy(false);
    }
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setNote(null);
    try {
      const r = await readFile(f);
      if ('text' in r) {
        setFile(null);
        setText(r.text);
        setMode('text');
      } else {
        setFile(r);
        setText('');
        setPreview(null);
      }
    } catch (e) {
      setNote({ tone: 'bad', text: errorText(e) });
    }
  };

  const ok = preview?.ok === true;
  const canConvert = hasKey && !busy && (file !== null || (text.trim().length > 0 && !ok));
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head
        back="/sport/programme"
        kicker="Programme"
        title="Importer"
        right={
          <button type="button" className="pf-chip" onClick={() => void copy(programPrompt()).then((done) => setNote(done ? { tone: 'ok', text: 'Prompt copié : colle-le dans n’importe quelle IA avec ton programme, puis colle sa réponse ici.' } : { tone: 'bad', text: 'Copie impossible sur ce navigateur.' }))}>
            Copier le prompt
          </button>
        }
      />
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <div className="glass segmented" role="group" aria-label="Source">
        <button type="button" aria-pressed={mode === 'text'} onClick={() => setMode('text')}>
          Texte
        </button>
        <button type="button" aria-pressed={mode === 'file'} onClick={() => setMode('file')}>
          Fichier
        </button>
      </div>
      {mode === 'text' ? (
        <textarea className="input pf-paste" rows={6} aria-label="Programme à importer" placeholder={'Colle ton programme : la réponse d’une IA, ou du texte.\nLundi : Squat 4x6 @75%, Tractions EMOM 10 min 5 reps…'} value={text} onChange={(e) => setText(e.target.value)} />
      ) : (
        <label className="glass pf-drop">
          <input type="file" accept=".json,.txt,.md,.csv,application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => void pick(e.target.files?.[0])} style={{ display: 'none' }} />
          <span className="t-strong">{file ? file.name : 'Choisir un fichier'}</span>
          <span className="t-small muted">{file ? 'à convertir avec Claude' : 'texte, PDF ou photo du programme'}</span>
        </label>
      )}

      {!text.trim() && !file && ready.length > 0 && (
        <>
          <span className="pf-sec">
            <span>Ou un programme prêt</span>
            <span />
          </span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {ready.map((r) => (
              <button key={r.id} type="button" className="pf-chip is-neutral" title={r.level} onClick={() => void call('readyProgramText', r.id).then((t) => t && (setText(t), setBy(null)))}>
                {r.title}
              </button>
            ))}
          </div>
        </>
      )}

      {(file || (text.trim() && preview && !ok)) && (
        <div className="stack" style={{ gap: 10 }}>
          {text.trim() && preview && !ok && <Notice tone="warn">{preview.issues[0] ?? 'Pas encore lisible tel quel.'}</Notice>}
          {hasKey ? (
            <>
              <div className="row" style={{ gap: 10 }}>
                <span className="t-small muted">Modèle</span>
                <div className="glass segmented grow" role="group" aria-label="Modèle de Claude">
                  {AI_MODELS.map((m) => (
                    <button key={m.id} type="button" aria-pressed={model === m.id} title={m.hint} onClick={() => (writeAiModel(m.id), setModel(m.id))}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <Button variant="action" block disabled={!canConvert} onClick={() => void convert()}>
                {busy ? 'Conversion…' : 'Convertir avec Claude'}
              </Button>
            </>
          ) : (
            <span className="t-small muted">Sans clé Claude : copie le prompt, donne-le à une IA avec ton programme, puis colle sa réponse ici. Ta clé se règle dans Copilot.</span>
          )}
        </div>
      )}

      {ok && preview && (
        <>
          <div className="card-module pf-hero" style={{ gap: 8 }}>
            <span className="pf-kick c-tone">{by ? `Converti par Claude ${by} · vérifié` : preview.source === 'json' ? 'Programme lu · vérifié' : 'Texte lu · vérifié'}</span>
            <span className="pf-big" style={{ fontSize: 25 }}>
              {preview.name}
            </span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="pf-chip is-neutral">{`${preview.summary.sessions} séance${preview.summary.sessions > 1 ? 's' : ''}`}</span>
              <span className="pf-chip is-neutral">{`${preview.summary.exercises} exercice${preview.summary.exercises > 1 ? 's' : ''}`}</span>
              {preview.summary.created > 0 && <span className="pf-chip">{`${preview.summary.created} nouveau${preview.summary.created > 1 ? 'x' : ''}`}</span>}
              {preview.blocks.length > 0 && <span className="pf-chip is-neutral">{`${preview.blocks.length} bloc${preview.blocks.length > 1 ? 's' : ''}`}</span>}
            </div>
            <div className="pf-lines">
              {preview.sessions.map((s, i) => (
                <div key={i} className="pf-line" style={{ alignItems: 'flex-start' }}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t-strong">{`${s.days ? `${s.days} · ` : ''}${s.name}`}</span>
                    {detail ? (
                      s.exercises.map((e, k) => (
                        <span key={k} className="pf-imp-ex">
                          <span className="grow">
                            {e.group && <span className="pf-tag">{e.group}</span>} {e.name}
                            {e.written && <span className="muted">{` · écrit « ${e.written} »`}</span>}
                            <br />
                            <span className="t-small muted">{e.detail}</span>
                          </span>
                          {e.isNew && <span className="pf-chip">nouveau</span>}
                        </span>
                      ))
                    ) : (
                      <>
                        <br />
                        <span className="t-small muted">{s.exercises.map((e) => e.name).join(', ')}</span>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {preview.blocks.length > 0 && detail && <span className="t-small muted">{`Blocs : ${preview.blocks.map((b) => `${b.name} (${b.kind}, ${b.weeks}${b.deloadWeeks ? ` + ${b.deloadWeeks}` : ''} sem.)`).join(' · ')}`}</span>}
            <button type="button" className="pf-link" style={{ alignSelf: 'flex-start', padding: 0 }} aria-expanded={detail} onClick={() => setDetail(!detail)}>
              {detail ? 'Moins de détail' : 'Voir le détail ›'}
            </button>
          </div>
          {preview.issues.length > 0 && (
            <Notice tone="warn">
              <span>{`Non compris : ${preview.issues.slice(0, 3).join(' · ')}${preview.issues.length > 3 ? ` (+ ${preview.issues.length - 3})` : ''}`}</span>
            </Notice>
          )}
          <div className="glass segmented" role="group" aria-label="Ajouter ou remplacer">
            <button type="button" aria-pressed={options.mode === 'add'} onClick={() => setOptions({ ...options, mode: 'add' })}>
              Ajouter
            </button>
            <button type="button" aria-pressed={options.mode === 'replace'} onClick={() => setOptions({ ...options, mode: 'replace' })}>
              Remplacer
            </button>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {preview.summary.days > 0 && (
              <button type="button" className={`pf-chip${options.days ? '' : ' is-neutral'}`} aria-pressed={options.days} onClick={() => setOptions({ ...options, days: !options.days })}>
                Jours dans la semaine type
              </button>
            )}
            {preview.oneRms.length > 0 && (
              <button type="button" className={`pf-chip${options.oneRms ? '' : ' is-neutral'}`} aria-pressed={options.oneRms} onClick={() => setOptions({ ...options, oneRms: !options.oneRms })}>
                {`${preview.oneRms.length} 1RM`}
              </button>
            )}
            {preview.blocks.length > 0 && (
              <button type="button" className={`pf-chip${options.blocks ? '' : ' is-neutral'}`} aria-pressed={options.blocks} onClick={() => setOptions({ ...options, blocks: !options.blocks })}>
                Les blocs
              </button>
            )}
          </div>
          {options.mode === 'replace' && <span className="t-small muted">Tes séances types actuelles sont archivées (tes séances passées restent).</span>}
          <Button variant="action" block disabled={busy} onClick={() => void apply()}>
            Valider l’import
          </Button>
        </>
      )}

      <span className="pf-sec">
        <span>Partager mon programme</span>
        <span />
      </span>
      <List>
        <ListRow
          title="Copier"
          detail="séances types, semaine, blocs et 1RM saisis"
          onClick={async () => {
            const json = await call('exportProgram', 'Mon programme MyPerf');
            setNote((await copy(json)) ? { tone: 'ok', text: 'Programme copié (tes séances faites n’y sont pas).' } : { tone: 'bad', text: 'Copie impossible sur ce navigateur.' });
          }}
        />
        <ListRow
          title="Fichier"
          detail="mon-programme.json"
          onClick={async () => {
            const json = await call('exportProgram', 'Mon programme MyPerf');
            const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'mon-programme.json';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        />
      </List>
    </div>
  );
}
