import { View } from 'react-native';

import { Text } from '@/ui/components/primitives';
import { space } from '@/ui/theme';

/** **bold** segments inside one line. */
function Inline({ line, tone }: { line: string; tone?: 'default' | 'secondary' }) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== '');
  return (
    <Text tone={tone} selectable>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <Text key={i} variant="bodyStrong" tone={tone}>
            {p.slice(2, -2)}
          </Text>
        ) : (
          p.replace(/`/g, '')
        ),
      )}
    </Text>
  );
}

/**
 * Minimal Markdown for the coach's answers: paragraphs, bullet / numbered lists, headings and
 * **bold**. Enough for coaching text without a parser dependency.
 */
export function RichText({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, '').split('\n');
  return (
    <View style={{ gap: 6 }}>
      {blocks.map((raw, i) => {
        const line = raw.trimEnd();
        if (line.trim() === '') return <View key={i} style={{ height: 2 }} />;
        const heading = /^#{1,4}\s+(.*)$/.exec(line);
        if (heading !== null) {
          return (
            <Text key={i} variant="bodyStrong" style={{ marginTop: space.xs }}>
              {(heading[1] ?? '').replace(/\*\*/g, '')}
            </Text>
          );
        }
        const bullet = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line);
        if (bullet !== null) {
          return (
            <View key={i} style={{ flexDirection: 'row', gap: space.sm, paddingLeft: line.startsWith('  ') ? space.lg : 0 }}>
              <Text tone="secondary" style={{ minWidth: 14 }}>
                {bullet[1] !== undefined ? `${bullet[1]}.` : '•'}
              </Text>
              <View style={{ flex: 1 }}>
                <Inline line={bullet[2] ?? ''} />
              </View>
            </View>
          );
        }
        if (/^\s*\|/.test(line)) {
          // Tables: shown as plain rows (separator lines dropped).
          if (/^\s*\|?\s*:?-{2,}/.test(line)) return null;
          const cells = line.split('|').map((c) => c.trim()).filter((c) => c !== '');
          return <Inline key={i} line={cells.join(' · ')} tone="secondary" />;
        }
        return <Inline key={i} line={line} />;
      })}
    </View>
  );
}
