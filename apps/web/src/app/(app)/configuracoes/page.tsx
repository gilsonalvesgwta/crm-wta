'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/shell/session';
import { Empty } from '@/components/ui/states';

export default function SettingsIndex() {
  const router = useRouter();
  const { can } = useSession();
  const first = can('settings:admin') ? '/configuracoes/empresa' : can('users:admin') ? '/configuracoes/usuarios'
    : can('pipelines:admin') ? '/configuracoes/funis' : can('products:admin') ? '/configuracoes/produtos'
      : can('contacts:delete') ? '/configuracoes/etiquetas' : can('audit:view') ? '/configuracoes/auditoria' : null;
  useEffect(() => {
    if (first) router.replace(first);
  }, [first, router]);
  return first ? null : <Empty title="Sem configurações disponíveis">Seu perfil não administra esta empresa.</Empty>;
}
