import { PageTitle } from '../components/ui';

export default function Placeholder({ title }: { title: string }) {
  return <PageTitle sub="Bientôt disponible">{title}</PageTitle>;
}
