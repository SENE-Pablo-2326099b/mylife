import { motion, useIsPresent, type HTMLMotionProps } from 'framer-motion';

/**
 * Calque plein écran animé par AnimatePresence : dès qu'il commence à partir, il laisse passer les
 * touchers (on peut agir sur l'écran dessous sans attendre la fin du fondu).
 */
export function Layer({ style, ...props }: HTMLMotionProps<'div'>) {
  const present = useIsPresent();
  return <motion.div {...props} style={{ ...style, pointerEvents: present ? undefined : 'none' }} />;
}
