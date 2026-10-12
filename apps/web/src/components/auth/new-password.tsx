'use client';
import { useState } from 'react';
import { Field } from '@/components/ui/field';

/** Senha nova com confirmação. Valida o mínimo no navegador; a regra completa é da API. */
export function useNewPassword(labels = { password: 'Nova senha', confirm: 'Confirme a nova senha' }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const short = password.length > 0 && password.length < 10;
  const mismatch = touched && confirm.length > 0 && confirm !== password;
  const valid = password.length >= 10 && password === confirm;
  return {
    password, valid,
    touch: () => setTouched(true),
    render: (serverError?: string) => (
      <>
        <Field label={labels.password} type="password" autoComplete="new-password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={serverError ?? (short ? 'A senha precisa ter pelo menos 10 caracteres.' : undefined)}
          hint="Pelo menos 10 caracteres. Uma frase longa é mais segura e fácil de lembrar." />
        <Field label={labels.confirm} type="password" autoComplete="new-password" required value={confirm}
          onChange={(e) => setConfirm(e.target.value)} onBlur={() => setTouched(true)}
          error={mismatch ? 'As senhas não são iguais.' : undefined} />
      </>
    ),
  };
}
