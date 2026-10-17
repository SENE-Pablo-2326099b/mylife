import { Link } from 'react-router-dom';

export function BackLink() {
  return (
    <Link to="/reglages" className="inline-flex min-h-[44px] items-center text-sm text-muted hover:text-ink">
      ← Réglages
    </Link>
  );
}
