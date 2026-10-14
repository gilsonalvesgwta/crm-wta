import { redirect } from 'next/navigation';

// As automações saíram de Configurações e ganharam lugar no menu principal.
export default function OldAutomationsPage() {
  redirect('/automacoes');
}
